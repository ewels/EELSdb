-- Files gain the roles a submission uploads: the main spectrum, a low-loss partner and a companion file
-- (for example a Velox .emd from the same session). SQLite cannot change a CHECK, so the table is rebuilt.
CREATE TABLE files_new (
  id INTEGER PRIMARY KEY,
  spectrum_id INTEGER NOT NULL REFERENCES spectra(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('original', 'lowloss', 'companion', 'msa', 'hspy', 'legacy')),
  r2_key TEXT UNIQUE NOT NULL,
  filename TEXT NOT NULL,
  media_type TEXT,
  bytes INTEGER,
  sha256 TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
INSERT INTO files_new SELECT * FROM files;
DROP TABLE files;
ALTER TABLE files_new RENAME TO files;
CREATE INDEX files_spectrum ON files(spectrum_id);

-- Instrument profiles are versioned: an edit adds a version that a moderator approves.
-- instruments.status is the profile's own state; each version has its own status too.
ALTER TABLE instruments ADD COLUMN current_version INTEGER;
ALTER TABLE instruments ADD COLUMN created_at TEXT;
CREATE TABLE instrument_versions (
  instrument_id INTEGER NOT NULL REFERENCES instruments(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  name TEXT NOT NULL,
  facility TEXT,
  manufacturer TEXT,
  spectrometer TEXT,
  voltages_kv_json TEXT,
  notes TEXT,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  decided_by INTEGER REFERENCES users(id),
  decided_at TEXT,
  PRIMARY KEY (instrument_id, version)
);
CREATE INDEX instrument_calibrations_version ON instrument_calibrations(instrument_id, version);

-- What a pending edit of a published spectrum would change, applied when a moderator approves it.
ALTER TABLE submissions ADD COLUMN kind TEXT NOT NULL DEFAULT 'new' CHECK (kind IN ('new', 'edit'));
ALTER TABLE submissions ADD COLUMN change_json TEXT;
CREATE INDEX submissions_status ON submissions(status);
CREATE INDEX submissions_by ON submissions(submitted_by, created_at);

CREATE INDEX spectra_completeness ON spectra(completeness);
