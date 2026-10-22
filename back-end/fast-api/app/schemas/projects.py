from typing import Annotated, Literal
from pydantic import BaseModel, ConfigDict, Field, StringConstraints, field_validator, model_validator

ProjectType = Literal["frontend", "backend", "fullstack", "general"]
Language = Literal["javascript", "typescript", "python", "sql", "cpp"]
Framework = Literal["nextjs", "angular", "react"]
Name = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=255)]
Description = Annotated[str, StringConstraints(max_length=10000)]
SETTINGS_FIELDS = ("name", "description", "project_type", "languages", "frameworks", "runtimes", "database_categories")

class ProjectInput(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)

    @field_validator("name", "description", check_fields=False)
    @classmethod
    def no_null_bytes(cls, value):
        if value is not None and "\x00" in value:
            raise ValueError("NUL characters are not accepted")
        return value

    @field_validator("languages", "frameworks", "runtimes", "database_categories", check_fields=False)
    @classmethod
    def selections(cls, value):
        return sorted(set(value)) if value is not None else value

class ProjectCreate(ProjectInput):
    name: Name
    description: Description = ""
    project_type: ProjectType
    languages: list[Language] = Field(default_factory=list)
    frameworks: list[Framework] = Field(default_factory=list)
    runtimes: list[Literal["nodejs"]] = Field(default_factory=list)
    database_categories: list[Literal["nosql"]] = Field(default_factory=list)

class ProjectUpdate(ProjectInput):
    name: Name | None = None
    description: Description | None = None
    project_type: ProjectType | None = None
    languages: list[Language] | None = None
    frameworks: list[Framework] | None = None
    runtimes: list[Literal["nodejs"]] | None = None
    database_categories: list[Literal["nosql"]] | None = None

    @model_validator(mode="before")
    @classmethod
    def nonempty_nonnull(cls, value):
        if isinstance(value, dict) and (not value or any(v is None for v in value.values())):
            raise ValueError("Provide at least one non-null setting")
        return value

class ProjectResponse(ProjectCreate):
    id: str
    revision: int = Field(ge=1)
    status: Literal["active", "deleted"]

class ProjectList(BaseModel):
    projects: list[ProjectResponse]

class ProjectDeleted(BaseModel):
    id: str
    status: Literal["deleted"] = "deleted"
