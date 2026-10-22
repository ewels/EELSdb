"""OAI-PMH responses must validate against the official XSDs, and the DCAT-AP catalogue against the SEMIC SHACL shapes.

Skipped unless EELSDB_API points at a local Worker, for example:

    cd worker && npm run seed && npm run dev
    EELSDB_API=http://api.localhost:8787 uv run pytest tests/test_harvest_formats.py

The schemas in tests/data/schemas are copies of the published ones (OAI-PMH 2.0, oai_dc, DataCite kernel 4,
DCAT-AP 3.0.1), with remote imports pointed at the local copies.
"""

import os
import urllib.request
from pathlib import Path

import pytest

API = os.environ.get("EELSDB_API")
pytestmark = pytest.mark.skipif(not API, reason="EELSDB_API is not set")

SCHEMAS = Path(__file__).parent / "data" / "schemas"

# One schema set for whole responses: OAI-PMH.xsd checks <metadata> strictly, so it needs every format's schema too.
DRIVER = f"""<?xml version="1.0"?>
<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema" targetNamespace="urn:eelsdb:driver">
  <xs:import namespace="http://www.openarchives.org/OAI/2.0/" schemaLocation="{SCHEMAS / "OAI-PMH.xsd"}"/>
  <xs:import namespace="http://www.openarchives.org/OAI/2.0/oai_dc/" schemaLocation="{SCHEMAS / "oai_dc.xsd"}"/>
  <xs:import namespace="http://www.openarchives.org/OAI/2.0/oai-identifier" schemaLocation="{SCHEMAS / "oai-identifier.xsd"}"/>
  <xs:import namespace="http://datacite.org/schema/kernel-4" schemaLocation="{SCHEMAS / "datacite" / "metadata.xsd"}"/>
</xs:schema>"""


def get(path):
    with urllib.request.urlopen(f"{API}{path}") as res:
        return res.read()


@pytest.fixture(scope="module")
def schema():
    from lxml import etree

    return etree.XMLSchema(etree.fromstring(DRIVER.encode()))


@pytest.mark.parametrize(
    "query",
    [
        "verb=Identify",
        "verb=ListMetadataFormats",
        "verb=ListSets",
        "verb=ListIdentifiers&metadataPrefix=oai_dc",
        "verb=ListRecords&metadataPrefix=oai_dc",
        "verb=ListRecords&metadataPrefix=oai_datacite",
        "verb=GetRecord&identifier=oai:eelsdb.eu:22236&metadataPrefix=oai_datacite",
        "verb=Nope",
        "verb=ListRecords&metadataPrefix=marc21",
    ],
)
def test_oai_responses_validate(schema, query):
    from lxml import etree

    doc = etree.fromstring(get(f"/oai?{query}"))
    assert schema.validate(doc), "\n".join(str(e) for e in schema.error_log)


def test_dcat_catalogue_conforms_to_dcat_ap():
    from pyshacl import validate
    from rdflib import Graph

    data = Graph().parse(data=get("/dcat/catalog.jsonld"), format="json-ld")
    assert len(data) > 1000
    shapes = Graph().parse(SCHEMAS / "dcat-ap-SHACL.ttl", format="turtle")
    conforms, _, report = validate(data, shacl_graph=shapes, inference="none")
    assert conforms, report
