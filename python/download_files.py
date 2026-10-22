# /// script
# requires-python = ">=3.12"
# dependencies = []
# ///
"""Download every spectrum file listed in the recorded API into data/cache/files/, keeping the URL path."""

import hashlib
import json
import sys
import urllib.parse

from record_api import OUT as API_FIXTURES, ROOT, get

CACHE = ROOT / "data" / "cache" / "files"
MANIFEST = ROOT / "data" / "fixtures" / "files.json"


def main():
    spectra = json.loads((API_FIXTURES / "spectra" / "all.json").read_text())["body"]
    manifest = []
    for s in sorted(spectra, key=lambda s: s["id"]):
        url = s["download_link"]
        rel = urllib.parse.unquote(urllib.parse.urlparse(url).path).lstrip("/")
        dest = CACHE / rel
        if not dest.exists():
            status, _, data, _ = get(url)
            if status != 200:
                print(f"FAILED {status} {url}", file=sys.stderr)
                continue
            dest.parent.mkdir(parents=True, exist_ok=True)
            dest.write_bytes(data)
        data = dest.read_bytes()
        manifest.append({
            "spectrum_id": s["id"],
            "url": url,
            "path": rel,
            "bytes": len(data),
            "sha256": hashlib.sha256(data).hexdigest(),
        })
    MANIFEST.write_text(json.dumps(manifest, indent=1) + "\n")
    print(f"{len(manifest)} files, {sum(m['bytes'] for m in manifest)} bytes")


if __name__ == "__main__":
    main()
