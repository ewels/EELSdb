# /// script
# requires-python = ">=3.12"
# dependencies = []
# ///
"""Export the accounts to keep from the WordPress database dump. Personal data: output goes to data/private/ only.

Needs the dump loaded into a local MariaDB container (it is never read directly):

    docker run -d --name eelsdb-dump -e MARIADB_ROOT_PASSWORD=local -e MARIADB_DATABASE=eelsdb mariadb:latest
    docker exec -i eelsdb-dump mariadb -uroot -plocal eelsdb < ../EELSdb/localhost.sql
    uv run python/export_accounts.py [--with-passwords]

Writes data/private/accounts.sql (users, favourites, spectrum owners) and data/private/review.csv
(accounts a person should look at). Prints counts only, never rows.
"""

import argparse
import csv
import json
import os
import re
import subprocess
from collections import Counter

from build_seed import insert, sql
from record_api import ROOT

PRIVATE = ROOT / "data" / "private"
PREFIX = "QUnCYkNw_"
CUTOFF = "2024-01-01"
RANDOM_NAME = re.compile(r"^[A-Za-z]{6,} [A-Za-z]{6,}$")


_database = None


def query(statement, database=None):
    """Rows as dicts, via the mariadb client in the container (no Python driver needed)."""
    container = os.environ.get("EELSDB_DUMP_CONTAINER", "eelsdb-dump")
    password = os.environ.get("EELSDB_DUMP_PASSWORD", "local")
    cmd = ["docker", "exec", container, "mariadb", "-uroot", f"-p{password}", "--batch", "--raw"]
    if database is not False:
        cmd.append(database or wordpress_database())
    res = subprocess.run([*cmd, "-e", statement], capture_output=True, text=True)
    if res.returncode:
        raise RuntimeError(f"mariadb: {res.stderr.strip()}")
    out = res.stdout
    lines = out.split("\n")
    header = lines[0].split("\t")
    return [dict(zip(header, (None if v == "NULL" else v for v in line.split("\t")))) for line in lines[1:] if line]


def wordpress_database():
    """The dump creates its own database; find the one holding the WordPress tables."""
    global _database
    if _database is None:
        rows = query(f"SELECT table_schema FROM information_schema.tables WHERE table_name = '{PREFIX}users'", database=False)
        if not rows:
            raise RuntimeError(f"No {PREFIX}users table found. Is the dump loaded?")
        _database = os.environ.get("EELSDB_DUMP_DB") or rows[0]["table_schema"]
    return _database


def php_unserialize(s):
    """Minimal PHP unserialize for the scalars and arrays WordPress stores in user meta."""
    if not s:
        return None
    pos = 0

    def read_until(ch):
        nonlocal pos
        end = s.index(ch, pos)
        v = s[pos:end]
        pos = end + 1
        return v

    def value():
        nonlocal pos
        kind = s[pos]
        pos += 2
        if kind == "N":
            return None
        if kind == "i":
            return int(read_until(";"))
        if kind == "d":
            return float(read_until(";"))
        if kind == "b":
            return read_until(";") == "1"
        if kind == "s":
            n = int(read_until(":"))
            # Lengths are in bytes.
            raw = s[pos + 1:].encode()[:n].decode(errors="replace")
            pos += 1 + len(raw) + 2
            return raw
        if kind == "a":
            n = int(read_until(":"))
            pos += 1  # "{"
            out = {}
            for _ in range(n):
                k = value()
                out[k] = value()
            pos += 1  # "}"
            return list(out.values()) if list(out) == list(range(n)) else out
        raise ValueError(f"unsupported PHP type {kind!r}")

    try:
        return value()
    except (ValueError, IndexError):
        return None


def classify(u):
    """('keep' | 'review' | 'drop', reason) for one account summary.

    u: display_name, registered (YYYY-MM-DD...), is_admin, owns_spectra (published or private),
    old_forum_posts, new_forum_posts, spam_submissions_only, favourites.
    """
    if u["is_admin"] or u["owns_spectra"] or u["old_forum_posts"]:
        return "keep", "contributor"
    name = u["display_name"] or ""
    if (RANDOM_NAME.match(name) and re.search(r"[a-z][A-Z]", name)) or u["new_forum_posts"] or u["spam_submissions_only"]:
        return "drop", "spam"
    if (u["registered"] or "") < CUTOFF:
        return "keep", "older"
    if u["favourites"]:
        return "review", "newer with favourites"
    return "review", "newer, no activity"


def fetch_accounts():
    users = query(f"SELECT ID, user_login, user_nicename, user_email, user_registered, display_name, user_pass FROM {PREFIX}users")
    meta = {}
    for m in query(
        f"""SELECT user_id, meta_key, meta_value FROM {PREFIX}usermeta
            WHERE meta_key IN ('{PREFIX}capabilities', 'u_lab', 'u_country', 'orcid', 'eelsdb_favourites', 'microscope_presets')"""
    ):
        # Favourites and presets have one row each; the rest one row per user.
        if m["meta_key"] in ("eelsdb_favourites", "microscope_presets"):
            meta.setdefault(m["user_id"], {}).setdefault(m["meta_key"], []).append(m["meta_value"])
        else:
            meta.setdefault(m["user_id"], {})[m["meta_key"]] = m["meta_value"]
    posts = query(
        f"""SELECT post_author, post_type, post_status, LEFT(post_date, 10) AS day, ID FROM {PREFIX}posts
            WHERE post_type IN ('spectra', 'topic', 'reply')"""
    )
    by_author = {}
    for p in posts:
        by_author.setdefault(p["post_author"], []).append(p)
    return users, meta, by_author


def summarise(user, meta, posts):
    caps = php_unserialize(meta.get(f"{PREFIX}capabilities")) or {}
    favs = []
    for value in meta.get("eelsdb_favourites", []):
        parsed = php_unserialize(value)
        favs += parsed if isinstance(parsed, list) else list(parsed.values()) if isinstance(parsed, dict) else [value]
    spectra = [p for p in posts if p["post_type"] == "spectra"]
    forum = [p for p in posts if p["post_type"] in ("topic", "reply") and p["post_status"] == "publish"]
    owned = [p for p in spectra if p["post_status"] in ("publish", "private")]
    return {
        "display_name": user["display_name"],
        "registered": user["user_registered"],
        "is_admin": isinstance(caps, dict) and bool(caps.get("administrator")),
        "owns_spectra": bool(owned),
        "old_forum_posts": sum(p["day"] < CUTOFF for p in forum),
        "new_forum_posts": sum(p["day"] >= CUTOFF for p in forum),
        "spam_submissions_only": bool(spectra) and not owned,
        "favourites": sorted({int(f) for f in favs if str(f).strip().isdigit()}),
        "owned_ids": [int(p["ID"]) for p in owned],
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("--with-passwords", action="store_true", help="include legacy password hashes")
    args = parser.parse_args()

    users, meta, by_author = fetch_accounts()
    groups = Counter()
    lines = ["-- Generated by python/export_accounts.py. Personal data: never commit."]
    review = []
    for user in users:
        m = meta.get(user["ID"], {})
        s = summarise(user, m, by_author.get(user["ID"], []))
        action, reason = classify(s)
        groups[(action, reason)] += 1
        if action == "drop":
            continue
        if action == "review":
            review.append({"id": user["ID"], "login": user["user_login"], "display_name": user["display_name"],
                           "email": user["user_email"], "registered": user["user_registered"],
                           "favourites": len(s["favourites"]), "reason": reason})
            continue
        uid = int(user["ID"])
        presets = [php_unserialize(v) or v for v in m.get("microscope_presets", [])]
        lines.append(insert("users", {
            "id": uid,
            "slug": user["user_nicename"],
            "display_name": user["display_name"] or user["user_login"],
            "affiliation": m.get("u_lab") or None,
            "country": m.get("u_country") or None,
            "orcid": (m.get("orcid") or "").rstrip("/").rsplit("/", 1)[-1] or None,
            "created_at": user["user_registered"],
            "role": "admin" if s["is_admin"] else "user",
            "legacy_login": user["user_login"],
            "legacy_email": user["user_email"],
            "legacy_password_hash": user["user_pass"] if args.with_passwords else None,
            "legacy_presets_json": json.dumps(presets) if presets else None,
        }))
        for sid in s["favourites"]:
            lines.append(f"INSERT OR IGNORE INTO favourites (user_id, spectrum_id) SELECT {uid}, id FROM spectra WHERE id = {sql(sid)};")
        for sid in s["owned_ids"]:
            lines.append(f"UPDATE spectra SET owner_id = {uid} WHERE id = {sid};")

    PRIVATE.mkdir(parents=True, exist_ok=True)
    (PRIVATE / "accounts.sql").write_text("\n".join(lines) + "\n")
    with open(PRIVATE / "review.csv", "w", newline="") as fh:
        writer = csv.DictWriter(fh, fieldnames=["id", "login", "display_name", "email", "registered", "favourites", "reason"])
        writer.writeheader()
        writer.writerows(review)
    print(f"{len(users)} accounts")
    for (action, reason), n in sorted(groups.items()):
        print(f"  {action:6} {reason}: {n}")


if __name__ == "__main__":
    main()
