from __future__ import annotations

from collections.abc import Callable

import pytest

from app.tools import repo_tools

HeaderBuilder = Callable[[str | None], dict[str, str]]


@pytest.mark.parametrize(
    ("header_builder", "provider"),
    [
        (repo_tools._github_headers, "GitHub"),
        (repo_tools._gitlab_headers, "GitLab"),
    ],
)
@pytest.mark.parametrize("token", [None, "", "   "])
def test_provider_headers_require_dispatch_injected_token(
    header_builder: HeaderBuilder,
    provider: str,
    token: str | None,
) -> None:
    with pytest.raises(ValueError, match=f"{provider} credential is required"):
        header_builder(token)


def test_github_headers_use_injected_token() -> None:
    headers = repo_tools._github_headers("test-only-github-credential")

    assert headers == {
        "Accept": "application/vnd.github+json",
        "Authorization": "Bearer test-only-github-credential",
        "X-GitHub-Api-Version": "2022-11-28",
    }


def test_gitlab_headers_use_injected_token() -> None:
    headers = repo_tools._gitlab_headers("test-only-gitlab-credential")

    assert headers == {
        "PRIVATE-TOKEN": "test-only-gitlab-credential",
    }