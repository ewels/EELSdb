"""Talks to the EELSdb token API (api.eelsdb.eu/cli/) with the standard library only."""

import json
import os
import uuid
import urllib.error
import urllib.request
from pathlib import Path

from eelsdb import __version__

DEFAULT_API = "https://api.eelsdb.eu"
CONFIG = Path(os.environ.get("XDG_CONFIG_HOME", Path.home() / ".config")) / "eelsdb" / "config.json"


class ApiError(Exception):
    def __init__(self, status, message, errors=None):
        super().__init__(f"{status}: {message}")
        self.status, self.message, self.errors = status, message, errors or {}


def load_config():
    cfg = json.loads(CONFIG.read_text()) if CONFIG.exists() else {}
    return {
        "api": os.environ.get("EELSDB_API") or cfg.get("api") or DEFAULT_API,
        "token": os.environ.get("EELSDB_TOKEN") or cfg.get("token"),
    }


def save_config(api, token):
    CONFIG.parent.mkdir(parents=True, exist_ok=True)
    CONFIG.write_text(json.dumps({"api": api, "token": token}, indent=1))
    CONFIG.chmod(0o600)


def site_url(api):
    """The website for an API address: https://api.eelsdb.eu -> https://eelsdb.eu."""
    return api.replace("://api.", "://", 1)


def multipart(fields, files):
    """(body, content type) for form fields and {name: Path} files."""
    boundary = uuid.uuid4().hex
    parts = []
    for name, value in fields.items():
        if value is None or value == "":
            continue
        parts.append(f'--{boundary}\r\nContent-Disposition: form-data; name="{name}"\r\n\r\n{value}\r\n'.encode())
    for name, path in files.items():
        path = Path(path)
        head = f'--{boundary}\r\nContent-Disposition: form-data; name="{name}"; filename="{path.name}"\r\n'
        head += "Content-Type: application/octet-stream\r\n\r\n"
        parts.append(head.encode() + path.read_bytes() + b"\r\n")
    parts.append(f"--{boundary}--\r\n".encode())
    return b"".join(parts), f"multipart/form-data; boundary={boundary}"


class Client:
    def __init__(self, api=None, token=None):
        cfg = load_config()
        self.api = (api or cfg["api"]).rstrip("/")
        self.token = token or cfg["token"]

    def request(self, method, path, body=None, content_type=None, raw=False):
        headers = {"User-Agent": f"eelsdb-python/{__version__}"}
        if self.token:
            headers["Authorization"] = f"Bearer {self.token}"
        if isinstance(body, (dict, list)):
            body, content_type = json.dumps(body).encode(), "application/json"
        if content_type:
            headers["Content-Type"] = content_type
        req = urllib.request.Request(f"{self.api}/cli{path}", data=body, method=method, headers=headers)
        try:
            with urllib.request.urlopen(req, timeout=120) as res:
                data = res.read()
        except urllib.error.HTTPError as e:
            try:
                payload = json.loads(e.read())
            except ValueError:
                payload = {}
            raise ApiError(e.code, payload.get("message", e.reason), payload.get("errors")) from None
        return data if raw else json.loads(data)

    def me(self):
        return self.request("GET", "/me")

    def submit(self, fields, file, companion=None):
        files = {"file": file}
        if companion:
            files["companion_file"] = companion
        body, ctype = multipart(fields, files)
        return self.request("POST", "/submissions", body, ctype)

    def queue(self):
        return self.request("GET", "/queue")

    def submission(self, sid):
        return self.request("GET", f"/queue/{sid}")

    def download(self, sid, role, dest):
        Path(dest).write_bytes(self.request("GET", f"/queue/{sid}/files/{role}", raw=True))
        return Path(dest)

    def upload(self, sid, role, path):
        from urllib.parse import quote

        return self.request("PUT", f"/queue/{sid}/files/{role}?filename={quote(Path(path).name)}", Path(path).read_bytes(),
                            "application/octet-stream")

    def processing(self, sid, record):
        return self.request("POST", f"/queue/{sid}/processing", record)

    def decide(self, sid, decision, notes=None):
        return self.request("POST", f"/queue/{sid}/{decision}", {"notes": notes} if notes else {})
