// Secrets and optional settings from .dev.vars (see .dev.vars.example); `wrangler types` does not know them.
interface Env {
  ORCID_CLIENT_ID?: string;
  ORCID_CLIENT_SECRET?: string;
  ORCID_BASE?: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  GITHUB_CLIENT_ID?: string;
  GITHUB_CLIENT_SECRET?: string;
  EMAIL_PROVIDER?: string;
  LEGACY_PASSWORD_LOGIN?: string;
}
