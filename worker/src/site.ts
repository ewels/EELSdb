import { env } from "cloudflare:workers";

const PRODUCTION = "https://eelsdb.eu";

/** Public address of this deployment (SITE_URL). The API is the same host with "api." in front. */
export const SITE = (env.SITE_URL || PRODUCTION).replace(/\/+$/, "");
export const API_HOST = apiHost(SITE);
export const SITE_HOST = new URL(SITE).host;
export const IS_PRODUCTION = SITE === PRODUCTION;

function apiHost(site: string) {
  return site.replace("://", "://api.");
}

/** Points production links in prebuilt text (the docs, llms.txt) at another deployment. */
export const localise = (text: string) => rehost(text, SITE);

export function rehost(text: string, site: string) {
  if (site === PRODUCTION) return text;
  return text.replaceAll(apiHost(PRODUCTION), apiHost(site)).replaceAll(PRODUCTION, site);
}
