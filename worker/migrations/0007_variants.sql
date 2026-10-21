-- Files gain two roles: 'variant', a processed version the contributor uploads next to the spectrum (for example
-- oscillator strength or smoothed), named in `variant`; and 'metadata', every tag read from the original file at review.
CREATE TABLE files_new (
  id INTEGER PRIMARY KEY,
  spectrum_id INTEGER NOT NULL REFERENCES spectra(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('original', 'lowloss', 'companion', 'variant', 'msa', 'hspy', 'metadata', 'legacy')),
  r2_key TEXT UNIQUE NOT NULL,
  filename TEXT NOT NULL,
  media_type TEXT,
  bytes INTEGER,
  sha256 TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  variant TEXT CHECK ((role = 'variant') = (variant IS NOT NULL)),
  UNIQUE (spectrum_id, variant)
);
INSERT INTO files_new (id, spectrum_id, role, r2_key, filename, media_type, bytes, sha256, created_at)
  SELECT id, spectrum_id, role, r2_key, filename, media_type, bytes, sha256, created_at FROM files;
DROP TABLE files;
ALTER TABLE files_new RENAME TO files;
CREATE INDEX files_spectrum ON files(spectrum_id);
