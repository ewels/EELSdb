import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    cloudflareTest(async () => ({
      wrangler: { configPath: "./wrangler.jsonc" },
      miniflare: {
        bindings: {
          TEST_MIGRATIONS: await readD1Migrations("./migrations"),
          ORCID_CLIENT_ID: "orcid-id",
          ORCID_CLIENT_SECRET: "orcid-secret",
          GOOGLE_CLIENT_ID: "google-id",
          GOOGLE_CLIENT_SECRET: "google-secret",
          GITHUB_CLIENT_ID: "github-id",
          GITHUB_CLIENT_SECRET: "github-secret",
          LEGACY_PASSWORD_LOGIN: "1",
          // Tests must not depend on the developer's worker/.env.
          TURNSTILE_SITE_KEY: "",
          TURNSTILE_SECRET_KEY: "",
          EMAIL_PROVIDER: "log",
          ORCID_BASE: "https://orcid.org",
          SITE_URL: "https://eelsdb.eu",
        },
      },
    })),
  ],
  test: { setupFiles: ["./test/setup.ts"] },
});
