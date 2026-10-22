import { env, exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { sqlTime } from "../src/api/dates";
import { jsonLdScript } from "../src/api/metadata";
import { sessionFor } from "./helpers/session";

const fetchUrl = (url: string, init?: RequestInit) => exports.default.fetch(url, init);
const oai = async (query: string) => (await fetchUrl(`https://api.eelsdb.eu/oai?${query}`)).text();
const errorCode = (body: string) => /<error code="(\w+)"/.exec(body)?.[1];
const ids = (body: string) => [...body.matchAll(/<identifier>oai:eelsdb\.eu:(\d+)<\/identifier>/g)].map((m) => Number(m[1]));
const token = (body: string) => /<resumptionToken[^>]*>([^<]*)<\/resumptionToken>/.exec(body)?.[1];
const run = (sql: string, ...binds: unknown[]) => env.DB.prepare(sql).bind(...binds).run();

describe("dates", () => {
  it("reads OAI-PMH and API dates", () => {
    expect(sqlTime("2026-01-31")).toBe("2026-01-31 00:00:00");
    expect(sqlTime("2026-01-31", true)).toBe("2026-01-31 23:59:59");
    expect(sqlTime("2026-01-31T09:05:00Z")).toBe("2026-01-31 09:05:00");
    for (const bad of ["2026-02-31", "2026-01-31T25:00:00Z", "2026-01-31T09:05:00", "31/01/2026", ""]) expect(sqlTime(bad)).toBeNull();
  });
});

describe("API v2 updated_since", () => {
  it("lists spectra published or changed since a time, newest first by updated_at", async () => {
    await run("UPDATE spectra SET updated_at = '2030-05-01 10:00:00' WHERE id = 22236");
    // Edited before publication: the publication time counts, not the older edit.
    await run("UPDATE spectra SET updated_at = '2001-01-01 00:00:00', published_at = '2030-06-01 00:00:00' WHERE id = 21751");
    const page = await (await fetchUrl("https://api.eelsdb.eu/v2/spectra?updated_since=2030-01-01&sort=updated_at&order=desc")).json<any>();
    expect(page.results.map((s: any) => [s.id, s.updated_at])).toEqual([
      [21751, "2030-06-01 00:00:00"],
      [22236, "2030-05-01 10:00:00"],
    ]);
    const exact = await (await fetchUrl("https://api.eelsdb.eu/v2/spectra?updated_since=2030-05-01T10:00:01Z")).json<any>();
    expect(exact.results.map((s: any) => s.id)).toEqual([21751]);
    expect((await fetchUrl("https://api.eelsdb.eu/v2/spectra?updated_since=yesterday")).status).toBe(400);
  });

  it("counts a change to the author's name or public links, not a profile save that changes neither", async () => {
    const cookie = await sessionFor({ id: 9940002, display_name: "Name Before", slug: "name-before" });
    await run("UPDATE spectra SET owner_id = 9940002, author_display = 'Name Before', author_slug = 'name-before', updated_at = NULL WHERE id = 21751");
    const save = (body: Record<string, string>) =>
      fetchUrl("https://eelsdb.eu/account/settings/profile/", {
        method: "POST",
        redirect: "manual",
        headers: { Cookie: cookie, Origin: "https://eelsdb.eu" },
        body: new URLSearchParams({ username: "name-before", picture: "initials", ...body }),
      });
    const updated = () => env.DB.prepare("SELECT updated_at FROM spectra WHERE id = 21751").first<string | null>("updated_at");
    await save({ display_name: "Name Before" });
    expect(await updated()).toBeNull();
    await save({ display_name: "Name After" });
    expect(await updated()).not.toBeNull();
    await run("UPDATE spectra SET updated_at = NULL WHERE id = 21751");
    await save({ display_name: "Name After", show_links: "1" });
    expect(await updated()).not.toBeNull();
  });

  it("is a browse filter", async () => {
    await run("UPDATE spectra SET updated_at = '2030-05-01 10:00:00' WHERE id = 22236");
    const html = await (await fetchUrl("https://eelsdb.eu/spectra/?updated_since=2030-01-01")).text();
    expect(html).toContain("1 spectrum");
    expect(html).toContain("updated since 2030-01-01");
  });
});

describe("OAI-PMH", () => {
  it("identifies the repository", async () => {
    const body = await oai("verb=Identify");
    expect(body).toContain("<baseURL>https://api.eelsdb.eu/oai</baseURL>");
    expect(body).toContain("<adminEmail>info@eelsdb.eu</adminEmail>");
    expect(body).toContain("<deletedRecord>no</deletedRecord>");
    expect(body).toMatch(/<earliestDatestamp>\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ<\/earliestDatestamp>/);
    expect(body).toContain('<request verb="Identify">');
  });

  it("lists formats and sets", async () => {
    const formats = await oai("verb=ListMetadataFormats");
    expect(formats).toContain("<metadataPrefix>oai_dc</metadataPrefix>");
    expect(formats).toContain("<metadataPrefix>oai_datacite</metadataPrefix>");
    expect(errorCode(await oai("verb=ListMetadataFormats&identifier=oai:eelsdb.eu:1"))).toBe("idDoesNotExist");
    const sets = await oai("verb=ListSets");
    expect(sets).toContain("<setSpec>type:coreloss</setSpec>");
    expect(sets).toContain("<setSpec>technique</setSpec>");
  });

  it("pages through every published spectrum, gas phase included", async () => {
    await run("UPDATE spectra SET phase = 'gas' WHERE id = 22236");
    const total = await env.DB.prepare("SELECT COUNT(*) AS n FROM spectra WHERE status = 'published'").first<number>("n");
    const seen: number[] = [];
    let body = await oai("verb=ListIdentifiers&metadataPrefix=oai_dc");
    expect(body).toContain(`completeListSize="${total}" cursor="0"`);
    for (;;) {
      seen.push(...ids(body));
      const next = token(body);
      if (!next) break;
      body = await oai(`verb=ListIdentifiers&resumptionToken=${next}`);
    }
    expect(seen).toHaveLength(total!);
    expect(new Set(seen).size).toBe(total);
    expect(seen).toContain(22236);
    expect(body).toContain(`<resumptionToken completeListSize="${total}" cursor="${Math.floor((total! - 1) / 100) * 100}"></resumptionToken>`);
  });

  it("harvests selectively by date and set", async () => {
    await run("UPDATE spectra SET updated_at = '2031-03-04 05:06:07' WHERE id = 22236");
    const since = await oai("verb=ListIdentifiers&metadataPrefix=oai_dc&from=2031-01-01");
    expect(ids(since)).toEqual([22236]);
    expect(since).toContain("<datestamp>2031-03-04T05:06:07Z</datestamp>");
    expect(since).not.toContain("resumptionToken");
    expect(ids(await oai("verb=ListIdentifiers&metadataPrefix=oai_dc&from=2031-03-04T05:06:07Z&until=2031-03-04T05:06:07Z"))).toEqual([22236]);
    expect(errorCode(await oai("verb=ListIdentifiers&metadataPrefix=oai_dc&from=2031-03-05"))).toBe("noRecordsMatch");
    expect(errorCode(await oai("verb=ListIdentifiers&metadataPrefix=oai_dc&from=2031-01-01&until=2031-12-31T00:00:00Z"))).toBe("badArgument");
    const xas = await oai("verb=ListIdentifiers&metadataPrefix=oai_dc&set=type:xrayabs");
    expect(xas).not.toContain("<setSpec>type:coreloss</setSpec>");
    expect(xas).toContain("<setSpec>type:xrayabs</setSpec>");
  });

  it("serves records in Dublin Core and DataCite", async () => {
    const dc = await oai("verb=GetRecord&identifier=oai:eelsdb.eu:22236&metadataPrefix=oai_dc");
    expect(dc).toContain("<dc:title>MLC Nanotube (Y,La)S-TaS2</dc:title>");
    expect(dc).toContain("<dc:identifier>https://eelsdb.eu/spectra/mlc-nanotube-ylas-tas2/</dc:identifier>");
    expect(dc).toContain("<dc:relation>https://doi.org/10.1021/acsnano.9b09284</dc:relation>");
    expect(dc).toContain("<dc:rights>https://opendatacommons.org/licenses/odbl/1-0/</dc:rights>");
    expect(dc).toContain("<dc:publisher>EELSdb</dc:publisher>");
    const datacite = await oai("verb=GetRecord&identifier=oai:eelsdb.eu:22236&metadataPrefix=oai_datacite");
    expect(datacite).toContain('<identifier identifierType="URL">https://eelsdb.eu/spectra/mlc-nanotube-ylas-tas2/</identifier>');
    expect(datacite).toContain('<relatedIdentifier relatedIdentifierType="DOI" relationType="IsSupplementTo">10.1021/acsnano.9b09284</relatedIdentifier>');
    expect(datacite).toContain('<resourceType resourceTypeGeneral="Dataset">Core-loss EELS spectrum</resourceType>');
    const records = await oai("verb=ListRecords&metadataPrefix=oai_dc&set=type:xrayabs");
    expect(records.match(/<record>/g)!.length).toBe(ids(records).length);
  });

  it("escapes user text in XML", async () => {
    await run("UPDATE spectra SET title = 'Fe & <O> \"x\"' WHERE id = 22236");
    const dc = await oai("verb=GetRecord&identifier=oai:eelsdb.eu:22236&metadataPrefix=oai_dc");
    expect(dc).toContain("<dc:title>Fe &amp; &lt;O&gt; &quot;x&quot;</dc:title>");
  });

  it("answers errors as the protocol says", async () => {
    const bad = await oai("verb=Nope");
    expect(errorCode(bad)).toBe("badVerb");
    expect(bad).toContain("<request>https://api.eelsdb.eu/oai</request>");
    expect(errorCode(await oai(""))).toBe("badVerb");
    expect(errorCode(await oai("verb=Identify&verb=Identify"))).toBe("badArgument");
    expect(errorCode(await oai("verb=Identify&colour=red"))).toBe("badArgument");
    expect(errorCode(await oai("verb=ListRecords"))).toBe("badArgument");
    expect(errorCode(await oai("verb=ListRecords&metadataPrefix=oai_dc&set=nope"))).toBe("badArgument");
    expect(errorCode(await oai("verb=ListRecords&resumptionToken=abc&metadataPrefix=oai_dc"))).toBe("badArgument");
    expect(errorCode(await oai("verb=ListRecords&metadataPrefix=marc21"))).toBe("cannotDisseminateFormat");
    expect(errorCode(await oai("verb=GetRecord&identifier=oai:eelsdb.eu:22236&metadataPrefix=marc21"))).toBe("cannotDisseminateFormat");
    expect(errorCode(await oai("verb=GetRecord&identifier=22236&metadataPrefix=oai_dc"))).toBe("idDoesNotExist");
    expect(errorCode(await oai("verb=ListRecords&resumptionToken=abc"))).toBe("badResumptionToken");
  });

  it("accepts POST", async () => {
    const res = await fetchUrl("https://api.eelsdb.eu/oai", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: "verb=GetRecord&identifier=oai%3Aeelsdb.eu%3A22236&metadataPrefix=oai_dc",
    });
    expect(res.headers.get("Content-Type")).toBe("text/xml; charset=utf-8");
    expect(ids(await res.text())).toEqual([22236]);
  });
});

describe("DCAT-AP", () => {
  it("pages the catalogue with Hydra", async () => {
    const res = await fetchUrl("https://api.eelsdb.eu/dcat/catalog.jsonld");
    expect(res.headers.get("Content-Type")).toBe("application/ld+json; charset=utf-8");
    const doc = await res.json<any>();
    const [catalog, paging] = doc["@graph"];
    expect(catalog["@type"]).toBe("dcat:Catalog");
    expect(catalog["dct:publisher"]["foaf:name"]).toBe("EELSdb");
    expect(catalog["dcat:dataset"]).toHaveLength(100);
    expect(paging["hydra:nextPage"]).toBe("https://api.eelsdb.eu/dcat/catalog.jsonld?page=2");
    const last = await (await fetchUrl(paging["hydra:lastPage"])).json<any>();
    expect(last["@graph"][1]["hydra:nextPage"]).toBeUndefined();
    expect(last["@graph"][0]["dcat:dataset"].length).toBe(paging["hydra:totalItems"] % 100 || 100);
    expect((await fetchUrl("https://api.eelsdb.eu/dcat/catalog.jsonld?page=99")).status).toBe(404);
  });

  it("describes a spectrum and its files", async () => {
    const d = await (await fetchUrl("https://api.eelsdb.eu/dcat/spectra/22236.jsonld")).json<any>();
    expect(d["@type"]).toBe("dcat:Dataset");
    expect(d["@id"]).toBe("https://eelsdb.eu/spectra/mlc-nanotube-ylas-tas2/");
    expect(d["dct:title"]).toBeTruthy();
    expect(d["dct:description"]).toBeTruthy();
    expect(d["dct:isReferencedBy"]).toEqual({ "@id": "https://doi.org/10.1021/acsnano.9b09284" });
    expect(d["dcat:theme"]).toMatchObject({ "@id": "http://publications.europa.eu/resource/authority/data-theme/TECH" });
    const [file] = d["dcat:distribution"];
    expect(file["dcat:downloadURL"]).toEqual({ "@id": "https://eelsdb.eu/wp-content/uploads/2023/10/Y20.txt" });
    expect(file["dct:format"]).toMatchObject({ "@id": "http://publications.europa.eu/resource/authority/file-type/TXT" });
    expect(file["dct:license"]).toMatchObject({ "@id": "http://publications.europa.eu/resource/authority/licence/ODC_BL" });
    expect((await fetchUrl("https://api.eelsdb.eu/dcat/spectra/1.jsonld")).status).toBe(404);
  });
});

describe("schema.org and the sitemap", () => {
  const ldBlocks = (html: string) => [...html.matchAll(/<script type="application\/ld\+json">(.*?)<\/script>/gs)].map((m) => JSON.parse(m[1]));

  it("puts a Dataset on spectrum pages that user text cannot break out of", async () => {
    await run("UPDATE spectra SET description = 'Tricky </script><script>alert(1)</script>' WHERE id = 22236");
    const html = await (await fetchUrl("https://eelsdb.eu/spectra/mlc-nanotube-ylas-tas2/")).text();
    const [dataset] = ldBlocks(html);
    expect(dataset["@type"]).toBe("Dataset");
    expect(dataset.url).toBe("https://eelsdb.eu/spectra/mlc-nanotube-ylas-tas2/");
    expect(dataset.license).toBe("https://opendatacommons.org/licenses/odbl/1-0/");
    expect(dataset.citation).toBe("https://doi.org/10.1021/acsnano.9b09284");
    expect(dataset.description).toContain("alert(1)");
    expect(jsonLdScript({ a: "</script>" })).toBe('{"a":"\\u003c/script>"}');
  });

  it("names the author's ORCID iD only when their profile shows links", async () => {
    await run("INSERT INTO users (id, display_name, slug, show_links) VALUES (9940001, 'Orcid Person', 'orcid-person', 0)");
    await run("INSERT INTO identities (user_id, provider, subject) VALUES (9940001, 'orcid', '0000-0002-1825-0097')");
    await run("UPDATE spectra SET owner_id = 9940001 WHERE id = 22236");
    const creator = async () => ldBlocks(await (await fetchUrl("https://eelsdb.eu/spectra/mlc-nanotube-ylas-tas2/")).text())[0].creator;
    expect((await creator())["@id"]).toBeUndefined();
    await run("UPDATE users SET show_links = 1 WHERE id = 9940001");
    expect((await creator())["@id"]).toBe("https://orcid.org/0000-0002-1825-0097");
    expect(await oai("verb=GetRecord&identifier=oai:eelsdb.eu:22236&metadataPrefix=oai_datacite")).toContain(
      '<nameIdentifier nameIdentifierScheme="ORCID" schemeURI="https://orcid.org">https://orcid.org/0000-0002-1825-0097</nameIdentifier>',
    );
  });

  it("describes the catalogue on the home page", async () => {
    const html = await (await fetchUrl("https://eelsdb.eu/")).text();
    expect(ldBlocks(html)[0]).toMatchObject({ "@type": "DataCatalog", url: "https://eelsdb.eu/" });
  });

  it("lists every published spectrum in the sitemap", async () => {
    const xml = await (await fetchUrl("https://eelsdb.eu/sitemap.xml")).text();
    const total = await env.DB.prepare("SELECT COUNT(*) AS n FROM spectra WHERE status = 'published'").first<number>("n");
    expect(xml.match(/<url>/g)!.length).toBe(total! + 2);
    expect(xml).toMatch(/<loc>https:\/\/eelsdb\.eu\/spectra\/mlc-nanotube-ylas-tas2\/<\/loc><lastmod>\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ<\/lastmod>/);
  });
});
