-- Browse thumbnails (JSON, see src/preview.ts), built on first view. preview_key is the R2 key it was built from.
ALTER TABLE spectra ADD COLUMN preview TEXT;
ALTER TABLE spectra ADD COLUMN preview_key TEXT;
