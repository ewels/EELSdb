/** Pages that starlight-openapi generates: they have no Markdown source. Keep in step with its `base` options. */
export const isGenerated = (pathname: string) => pathname.startsWith(`${import.meta.env.BASE_URL}api/`);

/** Sidebar links to the main site carry this attribute, so the sidebar can undo Starlight's docs base prefix. */
export const SITE_LINK = 'data-site-link';

/** The main-nav item that a docs page belongs to, as an href from NAV or ABOUT_NAV's first entry. */
export const currentSection = (pathname: string) => {
  const base = import.meta.env.BASE_URL;
  if (pathname.startsWith(`${base}about/`)) return `${base}about/`;
  if (pathname.startsWith(`${base}api/`) || pathname.startsWith(`${base}use/api/`)) return `${base}use/api/`;
  return base;
};
