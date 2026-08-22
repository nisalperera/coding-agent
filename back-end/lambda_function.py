"""
AWS Lambda backend for the Perplexity-style web app.
- Checks EC2 (T4 vLLM host) instance state and auto-starts it if stopped/stopping.
- Streams live progress updates (percentage) while waiting for EC2 + vLLM to become ready.
- Enforces a hard 2-minute (120s) overall startup budget; if exceeded, tells the user
  to retry in ~2 minutes instead of hanging indefinitely.
- Streams tokens back to the browser via Lambda response streaming.
- Validates Cognito JWTs (Google/GitHub federated login) before serving requests.
- Enforces per-user rate limiting (OWASP API Security).
- Routes risky tool calls (write_file, run_shell, and GitHub/GitLab repo-management
  tools) through a human-in-the-loop pending-action flow backed by DynamoDB.
- For GitHub tools, uses the connecting user's own stored OAuth token (DynamoDB)
  when available. For GitLab tools, uses a per-request token sent by the front-end
  with the approval decision (never persisted server-side).
- Lets a user revoke their stored GitHub integration server-side ("disconnect_integration").
- Calls a self-hosted vLLM server (Qwen3-Coder-14B) over the VPC.
"""
import json
import time
import uuid
import logging
import os
from collections import defaultdict


import boto3
import jwt
import urllib3
import urllib.request


from repo_tools import (
    REPO_TOOL_FUNCS, REPO_TOOL_DEFINITIONS, REPO_RISKY_TOOLS,
    GITHUB_TOOL_NAMES, GITLAB_TOOL_NAMES,
)
from github_oauth import handle_github_oauth_callback, get_user_integration, delete_user_integration


VLLM_ENDPOINT = os.environ["VLLM_ENDPOINT"]
VLLM_HEALTH_ENDPOINT = os.environ.get("VLLM_HEALTH_ENDPOINT", VLLM_ENDPOINT.rsplit("/v1/", 1)[0] + "/health")
MODEL = os.environ.get("MODEL_NAME", "Qwen/Qwen3-Coder-14B-Instruct-AWQ")
USER_POOL_ID = os.environ["USER_POOL_ID"]
REGION = os.environ.get("AWS_REGION", "us-east-1")
TAVILY_API_KEY = os.environ["TAVILY_API_KEY"]
EC2_INSTANCE_ID = os.environ["EC2_INSTANCE_ID"]


STARTUP_BUDGET_S = int(os.environ.get("STARTUP_BUDGET_S", "120"))
POLL_INTERVAL_S = 3
RETRY_AFTER_S = 120


JWKS_URL = "https://cognito-idp." + REGION + ".amazonaws.com/" + USER_POOL_ID + "/.well-known/jwks.json"


http = urllib3.PoolManager()
dynamodb = boto3.resource("dynamodb")
pending_table = dynamodb.Table("pending-actions")
ec2_client = boto3.client("ec2", region_name=REGION)


logger = logging.getLogger("coding-agent")
logger.setLevel(logging.INFO)


RISKY_TOOLS = {"write_file", "run_shell"} | REPO_RISKY_TOOLS
_jwks_cache = None
_rate_limits = defaultdict(list)


TOOLS = [{"type": "function", "function": {
    "name": "web_search", "description": "Search the web for current information",
    "parameters": {"type": "object", "properties": {"query": {"type": "string"}}, "required": ["query"]}}}]
TOOLS = TOOLS + REPO_TOOL_DEFINITIONS



def log_event(level, message, **fields):
    logger.log(level, json.dumps({
        "timestamp": time.time(), "level": logging.getLevelName(level),
        "trace_id": fields.pop("trace_id", str(uuid.uuid4())),
        "message": message, **fields,
    }))



def get_instance_state():
    resp = ec2_client.describe_instances(InstanceIds=[EC2_INSTANCE_ID])
    reservations = resp.get("Reservations", [])
    if not reservations or not reservations[0].get("Instances"):
        raise RuntimeError("Instance " + EC2_INSTANCE_ID + " not found")
    return reservations[0]["Instances"][0]["State"]["Name"]



def is_vllm_ready():
    try:
        resp = http.request("GET", VLLM_HEALTH_ENDPOINT, timeout=5.0)
        return resp.status == 200
    except Exception:
        return False



def write_progress(response_stream, phase, elapsed, budget, message):
    pct = min(99, int((elapsed / budget) * 100))
    response_stream.write(json.dumps({
        "type": "progress", "phase": phase, "percent": pct,
        "elapsed_seconds": round(elapsed, 1), "message": message,
    }).encode() + b"\n")



def ensure_backend_ready(response_stream, trace_id):
    start_time = time.time()
    deadline = start_time + STARTUP_BUDGET_S


    try:
        state = get_instance_state()
    except Exception as e:
        log_event(logging.ERROR, "ec2_check_failed", error=str(e), trace_id=trace_id)
        return False, "Could not reach EC2. Please try again in " + str(RETRY_AFTER_S // 60) + " minutes."


    log_event(logging.INFO, "ec2_state_checked", state=state, trace_id=trace_id)


    if state in ("shutting-down", "terminated"):
        log_event(logging.ERROR, "ec2_unavailable", state=state, trace_id=trace_id)
        return False, "Backend instance is unavailable. Contact support."


    if state == "stopped":
        log_event(logging.INFO, "ec2_starting", trace_id=trace_id)
        write_progress(response_stream, "starting_instance", 0, STARTUP_BUDGET_S, "Starting GPU instance...")
        ec2_client.start_instances(InstanceIds=[EC2_INSTANCE_ID])


    while state != "running":
        elapsed = time.time() - start_time
        if time.time() >= deadline:
            log_event(logging.ERROR, "ec2_start_timeout", trace_id=trace_id)
            return False, "Startup is taking longer than usual. Please try again in " + str(RETRY_AFTER_S // 60) + " minutes."
        write_progress(response_stream, "starting_instance", elapsed, STARTUP_BUDGET_S, "Waiting for GPU instance to boot...")
        time.sleep(POLL_INTERVAL_S)
        state = get_instance_state()


    log_event(logging.INFO, "ec2_running", trace_id=trace_id)


    while not is_vllm_ready():
        elapsed = time.time() - start_time
        if time.time() >= deadline:
            log_event(logging.ERROR, "vllm_ready_timeout", trace_id=trace_id)
            return False, "Model is still loading. Please try again in " + str(RETRY_AFTER_S // 60) + " minutes."
        write_progress(response_stream, "loading_model", elapsed, STARTUP_BUDGET_S, "Loading model onto GPU...")
        time.sleep(POLL_INTERVAL_S)


    elapsed = time.time() - start_time
    write_progress(response_stream, "ready", elapsed, STARTUP_BUDGET_S, "Backend ready.")
    log_event(logging.INFO, "vllm_ready", elapsed=round(elapsed, 1), trace_id=trace_id)
    return True, None



def get_jwks():
    global _jwks_cache
    if _jwks_cache is None:
        with urllib.request.urlopen(JWKS_URL) as r:
            _jwks_cache = json.loads(r.read())
    return _jwks_cache



def verify_token(token):
    header = jwt.get_unverified_header(token)
    jwks = get_jwks()
    key = next(k for k in jwks["keys"] if k["kid"] == header["kid"])
    public_key = jwt.algorithms.RSAAlgorithm.from_jwk(json.dumps(key))
    return jwt.decode(public_key=public_key, jwt=token, algorithms=["RS256"],
                       audience=None, options={"verify_aud": False})



def check_rate_limit(user_id, max_requests=20, window_seconds=60):
    now = time.time()
    _rate_limits[user_id] = [t for t in _rate_limits[user_id] if now - t < window_seconds]
    if len(_rate_limits[user_id]) >= max_requests:
        return False
    _rate_limits[user_id].append(now)
    return True



def owns_conversation(user_id, conversation_id):
    return True



def web_search(query):
    r = http.request("GET", "https://api.tavily.com/search", fields={"q": query, "api_key": TAVILY_API_KEY})
    results = json.loads(r.data.decode())["results"][:3]
    return json.dumps([{"title": x["title"], "url": x["url"], "snippet": x["content"][:200]} for x in results])



FUNCS = {"web_search": web_search}
FUNCS.update(REPO_TOOL_FUNCS)



def get_user_github_token(user_id):
    """
    Looks up the calling user's own GitHub access token, stored via the
    "Connect GitHub" OAuth flow (github_oauth.py). Returns None if the user
    has not connected their GitHub account, in which case repo_tools.py's
    github_* functions fall back to the shared service-level GITHUB_TOKEN.
    """
    integration = get_user_integration(user_id, "github")
    return integration.get("access_token") if integration else None



def call_repo_tool(name, args, user_id, gitlab_token=None):
    """
    Dispatches a repo-management tool call.

    - github_* tools: injects the calling user's own stored GitHub OAuth
      token (if connected), falling back to the shared GITHUB_TOKEN.
    - gitlab_* tools: injects `gitlab_token` if the caller supplied one with
      this specific request (front-end sends its browser-local GitLab PKCE
      token per-request; it is never stored server-side). Falls back to the
      shared GITLAB_TOKEN when absent.
    """
    kwargs = dict(args)
    if name in GITHUB_TOOL_NAMES:
        token = get_user_github_token(user_id)
        if token:
            kwargs["github_token"] = token
    elif name in GITLAB_TOOL_NAMES:
        if gitlab_token:
            kwargs["gitlab_token"] = gitlab_token
    return FUNCS[name](**kwargs)



def call_vllm(messages, tools=None, stream=False):
    payload = {"model": MODEL, "messages": messages, "stream": stream}
    if tools:
        payload["tools"] = tools
        payload["tool_choice"] = "auto"
    resp = http.request(
        "POST", VLLM_ENDPOINT,
        body=json.dumps(payload).encode(),
        headers={"Content-Type": "application/json"},
        preload_content=not stream,
    )
    return resp



@awslambda.streamifyResponse
async def handler(event, response_stream, context):
    trace_id = str(uuid.uuid4())
    headers = event.get("headers", {})
    auth_header = headers.get("authorization", "")
    token = auth_header.replace("Bearer ", "")


    try:
        claims = verify_token(token)
    except Exception:
        response_stream.write(b'{"error": "unauthorized"}')
        return


    user_id = claims["sub"]


    if not check_rate_limit(user_id):
        log_event(logging.WARNING, "rate_limit_exceeded", user_id=user_id, trace_id=trace_id)
        response_stream.write(b'{"error": "rate_limit_exceeded"}')
        return


    body = json.loads(event.get("body", "{}"))


    if body.get("action") == "approve_pending":
        action_id = body["action_id"]
        item = pending_table.get_item(Key={"action_id": action_id}).get("Item")
        if not item or item["user_id"] != user_id:
            response_stream.write(b'{"error": "forbidden"}')
            return
        if body["decision"] == "approve":
            gitlab_token = body.get("gitlab_token")
            result = call_repo_tool(item["tool_name"], item["args"], user_id, gitlab_token=gitlab_token) \
                if item["tool_name"] in FUNCS else "Unknown tool."
        else:
            result = "User denied this action."
        pending_table.delete_item(Key={"action_id": action_id})
        log_event(logging.INFO, "pending_action_resolved", user_id=user_id, decision=body["decision"], trace_id=trace_id)
        response_stream.write(json.dumps({"result": str(result)}).encode())
        return


    if body.get("action") == "github_oauth_callback":
        status_code, result = handle_github_oauth_callback(body, user_id)
        log_event(logging.INFO, "github_oauth_callback", user_id=user_id, status_code=status_code, trace_id=trace_id)
        response_stream.write(json.dumps(result).encode())
        return


    if body.get("action") == "disconnect_integration":
        provider = body.get("provider")
        if provider == "github":
            delete_user_integration(user_id, "github")
            log_event(logging.INFO, "integration_disconnected", user_id=user_id, provider=provider, trace_id=trace_id)
            response_stream.write(json.dumps({"disconnected": True, "provider": "github"}).encode())
        else:
            # GitLab has no server-side record to delete today — its token
            # lives only in the browser (see repo_tools.py's docstring).
            response_stream.write(json.dumps({"disconnected": True, "provider": provider, "server_side": False}).encode())
        return


    conversation_id = body.get("conversation_id")
    if conversation_id and not owns_conversation(user_id, conversation_id):
        response_stream.write(b'{"error": "forbidden"}')
        return


    ready, error_message = ensure_backend_ready(response_stream, trace_id)
    if not ready:
        log_event(logging.ERROR, "backend_not_ready", error=error_message, trace_id=trace_id)
        response_stream.write(json.dumps({
            "type": "error", "message": error_message, "retry_after_seconds": RETRY_AFTER_S,
        }).encode())
        return


    history = body.get("history", [])
    user_message = body.get("message", "")
    messages = history + [{"role": "user", "content": user_message}]


    first_resp = call_vllm(messages, tools=TOOLS, stream=False)
    result = json.loads(first_resp.data.decode())
    msg = result["choices"][0]["message"]


    if msg.get("tool_calls"):
        for call in msg["tool_calls"]:
            args = json.loads(call["function"]["arguments"])
            name = call["function"]["name"]


            if name in RISKY_TOOLS:
                action_id = str(uuid.uuid4())
                pending_table.put_item(Item={
                    "action_id": action_id, "user_id": user_id,
                    "tool_name": name, "args": args,
                    "created_at": int(time.time()),
                    "expires_at": int(time.time()) + 600,
                })
                log_event(logging.INFO, "pending_action_created", user_id=user_id, tool=name, trace_id=trace_id)
                response_stream.write(json.dumps({
                    "type": "confirmation_required", "action_id": action_id,
                    "tool_name": name, "args": args,
                }).encode())
                return


            messages.append(msg)
            if name in GITHUB_TOOL_NAMES or name in GITLAB_TOOL_NAMES:
                tool_result = call_repo_tool(name, args, user_id, gitlab_token=body.get("gitlab_token"))
            else:
                tool_result = FUNCS[name](**args)
            messages.append({"role": "tool", "tool_call_id": call["id"], "content": str(tool_result)})


    log_event(logging.INFO, "chat_completion_started", user_id=user_id, trace_id=trace_id)
    response_stream.write(json.dumps({"type": "answer_start"}).encode() + b"\n")
    stream_resp = call_vllm(messages, stream=True)
    for line in stream_resp.stream(decode_content=True):
        for chunk_line in line.decode().split("\n"):
            if chunk_line.startswith("data: ") and chunk_line != "data: [DONE]":
                try:
                    delta = json.loads(chunk_line[6:])["choices"][0]["delta"].get("content", "")
                    if delta:
                        response_stream.write(("data: " + json.dumps({"token": delta}) + "\n\n").encode())
                except (json.JSONDecodeError, KeyError):
                    continue


    response_stream.write(b"data: [DONE]\n\n")
