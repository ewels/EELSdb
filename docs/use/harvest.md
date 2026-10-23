---
title: Harvest metadata
description: Find EELSdb spectra in repositories, data catalogues and search engines, and add them to your own with OAI-PMH, DCAT-AP or schema.org.
---

EELSdb publishes a description of every spectrum in the standard formats that research repositories, data catalogues and search engines read.
This lets people find EELSdb spectra in the tools they already use, next to data from other sources, and lets those tools link back to the spectrum page.

You need this page if you run a repository or a catalogue and want to list EELSdb spectra in it.
To download the data itself, see [Download and cite spectra](/docs/use/download/) or the [API](/docs/use/api/).

## Which format to use

| You run | Use | Address |
| --- | --- | --- |
| A repository, such as Dataverse, DSpace or InvenioRDM | OAI-PMH | `https://api.eelsdb.eu/oai` |
| A data portal, such as CKAN or piveau, or a European catalogue that follows EOSC | DCAT-AP | `https://api.eelsdb.eu/dcat/catalog.jsonld` |
| A search engine or crawler | schema.org and the sitemap | `https://eelsdb.eu/sitemap.xml` |

Google Dataset Search already reads the schema.org description on each spectrum page. You do not have to do anything for it.

## What the records say

Every format gives the same record of a spectrum: the title, description, contributor, dates, licence, files and the paper that the spectrum comes from.
The records include gas-phase spectra.

- **No DOIs.** EELSdb does not give spectra DOIs. A spectrum is identified by the address of its page, such as `https://eelsdb.eu/spectra/hematite/`. The DOI of the paper is a related identifier. Harvesters that accept only records with DOIs will not take EELSdb records.
- **Licences.** Every record states its licence. Most are under the [Open Database License (ODbL) 1.0](https://opendatacommons.org/licenses/odbl/1-0/).
- **Contributors.** A record names the contributor's ORCID iD only if the contributor shows their links on their public profile.

## Keep your copy up to date

Each record carries the time the spectrum was last changed.
Harvest everything once, then ask only for what changed since your last harvest.

EELSdb does not keep a record of spectra that a moderator withdraws.
They disappear from the lists, so an update by date does not tell you about them.
Harvest everything again now and then, and remove what is no longer listed.

## Technical details

[Harvesting endpoints](/docs/reference/harvesting/) gives the verbs, arguments, sets, paging, errors and the full mapping of fields in each format.
