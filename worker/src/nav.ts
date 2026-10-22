// Shared with the docs header (docs-site/src/components/Header.astro).
export const NAV = [
  ["/spectra/", "Browse"],
  ["/submit-data/", "Submit"],
  ["/news/", "News"],
  ["/docs/use/api/", "API"],
  ["/docs/", "Docs"],
] as const;

export const ABOUT_NAV = [
  ["/docs/about/", "About EELSdb"],
  ["/docs/about/citation/", "How to cite"],
  ["/moderators/", "Moderators"],
  ["/docs/about/logo/", "Logo and colours"],
  ["/contact/", "Contact"],
] as const;

/** The About link for this page: the longest that its path starts with, so /docs/about/logo/ is not also /docs/about/. */
export const currentAbout = (path: string) =>
  ABOUT_NAV.map(([href]) => href).filter((href) => path.startsWith(href)).sort((a, b) => b.length - a.length)[0];
