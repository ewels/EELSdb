import { applyD1Migrations } from "cloudflare:test";
import { env } from "cloudflare:workers";
import seed from "../../data/seed/seed.sql?raw";

declare global {
  namespace Cloudflare {
    interface Env {
      TEST_MIGRATIONS: import("cloudflare:test").D1Migration[];
    }
  }
}

await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
const seeded = await env.DB.prepare("SELECT COUNT(*) AS n FROM spectra").first<number>("n");
if (!seeded) {
  const statements = seed.split("\n").filter((l) => l.startsWith("INSERT"));
  for (let i = 0; i < statements.length; i += 500) {
    await env.DB.batch(statements.slice(i, i + 500).map((s) => env.DB.prepare(s)));
  }
}
