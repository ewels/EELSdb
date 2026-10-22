import json
import zipfile

from export import build

API = "https://api.example"


def fake_fetcher(url):
    if url == f"{API}/v2/spectra?per_page=500&sort=id":
        return json.dumps({"results": [{"id": 1, "slug": "bn", "files": [{"url": "https://eelsdb.eu/wp-content/uploads/bn.msa", "filename": "../../evil.msa", "role": "legacy"}]}],
                           "next": f"{API}/v2/spectra?page=2"}).encode()
    if url == f"{API}/v2/spectra?page=2":
        return json.dumps({"results": [{"id": 2, "slug": "c", "files": []}], "next": None}).encode()
    if url.endswith("/wp-content/uploads/bn.msa"):
        return b"1, 2\n"
    raise AssertionError(url)


def test_build_archive(tmp_path):
    dest = tmp_path / "all.zip"
    assert build(dest, API, fetcher=fake_fetcher) == 2
    with zipfile.ZipFile(dest) as z:
        assert sorted(z.namelist()) == ["README.md", "metadata.json", "spectra/1-bn/bn.msa"]
        assert [s["id"] for s in json.loads(z.read("metadata.json"))] == [1, 2]
        assert "ODbL" in z.read("README.md").decode()
        assert z.read("spectra/1-bn/bn.msa") == b"1, 2\n"
