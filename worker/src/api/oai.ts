// OAI-PMH 2.0 (https://www.openarchives.org/OAI/openarchivesprotocol.html) over the published spectra, for
// repository harvesters. Records are serialised by metadata.ts, so they say the same as DCAT-AP and schema.org.
import { Hono, type Context } from "hono";
import type { AppEnv } from "../auth";
import { MODIFIED_SQL, isoTime, sqlTime } from "./dates";
import { API_HOST } from "./format";
import { SITE_HOST } from "../site";
import { dataCite, dublinCore, loadRecords, xml, type MetaRecord } from "./metadata";

export const OAI_BASE = `${API_HOST}/oai`;
const ADMIN_EMAIL = "info@eelsdb.eu";
const REPOSITORY_ID = SITE_HOST;
const PAGE = 100;

const FORMATS: Record<string, { schema: string; namespace: string; write: (r: MetaRecord) => string }> = {
  oai_dc: { schema: "http://www.openarchives.org/OAI/2.0/oai_dc.xsd", namespace: "http://www.openarchives.org/OAI/2.0/oai_dc/", write: dublinCore },
  oai_datacite: { schema: "http://schema.datacite.org/meta/kernel-4/metadata.xsd", namespace: "http://datacite.org/schema/kernel-4", write: dataCite },
};

const SETS: [spec: string, name: string, sql: string | null][] = [
  ["type", "By spectrum type", null],
  ["type:coreloss", "Core-loss EELS", "s.type = 'coreloss'"],
  ["type:lowloss", "Low-loss EELS", "s.type = 'lowloss'"],
  ["type:zeroloss", "Zero-loss EELS", "s.type = 'zeroloss'"],
  ["type:xrayabs", "X-ray absorption", "s.type = 'xrayabs'"],
  ["technique", "By technique", null],
  ["technique:eels", "Electron energy-loss spectroscopy", "s.technique = 'eels'"],
  ["technique:xas", "X-ray absorption spectroscopy", "s.technique = 'xas'"],
];

const ARGS: Record<string, { required: string[]; optional: string[]; resumable?: boolean }> = {
  Identify: { required: [], optional: [] },
  ListMetadataFormats: { required: [], optional: ["identifier"] },
  ListSets: { required: [], optional: [], resumable: true },
  ListIdentifiers: { required: ["metadataPrefix"], optional: ["from", "until", "set"], resumable: true },
  ListRecords: { required: ["metadataPrefix"], optional: ["from", "until", "set"], resumable: true },
  GetRecord: { required: ["identifier", "metadataPrefix"], optional: [] },
};

type Args = Record<string, string>;
type Token = { p: string; s?: string; f?: string; u?: string; after: number; n: number };
type Row = { id: number; type: string; technique: string; modified: string };

class OaiError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
  }
}

const identifier = (id: number) => `oai:${REPOSITORY_ID}:${id}`;
const idFrom = (v: string) => {
  const m = new RegExp(`^oai:${REPOSITORY_ID.replace(".", "\\.")}:(\\d+)$`).exec(v);
  return m ? Number(m[1]) : null;
};

const encodeToken = (t: Token) => btoa(JSON.stringify(t)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
function decodeToken(v: string): Token {
  try {
    const t = JSON.parse(atob(v.replace(/-/g, "+").replace(/_/g, "/")));
    if (FORMATS[t.p] && Number.isInteger(t.after) && Number.isInteger(t.n)) return t;
  } catch {}
  throw new OaiError("badResumptionToken", "The resumption token is not valid.");
}

function envelope(args: Args | null, body: string) {
  // The request element repeats the arguments, except after badVerb or badArgument.
  const attrs = args ? Object.entries(args).map(([k, v]) => ` ${k}="${xml(v)}"`).join("") : "";
  return `<?xml version="1.0" encoding="UTF-8"?>
<OAI-PMH xmlns="http://www.openarchives.org/OAI/2.0/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="http://www.openarchives.org/OAI/2.0/ http://www.openarchives.org/OAI/2.0/OAI-PMH.xsd">
<responseDate>${new Date().toISOString().slice(0, 19)}Z</responseDate>
<request${attrs}>${OAI_BASE}</request>
${body}
</OAI-PMH>`;
}

const header = (r: Row) =>
  `<header><identifier>${identifier(r.id)}</identifier><datestamp>${isoTime(r.modified)}</datestamp><setSpec>type:${r.type}</setSpec><setSpec>technique:${r.technique}</setSpec></header>`;

function checkArgs(args: Args) {
  const spec = ARGS[args.verb];
  if (!spec) throw new OaiError("badVerb", args.verb ? `'${args.verb}' is not an OAI-PMH verb.` : "The verb argument is missing.");
  const given = Object.keys(args).filter((k) => k !== "verb");
  if (args.resumptionToken !== undefined) {
    if (!spec.resumable) throw new OaiError("badArgument", `${args.verb} takes no resumptionToken.`);
    if (given.length > 1) throw new OaiError("badArgument", "resumptionToken is an exclusive argument.");
    return;
  }
  const bad = given.find((k) => !spec.required.includes(k) && !spec.optional.includes(k));
  if (bad) throw new OaiError("badArgument", `${args.verb} does not take '${bad}'.`);
  const missing = spec.required.find((k) => !(k in args));
  if (missing) throw new OaiError("badArgument", `${args.verb} needs '${missing}'.`);
}

async function listItems(db: D1Database, args: Args, records: boolean) {
  const t: Token = args.resumptionToken
    ? decodeToken(args.resumptionToken)
    : { p: args.metadataPrefix, s: args.set, f: args.from, u: args.until, after: 0, n: 0 };
  if (!FORMATS[t.p]) throw new OaiError("cannotDisseminateFormat", `'${t.p}' is not offered; see ListMetadataFormats.`);
  const where = ["s.status = 'published'"];
  const binds: unknown[] = [];
  if (t.s !== undefined) {
    const set = SETS.find(([spec]) => spec === t.s);
    if (!set) throw new OaiError("badArgument", `There is no set '${t.s}'.`);
    if (set[2]) where.push(set[2]);
  }
  const from = t.f === undefined ? undefined : sqlTime(t.f);
  const until = t.u === undefined ? undefined : sqlTime(t.u, true);
  if (from === null || until === null) throw new OaiError("badArgument", "from and until must be dates (2026-01-31) or UTC times (2026-01-31T09:00:00Z).");
  if (t.f && t.u && t.f.length !== t.u.length) throw new OaiError("badArgument", "from and until must have the same granularity.");
  if (from) where.push(`${MODIFIED_SQL} >= ?`), binds.push(from);
  if (until) where.push(`${MODIFIED_SQL} <= ?`), binds.push(until);
  const filter = `FROM spectra s WHERE ${where.join(" AND ")}`;

  // Paged by id, not offset, so spectra published or withdrawn during a harvest do not shift the pages.
  const [count, page] = await db.batch<any>([
    db.prepare(`SELECT COUNT(*) AS n ${filter}`).bind(...binds),
    db.prepare(`SELECT s.id, s.type, s.technique, ${MODIFIED_SQL} AS modified ${filter} AND s.id > ? ORDER BY s.id LIMIT ?`).bind(...binds, t.after, PAGE),
  ]);
  const total: number = count.results[0].n;
  const rows: Row[] = page.results;
  if (!rows.length) {
    if (args.resumptionToken) throw new OaiError("badResumptionToken", "The resumption token is past the end of the list.");
    throw new OaiError("noRecordsMatch", "No records match these arguments.");
  }

  let items: string;
  if (records) {
    const byId = new Map((await loadRecords(db, rows.map((r) => r.id))).map((r) => [r.id, r]));
    items = rows
      .filter((r) => byId.has(r.id))
      .map((r) => `<record>${header(r)}<metadata>${FORMATS[t.p].write(byId.get(r.id)!)}</metadata></record>`)
      .join("\n");
  } else {
    items = rows.map(header).join("\n");
  }
  const seen = t.n + rows.length;
  const next = seen < total && rows.length === PAGE ? encodeToken({ ...t, after: rows.at(-1)!.id, n: seen }) : "";
  const token = args.resumptionToken || next ? `\n<resumptionToken completeListSize="${total}" cursor="${t.n}">${next}</resumptionToken>` : "";
  return items + token;
}

async function respond(db: D1Database, args: Args): Promise<string> {
  checkArgs(args);
  const verb = args.verb;
  if (verb === "Identify") {
    const earliest = await db.prepare("SELECT MIN(published_at) AS t FROM spectra WHERE status = 'published'").first<string>("t");
    return `<Identify>
<repositoryName>EELS Data Base</repositoryName>
<baseURL>${OAI_BASE}</baseURL>
<protocolVersion>2.0</protocolVersion>
<adminEmail>${ADMIN_EMAIL}</adminEmail>
<earliestDatestamp>${isoTime(earliest ?? "2000-01-01 00:00:00")}</earliestDatestamp>
<deletedRecord>no</deletedRecord>
<granularity>YYYY-MM-DDThh:mm:ssZ</granularity>
<description><oai-identifier xmlns="http://www.openarchives.org/OAI/2.0/oai-identifier" xsi:schemaLocation="http://www.openarchives.org/OAI/2.0/oai-identifier http://www.openarchives.org/OAI/2.0/oai-identifier.xsd"><scheme>oai</scheme><repositoryIdentifier>${REPOSITORY_ID}</repositoryIdentifier><delimiter>:</delimiter><sampleIdentifier>${identifier(21751)}</sampleIdentifier></oai-identifier></description>
</Identify>`;
  }
  if (verb === "ListMetadataFormats" || verb === "GetRecord") {
    if (args.identifier !== undefined) {
      const id = idFrom(args.identifier);
      const exists = id !== null && (await db.prepare("SELECT 1 FROM spectra WHERE id = ? AND status = 'published'").bind(id).first());
      if (!exists) throw new OaiError("idDoesNotExist", `There is no published record '${args.identifier}'.`);
    }
    if (verb === "ListMetadataFormats") {
      const formats = Object.entries(FORMATS).map(
        ([prefix, f]) => `<metadataFormat><metadataPrefix>${prefix}</metadataPrefix><schema>${f.schema}</schema><metadataNamespace>${f.namespace}</metadataNamespace></metadataFormat>`,
      );
      return `<ListMetadataFormats>\n${formats.join("\n")}\n</ListMetadataFormats>`;
    }
    const format = FORMATS[args.metadataPrefix];
    if (!format) throw new OaiError("cannotDisseminateFormat", `'${args.metadataPrefix}' is not offered; see ListMetadataFormats.`);
    const id = idFrom(args.identifier)!;
    const row = await db.prepare(`SELECT s.id, s.type, s.technique, ${MODIFIED_SQL} AS modified FROM spectra s WHERE s.id = ?`).bind(id).first<Row>();
    const [record] = await loadRecords(db, [id]);
    return `<GetRecord><record>${header(row!)}<metadata>${format.write(record)}</metadata></record></GetRecord>`;
  }
  if (verb === "ListSets") {
    if (args.resumptionToken) throw new OaiError("badResumptionToken", "ListSets is never split into pages.");
    return `<ListSets>\n${SETS.map(([spec, name]) => `<set><setSpec>${spec}</setSpec><setName>${xml(name)}</setName></set>`).join("\n")}\n</ListSets>`;
  }
  return `<${verb}>\n${await listItems(db, args, verb === "ListRecords")}\n</${verb}>`;
}

async function handle(c: Context<AppEnv>) {
  const params = c.req.method === "POST" ? new URLSearchParams(new TextDecoder().decode(await c.req.arrayBuffer())) : new URL(c.req.url).searchParams;
  const args: Args = {};
  let repeated = false;
  for (const [k, v] of params) {
    if (k in args) repeated = true;
    args[k] = v;
  }
  let body: string;
  let echo: Args | null = args;
  try {
    if (repeated) throw new OaiError("badArgument", "An argument is repeated.");
    body = await respond(c.env.DB, args);
  } catch (e) {
    if (!(e instanceof OaiError)) throw e;
    if (e.code === "badVerb" || e.code === "badArgument") echo = null;
    body = `<error code="${e.code}">${xml(e.message)}</error>`;
  }
  return c.body(envelope(echo, body), 200, { "Content-Type": "text/xml; charset=utf-8" });
}

export const oai = new Hono<AppEnv>();
oai.get("/", handle);
oai.post("/", handle);
