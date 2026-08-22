"""
GitHub and GitLab repository management tools, using REST API endpoints only
(no shell/git CLI calls). Covers branches, file commits, pull/merge requests,
and issues. Repo creation/deletion is intentionally NOT included.


Requires:
  GITHUB_TOKEN - a GitHub personal access token (repo scope) or GitHub App token
  GITLAB_TOKEN - a GitLab personal/project access token (api scope)
"""
import base64
import json
import os


import requests


GITHUB_API = "https://api.github.com"
GITLAB_API = "https://gitlab.com/api/v4"


GITHUB_TOKEN = os.environ.get("GITHUB_TOKEN", "")
GITLAB_TOKEN = os.environ.get("GITLAB_TOKEN", "")



def _github_headers():
    return {
        "Authorization": f"Bearer {GITHUB_TOKEN}",
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
    }



def _gitlab_headers():
    return {"PRIVATE-TOKEN": GITLAB_TOKEN}



def github_create_branch(owner, repo, new_branch, from_branch="main"):
    ref_resp = requests.get(
        f"{GITHUB_API}/repos/{owner}/{repo}/git/ref/heads/{from_branch}",
        headers=_github_headers(),
    )
    ref_resp.raise_for_status()
    sha = ref_resp.json()["object"]["sha"]


    resp = requests.post(
        f"{GITHUB_API}/repos/{owner}/{repo}/git/refs",
        headers=_github_headers(),
        json={"ref": f"refs/heads/{new_branch}", "sha": sha},
    )
    if resp.status_code >= 400:
        return f"Error creating branch: {resp.status_code} {resp.text}"
    return f"Branch '{new_branch}' created from '{from_branch}' at {sha[:7]}."



def github_push_file(owner, repo, path, content, message, branch):
    get_resp = requests.get(
        f"{GITHUB_API}/repos/{owner}/{repo}/contents/{path}",
        headers=_github_headers(),
        params={"ref": branch},
    )
    sha = get_resp.json().get("sha") if get_resp.status_code == 200 else None


    payload = {
        "message": message,
        "content": base64.b64encode(content.encode()).decode(),
        "branch": branch,
    }
    if sha:
        payload["sha"] = sha


    resp = requests.put(
        f"{GITHUB_API}/repos/{owner}/{repo}/contents/{path}",
        headers=_github_headers(),
        json=payload,
    )
    if resp.status_code >= 400:
        return f"Error pushing file: {resp.status_code} {resp.text}"
    commit_sha = resp.json().get("commit", {}).get("sha", "unknown")
    return f"Committed '{path}' to branch '{branch}' (commit {commit_sha[:7]})."



def github_open_pull_request(owner, repo, title, head, base, body=""):
    resp = requests.post(
        f"{GITHUB_API}/repos/{owner}/{repo}/pulls",
        headers=_github_headers(),
        json={"title": title, "head": head, "base": base, "body": body},
    )
    if resp.status_code >= 400:
        return f"Error opening PR: {resp.status_code} {resp.text}"
    pr = resp.json()
    return f"Pull request #{pr['number']} opened: {pr['html_url']}"



def github_create_issue(owner, repo, title, body=""):
    resp = requests.post(
        f"{GITHUB_API}/repos/{owner}/{repo}/issues",
        headers=_github_headers(),
        json={"title": title, "body": body},
    )
    if resp.status_code >= 400:
        return f"Error creating issue: {resp.status_code} {resp.text}"
    issue = resp.json()
    return f"Issue #{issue['number']} created: {issue['html_url']}"



def gitlab_create_branch(project_id, new_branch, ref="main"):
    resp = requests.post(
        f"{GITLAB_API}/projects/{project_id}/repository/branches",
        headers=_gitlab_headers(),
        params={"branch": new_branch, "ref": ref},
    )
    if resp.status_code >= 400:
        return f"Error creating branch: {resp.status_code} {resp.text}"
    return f"Branch '{new_branch}' created from '{ref}'."



def gitlab_push_file(project_id, file_path, content, commit_message, branch):
    encoded_path = requests.utils.quote(file_path, safe="")


    check_resp = requests.get(
        f"{GITLAB_API}/projects/{project_id}/repository/files/{encoded_path}",
        headers=_gitlab_headers(),
        params={"ref": branch},
    )


    payload = {
        "branch": branch,
        "content": content,
        "commit_message": commit_message,
    }


    if check_resp.status_code == 200:
        resp = requests.put(
            f"{GITLAB_API}/projects/{project_id}/repository/files/{encoded_path}",
            headers=_gitlab_headers(),
            json=payload,
        )
    else:
        resp = requests.post(
            f"{GITLAB_API}/projects/{project_id}/repository/files/{encoded_path}",
            headers=_gitlab_headers(),
            json=payload,
        )


    if resp.status_code >= 400:
        return f"Error pushing file: {resp.status_code} {resp.text}"
    return f"Committed '{file_path}' to branch '{branch}' in project {project_id}."



def gitlab_open_merge_request(project_id, title, source_branch, target_branch, description=""):
    resp = requests.post(
        f"{GITLAB_API}/projects/{project_id}/merge_requests",
        headers=_gitlab_headers(),
        json={
            "title": title,
            "source_branch": source_branch,
            "target_branch": target_branch,
            "description": description,
        },
    )
    if resp.status_code >= 400:
        return f"Error opening MR: {resp.status_code} {resp.text}"
    mr = resp.json()
    return f"Merge request !{mr['iid']} opened: {mr['web_url']}"



def gitlab_create_issue(project_id, title, description=""):
    resp = requests.post(
        f"{GITLAB_API}/projects/{project_id}/issues",
        headers=_gitlab_headers(),
        json={"title": title, "description": description},
    )
    if resp.status_code >= 400:
        return f"Error creating issue: {resp.status_code} {resp.text}"
    issue = resp.json()
    return f"Issue #{issue['iid']} created: {issue['web_url']}"



REPO_TOOL_FUNCS = {
    "github_create_branch": github_create_branch,
    "github_push_file": github_push_file,
    "github_open_pull_request": github_open_pull_request,
    "github_create_issue": github_create_issue,
    "gitlab_create_branch": gitlab_create_branch,
    "gitlab_push_file": gitlab_push_file,
    "gitlab_open_merge_request": gitlab_open_merge_request,
    "gitlab_create_issue": gitlab_create_issue,
}


REPO_TOOL_DEFINITIONS = [
    {"type": "function", "function": {
        "name": "github_create_branch",
        "description": "Create a new branch in a GitHub repository from an existing branch.",
        "parameters": {"type": "object", "properties": {
            "owner": {"type": "string"}, "repo": {"type": "string"},
            "new_branch": {"type": "string"}, "from_branch": {"type": "string", "default": "main"},
        }, "required": ["owner", "repo", "new_branch"]}}},
    {"type": "function", "function": {
        "name": "github_push_file",
        "description": "Create or update a file's content on a branch in a GitHub repository.",
        "parameters": {"type": "object", "properties": {
            "owner": {"type": "string"}, "repo": {"type": "string"}, "path": {"type": "string"},
            "content": {"type": "string"}, "message": {"type": "string"}, "branch": {"type": "string"},
        }, "required": ["owner", "repo", "path", "content", "message", "branch"]}}},
    {"type": "function", "function": {
        "name": "github_open_pull_request",
        "description": "Open a pull request in a GitHub repository.",
        "parameters": {"type": "object", "properties": {
            "owner": {"type": "string"}, "repo": {"type": "string"}, "title": {"type": "string"},
            "head": {"type": "string"}, "base": {"type": "string"}, "body": {"type": "string"},
        }, "required": ["owner", "repo", "title", "head", "base"]}}},
    {"type": "function", "function": {
        "name": "github_create_issue",
        "description": "Create an issue in a GitHub repository.",
        "parameters": {"type": "object", "properties": {
            "owner": {"type": "string"}, "repo": {"type": "string"},
            "title": {"type": "string"}, "body": {"type": "string"},
        }, "required": ["owner", "repo", "title"]}}},
    {"type": "function", "function": {
        "name": "gitlab_create_branch",
        "description": "Create a new branch in a GitLab project from an existing ref.",
        "parameters": {"type": "object", "properties": {
            "project_id": {"type": "string"}, "new_branch": {"type": "string"},
            "ref": {"type": "string", "default": "main"},
        }, "required": ["project_id", "new_branch"]}}},
    {"type": "function", "function": {
        "name": "gitlab_push_file",
        "description": "Create or update a file's content on a branch in a GitLab project.",
        "parameters": {"type": "object", "properties": {
            "project_id": {"type": "string"}, "file_path": {"type": "string"},
            "content": {"type": "string"}, "commit_message": {"type": "string"}, "branch": {"type": "string"},
        }, "required": ["project_id", "file_path", "content", "commit_message", "branch"]}}},
    {"type": "function", "function": {
        "name": "gitlab_open_merge_request",
        "description": "Open a merge request in a GitLab project.",
        "parameters": {"type": "object", "properties": {
            "project_id": {"type": "string"}, "title": {"type": "string"},
            "source_branch": {"type": "string"}, "target_branch": {"type": "string"},
            "description": {"type": "string"},
        }, "required": ["project_id", "title", "source_branch", "target_branch"]}}},
    {"type": "function", "function": {
        "name": "gitlab_create_issue",
        "description": "Create an issue in a GitLab project.",
        "parameters": {"type": "object", "properties": {
            "project_id": {"type": "string"}, "title": {"type": "string"}, "description": {"type": "string"},
        }, "required": ["project_id", "title"]}}},
]


REPO_RISKY_TOOLS = {
    "github_create_branch", "github_push_file", "github_open_pull_request", "github_create_issue",
    "gitlab_create_branch", "gitlab_push_file", "gitlab_open_merge_request", "gitlab_create_issue",
}
