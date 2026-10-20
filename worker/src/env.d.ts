// Secrets and optional settings from .env (see .env.example); `wrangler types` does not know them.
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
  TURNSTILE_SITE_KEY?: string;
  TURNSTILE_SECRET_KEY?: string;
}
