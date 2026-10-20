import json

from eelsdb.legacy.record_api import OUT, find_key, unpublished


def fixtures():
    return [(p, json.loads(p.read_text())) for p in sorted(OUT.rglob("*.json"))]


def test_find_key_nested():
    assert find_key({"a": [{"b": {"email": "x"}}]}, "email")
    assert not find_key({"a": [{"emails_sent": 1}]}, "email")


def test_no_fixture_contains_email():
    found = fixtures()
    assert len(found) > 400
    for path, fixture in found:
        assert not find_key(fixture, "email"), path


def test_no_fixture_contains_unpublished_spectra():
    published = {s["id"] for s in json.loads((OUT / "spectra" / "all.json").read_text())["body"]}
    assert len(published) == 290
    for path, fixture in fixtures():
        assert not unpublished(fixture.get("body"), published), path
        assert set(fixture.get("body_ids", [])) <= published, path
