from sqlalchemy import select, update
from app.db.base import current_time_ms, new_uuid
from app.db.database import db_session
from app.db.models.projects import Project, ProjectSettingsVersion
from app.schemas.projects import ProjectCreate, ProjectUpdate, SETTINGS_FIELDS

class ProjectNotFound(Exception):
    pass

class ProjectGone(Exception):
    pass

class ProjectConflict(Exception):
    pass

def _owned(session, owner_id: str, project_id: str) -> Project:
    project = session.scalar(select(Project).where(Project.id == project_id, Project.owner_id == owner_id))
    if project is None:
        raise ProjectNotFound()
    if project.status != "active":
        raise ProjectGone()
    return project

def _settings(project: Project) -> dict:
    return {key: getattr(project, key) for key in SETTINGS_FIELDS}

def _public(project: Project) -> dict:
    return {**_settings(project), "id": project.id, "revision": project.revision, "status": project.status}

def _snapshot(session, project: Project) -> None:
    session.add(ProjectSettingsVersion(project_id=project.id, revision=project.revision,
        settings_json=_settings(project), project_status=project.status,
        actor_id=project.owner_id, created_at=project.updated_at))

def list_projects(owner_id: str) -> list[dict]:
    with db_session() as session:
        rows = session.scalars(select(Project).where(Project.owner_id == owner_id, Project.status == "active")
                               .order_by(Project.updated_at.desc(), Project.id)).all()
        return [_public(row) for row in rows]

def get_project(owner_id: str, project_id: str) -> dict:
    with db_session() as session:
        return _public(_owned(session, owner_id, project_id))

def create_project(owner_id: str, payload: ProjectCreate) -> dict:
    with db_session() as session:
        now = current_time_ms()
        project = Project(id=new_uuid(), owner_id=owner_id, **payload.model_dump(),
                          revision=1, status="active", created_at=now, updated_at=now)
        session.add(project)
        session.flush()
        _snapshot(session, project)
        session.flush()
        return _public(project)

def mutate_project(owner_id: str, project_id: str, revision: int,
                   changes: ProjectUpdate | None = None, *, deleting: bool = False) -> dict:
    with db_session() as session:
        project = _owned(session, owner_id, project_id)
        if project.revision != revision:
            raise ProjectConflict()
        values = {} if deleting else changes.model_dump(exclude_unset=True)
        values.update(revision=revision + 1, updated_at=current_time_ms())
        if deleting:
            values.update(status="deleted", deleted_at=values["updated_at"], deleted_by=owner_id)
        result = session.execute(update(Project).where(Project.id == project_id,
            Project.owner_id == owner_id, Project.status == "active", Project.revision == revision)
            .values(**values).execution_options(synchronize_session=False))
        if result.rowcount != 1:
            raise ProjectConflict()
        session.expire(project)
        session.refresh(project)
        _snapshot(session, project)
        session.flush()
        return _public(project)
