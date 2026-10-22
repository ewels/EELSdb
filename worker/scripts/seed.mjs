// Builds the local D1 database and R2 bucket (Miniflare state in .wrangler/) from data/seed/.
// Run `uv run python/build_seed.py` first if the fixtures changed.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { getPlatformProxy } from "wrangler";

const root = new URL("../../", import.meta.url);
const seed = readFileSync(new URL("data/seed/seed.sql", root), "utf8");
const uploads = JSON.parse(readFileSync(new URL("data/seed/r2-uploads.json", root), "utf8"));

execFileSync("npx", ["wrangler", "d1", "migrations", "apply", "DB", "--local"], { stdio: "inherit" });

const { env, dispose } = await getPlatformProxy({ persist: true });
const statements = seed.split("\n").filter((l) => l.startsWith("INSERT"));
const tables = [...new Set(statements.map((s) => s.match(/^INSERT INTO (\w+)/)[1]))].reverse();
await env.DB.batch(tables.map((t) => env.DB.prepare(`DELETE FROM ${t}`)));
for (let i = 0; i < statements.length; i += 500) {
  await env.DB.batch(statements.slice(i, i + 500).map((s) => env.DB.prepare(s)));
}
console.log(`D1: ${statements.length} rows`);

// Accounts come from the private database export (python/export_accounts.py), when present.
const accountsFile = new URL("data/private/accounts.sql", root);
if (existsSync(accountsFile)) {
  const accounts = readFileSync(accountsFile, "utf8").split("\n").filter((l) => /^(INSERT|UPDATE)/.test(l));
  await env.DB.batch(["favourites", "users"].map((t) => env.DB.prepare(`DELETE FROM ${t}`)));
  for (let i = 0; i < accounts.length; i += 500) {
    await env.DB.batch(accounts.slice(i, i + 500).map((s) => env.DB.prepare(s)));
  }
  console.log(`D1: ${accounts.length} account statements from data/private/accounts.sql`);
}

let missing = 0;
for (const u of uploads) {
  const file = new URL(u.file, root);
  if (!existsSync(file)) {
    missing++;
    continue;
  }
  const contentType = u.key.endsWith(".msa") || u.key.endsWith(".txt") ? "text/plain; charset=utf-8" : "application/octet-stream";
  await env.FILES.put(u.key, readFileSync(file), { httpMetadata: { contentType }, sha256: u.sha256 });
}
console.log(`R2: ${uploads.length - missing} files${missing ? `, ${missing} missing (run download_files)` : ""}`);
await dispose();
