---
title: "0026. Metadata harvesting"
description: "EELSdb serves OAI-PMH, DCAT-AP and schema.org metadata, with page URLs as identifiers."
adr:
  date: 2026-10-22
---

## Context

Recherche Data Gouv is the national research data platform of France and runs on Dataverse. It asked for OAI-PMH, preferably `oai_datacite`. It also pointed at DCAT-AP, which is the direction EOSC is taking. schema.org `Dataset` markup gets spectra into Google Dataset Search. EELSdb does not mint DOIs ([ADR 0006](/docs/adr/0006-no-hard-external-dependencies/)).

## Decision

- One mapping module, `worker/src/api/metadata.ts`, serves all formats. `toRecord(bundle)` builds a format-neutral record from the same queries as API v2, never v1. Four serialisers turn the record into Dublin Core, DataCite, DCAT-AP JSON-LD and schema.org JSON-LD.
- The identifiers are page URLs. The DOI of the EELSdb paper is a related identifier. A creator entry includes an ORCID iD only when the user shows their links publicly. The publisher is "EELSdb", as an organisation. Each spectrum carries its own licence ([ADR 0023](/docs/adr/0023-licences/)).
- OAI-PMH runs at `https://api.eelsdb.eu/oai` and accepts GET and POST.
  - It supports all six verbs.
  - Identifiers have the form `oai:eelsdb.eu:{id}`.
  - It serves all published spectra, gas phase included.
  - Sets are hierarchical (`type`, `type:coreloss`, `technique`, `technique:eels`, …).
  - The formats are `oai_dc` and `oai_datacite`.
  - Each page has 100 records.
  - Resumption tokens carry the last id, not an offset. Spectra published during a harvest therefore do not shift pages.
  - `deletedRecord` is `no`, because there are no tombstones.
  - `oai_datacite` is the bare DataCite kernel-4 `resource`, as Dataverse's own OAI server serves it. It is not the older wrapper with a `datacentreSymbol`. The page URL goes in `<identifier identifierType="URL">`. The XSD allows this and the records validate. Harvesters that insist on DOIs will reject them.
- Each published spectrum page has `Dataset` JSON-LD for schema.org. The home page has `DataCatalog` JSON-LD. `/sitemap.xml` lists the pages with `lastmod`. JSON-LD inside `<script>` escapes `<`.
- The DCAT-AP 3.0 catalogue is at `/dcat/catalog.jsonld` (paged). Each spectrum has a record at `/dcat/spectra/{id}.jsonld`.
  - Paging uses the Hydra terms that ckanext-dcat writes (`hydra:nextPage`, `hydra:totalItems`). CKAN and piveau follow these terms.
  - Linked IRIs carry their class inline, because the SHACL shapes check classes without loading the EU vocabularies.
  - DM3/DM4 have no EU file-type entry, so they get no `dct:format`. MSA uses `TXT` plus its media type.
- API v2 and the browse page accept `updated_since`. We chose this over a separate harvest API.
- The "modified" date must be reliable. It is `MAX(published_at, COALESCE(updated_at, published_at))`. Every write path that a reader would see bumps `updated_at`, including file and processed-version changes. Each path has a test. A profile save marks the owner's spectra as changed only when the name, username or "show links" setting changes.

## Consequences

- Tests check the output against official schemas. They check 9 OAI responses against the official XSDs with `lxml`. They check the DCAT catalogue against the SEMIC DCAT-AP 3.0 SHACL shapes with `pyshacl`. The schemas are vendored into `python/tests/data/schemas/` (284 KB). These tests run when `EELSDB_API` points at a running Worker.
- Incremental harvests do not see withdrawals. To move `deletedRecord` to `persistent`, EELSdb needs a `withdrawn_at` record.
- After cut-over, people must do these tasks:
  - Give Recherche Data Gouv the OAI base URL.
  - Submit the sitemap to Google Search Console.
  - Check pages with the schema.org validator and the Rich Results Test.
  - Ask which national portal harvests DCAT-AP for data.europa.eu.
  - Optionally, register with openarchives.org and BASE.

## Alternatives considered

- Offer only `oai_dc` until Recherche Data Gouv replies. `oai_datacite` costs little, and we can drop it if nobody wants it.
- Wait for a request before adding DCAT-AP and schema.org. Both are cheap to add from the shared mapping. They reach Google Dataset Search and European portals without anyone asking.
- Turtle or RDF/XML, SPARQL, `oai_ddi` and `dataverse_json`. These are out of scope. JSON-LD is valid RDF.
- Serve OAI-PMH and DCAT-AP under API v2 (`/v2/oai`, `/v2/dcat`), so that the whole API sits under one version. We did not do this, for these reasons:
  - The formats follow external standards (OAI-PMH 2.0, DCAT-AP 3.0) that have their own versions. A new API version changes our JSON contract, not these formats, but it would force their paths to move or stay under a deprecated prefix.
  - Harvester operators register base URLs by hand, in Recherche Data Gouv, OpenAIRE, BASE and national DCAT portals. A changed path means asking each one to update it. API v1 ([ADR 0008](/docs/adr/0008-api-v1-frozen-contract/)) shows how long old paths must then stay alive.
  - The generated API v2 reference would not describe them well either way. OAI-PMH is one URL that selects its XML responses by a `verb` argument, which OpenAPI cannot express usefully. The docs describe both endpoints on their own reference page.
