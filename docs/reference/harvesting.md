---
title: Harvesting endpoints
description: The OAI-PMH, DCAT-AP and schema.org endpoints of EELSdb, with their arguments, formats, paging and errors.
---

This page describes the endpoints that repositories, data catalogues and search engines use to collect EELSdb records.
To find out which one suits you, read [Harvest metadata](/docs/use/harvest/).

| Endpoint | Standard | Format |
| --- | --- | --- |
| `https://api.eelsdb.eu/oai` | [OAI-PMH 2.0](https://www.openarchives.org/OAI/openarchivesprotocol.html) | XML: Dublin Core or DataCite |
| `https://api.eelsdb.eu/dcat/catalog.jsonld` | [DCAT-AP 3.0](https://semiceu.github.io/DCAT-AP/releases/3.0.1/) | JSON-LD |
| `https://api.eelsdb.eu/dcat/spectra/{id}.jsonld` | DCAT-AP 3.0 | JSON-LD |
| Each spectrum page, and the home page | [schema.org](https://schema.org/Dataset) | JSON-LD in the HTML |
| `https://eelsdb.eu/sitemap.xml` | [Sitemaps](https://www.sitemaps.org/protocol.html) | XML |

These endpoints are not part of [API v2](/docs/use/api/) and have no version in their paths.
Their formats come from the standards, and their addresses are registered with harvesters, so they do not change when the API changes.

All endpoints list only published spectra, gas-phase spectra included.
All formats give the same record of a spectrum. See [What a record contains](#what-a-record-contains).

## OAI-PMH

The base URL is `https://api.eelsdb.eu/oai`.
Send the arguments as a query string (GET) or as a form body (POST, `application/x-www-form-urlencoded`).
Every response is `text/xml` with status 200, errors included.

```sh
$ curl "https://api.eelsdb.eu/oai?verb=Identify"
```

### Verbs

| Verb | Required arguments | Optional arguments |
| --- | --- | --- |
| `Identify` | | |
| `ListMetadataFormats` | | `identifier` |
| `ListSets` | | |
| `ListIdentifiers` | `metadataPrefix` | `from`, `until`, `set`, or only `resumptionToken` |
| `ListRecords` | `metadataPrefix` | `from`, `until`, `set`, or only `resumptionToken` |
| `GetRecord` | `identifier`, `metadataPrefix` | |

An argument that the verb does not take, or an argument given twice, is a `badArgument` error.

### Repository

`Identify` returns these values:

| Element | Value |
| --- | --- |
| `repositoryName` | `EELS Data Base` |
| `baseURL` | `https://api.eelsdb.eu/oai` |
| `protocolVersion` | `2.0` |
| `adminEmail` | `info@eelsdb.eu` |
| `earliestDatestamp` | The publication time of the oldest spectrum |
| `deletedRecord` | `no` |
| `granularity` | `YYYY-MM-DDThh:mm:ssZ` |
| `repositoryIdentifier` | `eelsdb.eu` |

### Identifiers

An identifier is `oai:eelsdb.eu:` followed by the spectrum's id, such as `oai:eelsdb.eu:21751`.
It is the same id that API v2 uses.
An identifier for a spectrum that does not exist or is not published gives `idDoesNotExist`.

### Metadata formats

| `metadataPrefix` | Schema | Notes |
| --- | --- | --- |
| `oai_dc` | [Dublin Core](http://www.openarchives.org/OAI/2.0/oai_dc.xsd) | |
| `oai_datacite` | [DataCite kernel 4](http://schema.datacite.org/meta/kernel-4/metadata.xsd) | The bare `resource` element, as Dataverse serves it. `identifier` is the page address with `identifierType="URL"`, because EELSdb has no DOIs. Harvesters that accept only DOIs reject these records. |

Every spectrum is available in both formats.

### Sets

Each record belongs to one `type:` set and one `technique:` set.

| `setSpec` | Name |
| --- | --- |
| `type` | By spectrum type |
| `type:coreloss` | Core-loss EELS |
| `type:lowloss` | Low-loss EELS |
| `type:zeroloss` | Zero-loss EELS |
| `type:xrayabs` | X-ray absorption |
| `technique` | By technique |
| `technique:eels` | Electron energy-loss spectroscopy |
| `technique:xas` | X-ray absorption spectroscopy |

`type` and `technique` are parent sets. They select all spectra.

### Dates

The datestamp of a record is the time the spectrum was published or last changed, in UTC, to the second.
A change is anything a reader sees: the metadata, the files, the processed versions, or the author's name and public links.

- `from` and `until` take a date (`2026-01-31`) or a UTC time (`2026-01-31T09:00:00Z`).
- Both limits are inclusive. A date as `until` includes the whole day.
- `from` and `until` must have the same granularity.

To collect only what changed, give the start time of your last harvest as `from`.

```sh
$ curl "https://api.eelsdb.eu/oai?verb=ListRecords&metadataPrefix=oai_datacite&from=2026-01-31"
```

### Pages

`ListIdentifiers` and `ListRecords` return 100 items per page.
If there are more, the response ends with a `resumptionToken` that has `completeListSize` and `cursor`.
Send it alone, with the verb, to get the next page.
The last page has an empty `resumptionToken`.

```sh
$ curl "https://api.eelsdb.eu/oai?verb=ListRecords&resumptionToken=eyJwIjoib2FpX2RjIi..."
```

Pages follow the spectrum id, not a position in the list.
A spectrum that is published or withdrawn during a harvest does not make you skip or repeat records.
Tokens do not expire.

### Deleted records

`deletedRecord` is `no`.
EELSdb does not keep a record of spectra that a moderator withdraws, so they disappear from the lists without a deleted header.
To remove them from your copy, harvest everything again now and then, and delete what is no longer listed.

### Errors

An error is an `<error>` element with one of the OAI-PMH codes:

| Code | Cause |
| --- | --- |
| `badVerb` | The `verb` is missing or unknown. |
| `badArgument` | An argument is missing, unknown, repeated or malformed, or the set does not exist. |
| `badResumptionToken` | The token is malformed, or it points past the end of the list. |
| `cannotDisseminateFormat` | The `metadataPrefix` is not `oai_dc` or `oai_datacite`. |
| `idDoesNotExist` | No published spectrum has this identifier. |
| `noRecordsMatch` | No spectrum matches the dates and set. |

## DCAT-AP

The catalogue is a `dcat:Catalog` in JSON-LD (`application/ld+json`), with one `dcat:Dataset` for each spectrum.

```sh
$ curl "https://api.eelsdb.eu/dcat/catalog.jsonld"
```

### Pages

Each page has 100 datasets, in order of spectrum id.
Use `?page=2` and so on for the next pages.
The `@graph` holds the catalogue and a `hydra:PagedCollection` node, as [ckanext-dcat](https://github.com/ckan/ckanext-dcat) writes it:

| Property | Value |
| --- | --- |
| `hydra:totalItems` | The number of published spectra |
| `hydra:itemsPerPage` | `100` |
| `hydra:firstPage`, `hydra:lastPage` | The first and last page |
| `hydra:nextPage`, `hydra:previousPage` | Only where such a page exists |

A page number outside the range gives status 404 and a JSON error.

### One spectrum

`https://api.eelsdb.eu/dcat/spectra/{id}.jsonld` returns the `dcat:Dataset` of one spectrum.
Each spectrum page links to it with `<link rel="alternate" type="application/ld+json">`.
A spectrum that does not exist or is not published gives status 404.

### Distributions

Each data file of a spectrum is a `dcat:Distribution`.
The main file comes first.

| Property | Value |
| --- | --- |
| `@id`, `dcat:downloadURL` | The download address of the file |
| `dcat:accessURL` | The spectrum page |
| `dct:title` | What the file is, such as `Spectrum (MSA)` or `Processed: background removed` |
| `dcat:mediaType` | The IANA media type |
| `dct:format` | The EU file type, where one exists: `TXT` for MSA and XDI, `HDF` for HSPY. DM3 and DM4 files have none. |
| `dct:license` | The licence of the spectrum |
| `dcat:byteSize` | The size in bytes |
| `spdx:checksum` | The SHA-256 checksum |

Linked resources (licences, media types, languages, themes) carry their class inline, so validators can check them without loading the EU vocabularies.

## schema.org and the sitemap

- Each spectrum page has a schema.org `Dataset` in a `<script type="application/ld+json">` element. Google Dataset Search reads it.
- The home page has a schema.org `DataCatalog` for the whole database.
- `https://eelsdb.eu/sitemap.xml` lists every published spectrum, with `lastmod` set to the same time as the OAI-PMH datestamp.

## What a record contains

All formats describe a spectrum with the same values:

| Value | Dublin Core | DataCite | DCAT-AP | schema.org |
| --- | --- | --- | --- | --- |
| Page address | `dc:identifier` | `identifier` (URL) | `@id`, `dct:identifier`, `dcat:landingPage` | `@id`, `url`, `identifier` |
| Title | `dc:title` | `title` | `dct:title` | `name` |
| Description | `dc:description` | `description` (Abstract) | `dct:description` | `description` |
| Contributor | `dc:creator` | `creator`, with ORCID | `dct:creator` | `creator` |
| Publisher: EELSdb | `dc:publisher` | `publisher` | `dct:publisher` | `publisher` |
| Published | `dc:date` | `publicationYear`, `date` (Issued) | `dct:issued` | `datePublished` |
| Last changed | OAI-PMH datestamp | `date` (Updated) | `dct:modified` | `dateModified` |
| Subjects | `dc:subject` | `subject` | `dcat:keyword` | `keywords` |
| Licence | `dc:rights` | `rights` (SPDX) | `dct:license` | `license` |
| Paper | `dc:relation`, `dc:source` | `relatedIdentifier` (IsSupplementTo) | `dct:isReferencedBy`, `dct:bibliographicCitation` | `citation` |
| Files | `dc:format` (media types) | `format` (media types) | `dcat:distribution` | `distribution` |

- The subjects are the technique, the spectrum type, the formula, the elements, the edges (such as `Fe L2,3`) and the keywords.
- The contributor's ORCID iD is included only if they show their links on their public profile.
- The paper is a DOI where there is one, else its address. Its citation text is included where EELSdb has it.
- Each record states its own licence. Most are [ODbL 1.0](https://opendatacommons.org/licenses/odbl/1-0/).
- If a spectrum has no description, the description names its type and formula.
