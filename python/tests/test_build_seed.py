import json

from build_seed import SEED_DIR, build, energy_v1, sql


def test_seed_is_up_to_date():
    seed, uploads = build()
    assert seed == (SEED_DIR / "seed.sql").read_text(), "run: uv run build_seed.py"
    assert uploads == json.loads((SEED_DIR / "r2-uploads.json").read_text())


def test_sql_quoting_keeps_one_statement_per_line():
    assert sql("it's\nfine") == "'it''s' || char(10) || 'fine'"
    assert sql(None) == "NULL"
    assert sql(1.5) == "1.5"


def test_energy_formatting_matches_php():
    assert energy_v1(2574.0) == "2574 eV"
    assert energy_v1(-10.000000149) == "-10 eV"
    assert energy_v1(92.3500001) == "92.35 eV"
