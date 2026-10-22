from typing import Annotated, Any
from uuid import UUID
from fastapi import APIRouter, Depends, Header, HTTPException, Request, Response
from app.auth.dependencies import current_user
from app.core.config import settings
from app.core.project_policy import parse_revision, write_origin_allowed
from app.db.core import projects_repository as repo
from app.schemas.projects import ProjectCreate, ProjectUpdate, ProjectResponse, ProjectList, ProjectDeleted

router = APIRouter(prefix="/v1/projects", tags=["projects"])

def _run(function, *args, **kwargs):
    try:
        return function(*args, **kwargs)
    except repo.ProjectNotFound as exc:
        raise HTTPException(status_code=404, detail="Project not found") from exc
    except repo.ProjectGone as exc:
        raise HTTPException(status_code=410, detail="Project has been soft-deleted") from exc
    except repo.ProjectConflict as exc:
        raise HTTPException(status_code=412, detail="Project revision changed; reload before retrying") from exc

def expected_revision(if_match: Annotated[str | None, Header(alias="If-Match")] = None) -> int:
    if if_match is None:
        raise HTTPException(status_code=428, detail="If-Match is required")
    try:
        return parse_revision(if_match)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

async def project_writer(request: Request, user: dict[str, Any] = Depends(current_user)):
    if not write_origin_allowed(request.headers.get("origin"), request.headers.get("authorization"),
                                [settings.FRONTEND_ORIGIN, *settings.CORS_ALLOW_ORIGINS]):
        raise HTTPException(status_code=403, detail="Cookie-authenticated project writes require a trusted Origin")
    return user

def _headers(response: Response, revision: int | None = None):
    response.headers["Cache-Control"] = "no-store"
    if revision is not None:
        response.headers["ETag"] = f'"{revision}"'

@router.get("", response_model=ProjectList)
def list_projects(response: Response, user=Depends(current_user)):
    _headers(response)
    return {"projects": _run(repo.list_projects, user["user_id"])}

@router.post("", status_code=201, response_model=ProjectResponse)
def create_project(body: ProjectCreate, response: Response, user=Depends(project_writer)):
    result = _run(repo.create_project, user["user_id"], body)
    _headers(response, result["revision"])
    return result

@router.get("/{project_id}", response_model=ProjectResponse)
def get_project(project_id: UUID, response: Response, user=Depends(current_user)):
    result = _run(repo.get_project, user["user_id"], str(project_id))
    _headers(response, result["revision"])
    return result

@router.patch("/{project_id}", response_model=ProjectResponse)
def update_project(body: ProjectUpdate, project_id: UUID, response: Response,
                   revision: int = Depends(expected_revision), user=Depends(project_writer)):
    result = _run(repo.mutate_project, user["user_id"], str(project_id), revision, body)
    _headers(response, result["revision"])
    return result

@router.delete("/{project_id}", response_model=ProjectDeleted)
def delete_project(project_id: UUID, response: Response,
                   revision: int = Depends(expected_revision), user=Depends(project_writer)):
    result = _run(repo.mutate_project, user["user_id"], str(project_id), revision, deleting=True)
    _headers(response, result["revision"])
    return {"id": result["id"], "status": "deleted"}
