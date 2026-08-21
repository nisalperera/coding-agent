"""
[FINAL] Claude Code-style CLI coding agent.
Connects to a self-hosted vLLM server (Qwen3-Coder-14B) via OpenAI-compatible API.
Includes human-in-the-loop confirmation for risky tools (write_file, run_shell, and
GitHub/GitLab repo-management tools) and OAuth login/logout via Cognito
(Google/GitHub federated sign-in).
"""
import json
import subprocess
import sys
from pathlib import Path
from openai import OpenAI
from cli_auth import login, logout, get_access_token
from repo_tools import REPO_TOOL_FUNCS, REPO_TOOL_DEFINITIONS, REPO_RISKY_TOOLS

VLLM_BASE_URL = "http://localhost:8000/v1"
MODEL = "Qwen/Qwen3-Coder-14B-Instruct-AWQ"


def read_file(path):
    return Path(path).read_text()


def write_file(path, content):
    Path(path).write_text(content)
    return f"Wrote {len(content)} chars to {path}"


def run_shell(command):
    result = subprocess.run(command, shell=True, capture_output=True, text=True, timeout=30)
    return result.stdout + result.stderr


FUNCS = {"read_file": read_file, "write_file": write_file, "run_shell": run_shell}
FUNCS.update(REPO_TOOL_FUNCS)

RISKY_TOOLS = {"write_file", "run_shell"} | REPO_RISKY_TOOLS

TOOLS = [
    {"type": "function", "function": {
        "name": "read_file", "description": "Read a file's contents",
        "parameters": {"type": "object", "properties": {"path": {"type": "string"}}, "required": ["path"]}}},
    {"type": "function", "function": {
        "name": "write_file", "description": "Write content to a file",
        "parameters": {"type": "object", "properties": {
            "path": {"type": "string"}, "content": {"type": "string"}}, "required": ["path", "content"]}}},
    {"type": "function", "function": {
        "name": "run_shell", "description": "Run a shell command",
        "parameters": {"type": "object", "properties": {"command": {"type": "string"}}, "required": ["command"]}}},
] + REPO_TOOL_DEFINITIONS


def confirm_action(tool_name, args):
    print(f"\n\u26a0\ufe0f  Agent wants to run: {tool_name}({json.dumps(args, indent=2)})")
    choice = input("Approve? [y/N/e=edit]: ").strip().lower()
    if choice == "e":
        if tool_name == "run_shell":
            args["command"] = input(f"Edit command [{args['command']}]: ") or args["command"]
        elif tool_name in ("write_file", "github_push_file", "gitlab_push_file"):
            print(f"Current content:\n{args.get('content', '')[:300]}...")
            confirm2 = input("Proceed with this content? [y/N]: ").strip().lower()
            return confirm2 == "y"
        return True
    return choice == "y"


def agent_loop(client, user_prompt, max_turns=10):
    messages = [
        {"role": "system",
         "content": "You are a coding agent. Use tools to read/write files, run commands, "
                    "and manage GitHub/GitLab branches, commits, pull/merge requests, and issues "
                    "to complete tasks. You cannot create or delete repositories."},
        {"role": "user", "content": user_prompt},
    ]
    for _ in range(max_turns):
        resp = client.chat.completions.create(
            model=MODEL, messages=messages, tools=TOOLS, tool_choice="auto", temperature=0.2,
        )
        msg = resp.choices[0].message
        messages.append(msg.model_dump())

        if not msg.tool_calls:
            print(msg.content)
            return

        for call in msg.tool_calls:
            args = json.loads(call.function.arguments)
            name = call.function.name

            if name in RISKY_TOOLS:
                if not confirm_action(name, args):
                    result = "User denied this action."
                    print("\u274c Denied.")
                    messages.append({"role": "tool", "tool_call_id": call.id, "content": result})
                    continue

            result = FUNCS[name](**args)
            print(f"[tool] {name}({args}) -> {str(result)[:200]}")
            messages.append({"role": "tool", "tool_call_id": call.id, "content": str(result)})


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print('Usage: python cli_agent.py <login|logout|"your prompt">')
        sys.exit(1)

    if sys.argv[1] == "login":
        login()
        sys.exit()
    if sys.argv[1] == "logout":
        logout()
        sys.exit()

    token = get_access_token()
    if not token:
        print("Not logged in. Run: python cli_agent.py login")
        sys.exit(1)

    client = OpenAI(base_url=VLLM_BASE_URL, api_key="EMPTY",
                     default_headers={"Authorization": f"Bearer {token}"})
    agent_loop(client, " ".join(sys.argv[1:]))
