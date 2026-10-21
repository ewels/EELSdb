// Public profile fields: links to a user's other profiles, and the username in their /author/ address.

type LinkField = { key: string; label: string; placeholder: string; url: (handle: string) => string; host: RegExp };

export const LINK_FIELDS: LinkField[] = [
  { key: "github", label: "GitHub", placeholder: "username", url: (h) => `https://github.com/${h}`, host: /(^|\.)github\.com$/ },
  { key: "x", label: "X (Twitter)", placeholder: "@username", url: (h) => `https://x.com/${h}`, host: /(^|\.)(x|twitter)\.com$/ },
  { key: "bluesky", label: "Bluesky", placeholder: "name.bsky.social", url: (h) => `https://bsky.app/profile/${h}`, host: /(^|\.)bsky\.app$/ },
  {
    key: "mastodon",
    label: "Mastodon",
    placeholder: "@name@instance.social",
    url: (h) => {
      const [user, server] = h.split("@");
      return `https://${server}/@${user}`;
    },
    host: /./,
  },
  { key: "linkedin", label: "LinkedIn", placeholder: "profile name", url: (h) => `https://www.linkedin.com/in/${h}`, host: /(^|\.)linkedin\.com$/ },
  { key: "scholar", label: "Google Scholar", placeholder: "profile ID or link", url: (h) => `https://scholar.google.com/citations?user=${h}`, host: /(^|\.)scholar\.google\.[a-z.]+$/ },
  { key: "researchgate", label: "ResearchGate", placeholder: "profile name", url: (h) => `https://www.researchgate.net/profile/${h}`, host: /(^|\.)researchgate\.net$/ },
];

const HANDLE: Record<string, RegExp> = {
  github: /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/,
  x: /^\w{1,15}$/,
  bluesky: /^[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/,
  mastodon: /^[\w.]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/,
  linkedin: /^[\w-]{3,100}$/,
  scholar: /^[\w-]{12}$/,
  researchgate: /^[\w.-]{2,100}$/,
};

/**
 * Checks one link field: a handle (with or without a leading @) or an https:// address on the
 * service's own site. Returns what to store, or an error message.
 */
export function parseLink(key: string, raw: string): { value: string | null } | { error: string } {
  const field = LINK_FIELDS.find((f) => f.key === key)!;
  const v = raw.trim();
  if (!v) return { value: null };
  if (/^https?:\/\//i.test(v)) {
    try {
      const url = new URL(v);
      if (url.protocol === "https:" && field.host.test(url.hostname)) return { value: url.href };
    } catch {}
    return { error: `${field.label}: use your ${field.placeholder}, or an https:// link to your profile there.` };
  }
  const handle = v.replace(/^@/, "");
  if (!HANDLE[key].test(handle)) return { error: `${field.label}: "${v}" does not look like a ${field.placeholder}.` };
  return { value: handle };
}

/** The address to link to for a stored value (a handle, or a full https:// link). */
export const linkUrl = (key: string, value: string) => (value.startsWith("https://") ? value : LINK_FIELDS.find((f) => f.key === key)!.url(value));

export const ORCID = /^\d{4}-\d{4}-\d{4}-\d{3}[\dX]$/;

export function parseOrcid(raw: string): { value: string | null } | { error: string } {
  const v = raw.trim().replace(/^https?:\/\/orcid\.org\//i, "");
  if (!v) return { value: null };
  return ORCID.test(v) ? { value: v } : { error: "ORCID iDs look like 0000-0002-1825-0097." };
}

/** Usernames end up in /author/<username>/ addresses. */
export function parseUsername(raw: string): { value: string } | { error: string } {
  const v = raw.trim().toLowerCase();
  if (!/^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$/.test(v)) {
    return { error: "Use 3 to 40 lowercase letters, numbers and hyphens, starting and ending with a letter or number." };
  }
  return { value: v };
}

export const parseLinks = (json: string | null): Record<string, string> => {
  try {
    const v = JSON.parse(json ?? "{}");
    return v && typeof v === "object" && !Array.isArray(v) ? v : {};
  } catch {
    return {};
  }
};
