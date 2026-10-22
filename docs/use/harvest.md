---
title: Harvest metadata
description: Collect EELSdb spectrum records into a repository or data catalogue with OAI-PMH, DCAT-AP or schema.org.
---

Repositories, data catalogues and search engines can collect the records of all published spectra in standard formats.
All formats describe the same record: the title, description, author, dates, licence, files and the paper the spectrum comes from.

EELSdb does not give spectra DOIs.
In every format, a spectrum is identified by the address of its page, such as `https://eelsdb.eu/spectra/hematite/`.
The DOI of the paper is a related identifier.
All data is under the [Open Database Licence (ODbL) 1.0](https://opendatacommons.org/licenses/odbl/1-0/).

## OAI-PMH

The base URL is `https://api.eelsdb.eu/oai`. It supports [OAI-PMH 2.0](https://www.openarchives.org/OAI/openarchivesprotocol.html) with GET and POST.

```sh
$ curl "https://api.eelsdb.eu/oai?verb=ListRecords&metadataPrefix=oai_dc"
```

- Formats (`metadataPrefix`)
  - `oai_dc`: Dublin Core.
  - `oai_datacite`: DataCite metadata schema 4. The `identifier` is the page address, of type `URL`, because there is no DOI.
- Identifiers
  - `oai:eelsdb.eu:` and the spectrum's number, such as `oai:eelsdb.eu:21751`.
- Sets
  - `type:coreloss`, `type:lowloss`, `type:zeroloss` and `type:xrayabs`.
  - `technique:eels` and `technique:xas`.
- Dates
  - The datestamp is the time a spectrum was published or last changed, in UTC, to the second.
  - Use `from` and `until` to collect only what changed.
- Pages
  - Each page has 100 records. Follow the `resumptionToken` to the next page.
- Deleted records
  - Not recorded (`deletedRecord` is `no`). A spectrum that a moderator withdraws is no longer listed, so harvest everything again now and then.

The records include gas-phase spectra.

## DCAT-AP

A [DCAT-AP 3.0](https://semiceu.github.io/DCAT-AP/releases/3.0.1/) catalogue of all published spectra, as JSON-LD:

```sh
$ curl "https://api.eelsdb.eu/dcat/catalog.jsonld"
```

- Pages
  - Each page has 100 datasets. The `hydra:PagedCollection` node gives `hydra:nextPage` and `hydra:totalItems`.
- One spectrum
  - `https://api.eelsdb.eu/dcat/spectra/21751.jsonld`. Each spectrum page also links to it with `<link rel="alternate" type="application/ld+json">`.
- Distributions
  - Each data file of a spectrum, with its download address, media type, size and SHA-256 checksum.

## schema.org and the sitemap

Each spectrum page contains a schema.org `Dataset` as JSON-LD, which Google Dataset Search reads.
The home page describes the whole database as a `DataCatalog`.
The sitemap at `https://eelsdb.eu/sitemap.xml` lists every published spectrum with the time it last changed.

## Authors' ORCID iDs

A record names the contributor's ORCID iD only if the contributor shows their links on their public profile.
