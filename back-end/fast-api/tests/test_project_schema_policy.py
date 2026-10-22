import pytest
from pydantic import ValidationError
from app.core.project_policy import parse_revision, parse_operator_ids, write_origin_allowed
from app.schemas.projects import ProjectCreate, ProjectUpdate

def payload(**overrides):
    return {"name": "Compiler", "project_type": "general", "languages": ["cpp"], **overrides}

def test_general_cpp():
    item = ProjectCreate.model_validate(payload())
    assert item.languages == ["cpp"] and item.frameworks == []

def test_independent_sorted_selections():
    item = ProjectCreate.model_validate(payload(languages=["python", "cpp", "python"], frameworks=["react"]))
    assert item.languages == ["cpp", "python"]

@pytest.mark.parametrize("field,value", [
    ("name", "  "), ("name", "n" * 256), ("name", "a\x00b"),
    ("description", "a\x00b"), ("description", "x" * 10001),
    ("project_type", "desktop"), ("languages", ["java"]),
    ("frameworks", ["express"]), ("runtimes", ["deno"]),
    ("database_categories", ["mongodb"]), ("name", 123)])
def test_invalid_fields(field, value):
    with pytest.raises(ValidationError):
        ProjectCreate.model_validate(payload(**{field: value}))

@pytest.mark.parametrize("field", ["owner_id", "revision", "status", "is_operator", "credentials"])
def test_server_fields_rejected(field):
    with pytest.raises(ValidationError):
        ProjectCreate.model_validate(payload(**{field: "untrusted"}))

def test_partial_update():
    assert ProjectUpdate(name="Renamed").model_dump(exclude_unset=True) == {"name": "Renamed"}

@pytest.mark.parametrize("data", [{}, {"description": None}, {"languages": None}])
def test_empty_null_patch(data):
    with pytest.raises(ValidationError):
        ProjectUpdate.model_validate(data)

def test_clear_fields():
    assert ProjectUpdate(languages=[], description="").model_dump(exclude_unset=True) == {"languages": [], "description": ""}

@pytest.mark.parametrize("header", ['1', '"0"', 'W/"1"', '*', '"1", "2"', '"-1"', '"9223372036854775807"', '"01"'])
def test_invalid_revision(header):
    with pytest.raises(ValueError):
        parse_revision(header)

def test_valid_revision():
    assert parse_revision('"12"') == 12

def test_operator_allowlist():
    identifier = "11111111-1111-1111-1111-111111111111"
    assert parse_operator_ids(identifier + "," + identifier) == frozenset([identifier])
    assert parse_operator_ids("") == frozenset()
    with pytest.raises(ValueError):
        parse_operator_ids("admin@example.com")

@pytest.mark.parametrize("origin", [None, "null", "https://evil.example", "http://localhost:3000.evil.example"])
def test_untrusted_origin(origin):
    assert not write_origin_allowed(origin, None, ["http://localhost:3000"])

def test_bearer_origin_policy():
    assert write_origin_allowed(None, "Bearer authenticated-elsewhere", [])
    assert not write_origin_allowed(None, "Bearer ", [])
    assert write_origin_allowed("http://localhost:3000", None, ["http://localhost:3000"])
