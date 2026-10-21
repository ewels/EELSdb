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
  ["/docs/about/contact/", "Contact"],
] as const;
