-- Initial schema. Units are in column names; the v1 API adds them back as strings.
-- Acquisition values carry a *_source: file | companion | profile | user | estimate | unknown.

CREATE TABLE users (
  id INTEGER PRIMARY KEY,            -- legacy WordPress user ID for migrated accounts
  slug TEXT UNIQUE,                  -- /author/{slug}/ (legacy user_nicename)
  display_name TEXT NOT NULL,
  affiliation TEXT,
  country TEXT,
  orcid TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'moderator', 'admin')),
  legacy_login TEXT,                 -- for matching migrated accounts; never exposed
  legacy_email TEXT,                 -- for matching migrated accounts; never exposed
  legacy_password_hash TEXT          -- only with legacy password login; deleted after first login
);

CREATE TABLE identities (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK (provider IN ('orcid', 'google', 'github')),
  subject TEXT NOT NULL,
  email TEXT,
  email_verified INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (provider, subject)
);
CREATE INDEX identities_user ON identities(user_id);

CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL
);

CREATE TABLE api_tokens (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  hash TEXT UNIQUE NOT NULL,
  label TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_used_at TEXT
);

CREATE TABLE spectra (
  id INTEGER PRIMARY KEY,            -- legacy WordPress post ID for migrated spectra
  slug TEXT UNIQUE NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('draft', 'pending', 'published', 'private', 'rejected')),
  title TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('coreloss', 'lowloss', 'zeroloss', 'xrayabs')),
  technique TEXT NOT NULL DEFAULT 'eels' CHECK (technique IN ('eels', 'xas')),
  phase TEXT NOT NULL DEFAULT 'solid' CHECK (phase IN ('solid', 'liquid', 'gas')),
  intensity_units TEXT NOT NULL DEFAULT 'counts'
    CHECK (intensity_units IN ('counts', 'oscillator_strength', 'mu', 'optical_density', 'normalised')),
  formula TEXT,
  source_purity TEXT,
  description TEXT,
  min_energy_ev REAL,
  max_energy_ev REAL,
  step_ev REAL,
  owner_id INTEGER REFERENCES users(id),
  author_display TEXT,
  author_slug TEXT,                  -- legacy author nicename, for /author/{slug}/ when there is no account
  licence TEXT,
  published_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT,
  completeness TEXT,
  legacy_rank INTEGER,               -- position in the live API's default order; breaks sort ties like WordPress did
  legacy_v1 TEXT                     -- JSON: the recorded v1 object, served as-is for migrated spectra
);
CREATE INDEX spectra_status_type ON spectra(status, type);
CREATE INDEX spectra_formula ON spectra(formula);
CREATE INDEX spectra_author_slug ON spectra(author_slug);

CREATE TABLE spectrum_elements (
  spectrum_id INTEGER NOT NULL REFERENCES spectra(id) ON DELETE CASCADE,
  element TEXT NOT NULL,
  position INTEGER NOT NULL,
  PRIMARY KEY (spectrum_id, element)
);
CREATE INDEX spectrum_elements_element ON spectrum_elements(element);

CREATE TABLE spectrum_edges (
  spectrum_id INTEGER NOT NULL REFERENCES spectra(id) ON DELETE CASCADE,
  element TEXT NOT NULL,
  edge TEXT NOT NULL,
  position INTEGER NOT NULL,
  PRIMARY KEY (spectrum_id, element, edge)
);
CREATE INDEX spectrum_edges_edge ON spectrum_edges(edge);

CREATE TABLE spectrum_keywords (
  spectrum_id INTEGER NOT NULL REFERENCES spectra(id) ON DELETE CASCADE,
  keyword TEXT NOT NULL,
  position INTEGER NOT NULL,
  PRIMARY KEY (spectrum_id, keyword)
);

CREATE TABLE spectrum_links (
  spectrum_id INTEGER NOT NULL REFERENCES spectra(id) ON DELETE CASCADE,
  related_id INTEGER NOT NULL REFERENCES spectra(id) ON DELETE CASCADE,
  kind TEXT NOT NULL DEFAULT 'associated',
  position INTEGER NOT NULL,
  PRIMARY KEY (spectrum_id, related_id)
);

CREATE TABLE spectrum_other_urls (
  spectrum_id INTEGER NOT NULL REFERENCES spectra(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  title TEXT,
  position INTEGER NOT NULL
);

CREATE TABLE files (
  id INTEGER PRIMARY KEY,
  spectrum_id INTEGER NOT NULL REFERENCES spectra(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('original', 'msa', 'hspy', 'legacy')),
  r2_key TEXT UNIQUE NOT NULL,
  filename TEXT NOT NULL,
  media_type TEXT,
  bytes INTEGER,
  sha256 TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX files_spectrum ON files(spectrum_id);

CREATE TABLE eels_acquisition (
  spectrum_id INTEGER PRIMARY KEY REFERENCES spectra(id) ON DELETE CASCADE,
  microscope TEXT, gun_type TEXT, acquisition_mode TEXT, detector TEXT,
  beam_energy_kv REAL, beam_energy_source TEXT, beam_energy_uncertainty REAL,
  convergence_mrad REAL, convergence_source TEXT, convergence_uncertainty REAL,
  collection_mrad REAL, collection_source TEXT, collection_uncertainty REAL,
  resolution_ev REAL, monochromated INTEGER, probe_size_nm2 REAL, beam_current TEXT,
  integration_time_s REAL, readouts INTEGER, dispersion_ev REAL,
  instrument_profile_id INTEGER REFERENCES instruments(id), instrument_profile_version INTEGER
);

CREATE TABLE xas_acquisition (
  spectrum_id INTEGER PRIMARY KEY REFERENCES spectra(id) ON DELETE CASCADE,
  facility TEXT, beamline TEXT, source_type TEXT, monochromator TEXT, resolving_power REAL,
  detection_mode TEXT, polarisation TEXT, polarisation_angle_deg REAL,
  calibration_reference TEXT, i0_normalisation TEXT
);

CREATE TABLE treatment (
  spectrum_id INTEGER PRIMARY KEY REFERENCES spectra(id) ON DELETE CASCADE,
  dark_current INTEGER, gain_variation INTEGER, calibration TEXT, zeroloss_deconv TEXT,
  thickness_t_lambda REAL, thickness_source TEXT,
  deconv_fourier_log INTEGER, deconv_fourier_ratio INTEGER, deconv_stephens INTEGER,
  deconv_richardson_lucy INTEGER, deconv_maximum_entropy INTEGER, deconv_other TEXT
);

CREATE TABLE reference (
  spectrum_id INTEGER PRIMARY KEY REFERENCES spectra(id) ON DELETE CASCADE,
  doi TEXT, url TEXT, authors TEXT, journal TEXT, volume TEXT, issue TEXT, page TEXT,
  year TEXT, title TEXT, freetext TEXT
);

CREATE TABLE processing (
  spectrum_id INTEGER NOT NULL REFERENCES spectra(id) ON DELETE CASCADE,
  tool TEXT NOT NULL,
  version TEXT,
  run_at TEXT NOT NULL DEFAULT (datetime('now')),
  warnings_json TEXT
);

CREATE TABLE favourites (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  spectrum_id INTEGER NOT NULL REFERENCES spectra(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, spectrum_id)
);

CREATE TABLE submissions (
  id INTEGER PRIMARY KEY,
  spectrum_id INTEGER NOT NULL REFERENCES spectra(id) ON DELETE CASCADE,
  submitted_by INTEGER NOT NULL REFERENCES users(id),
  status TEXT NOT NULL CHECK (status IN ('pending', 'changes_requested', 'approved', 'rejected')),
  browser_checks_json TEXT,
  moderator_notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  decided_at TEXT,
  decided_by INTEGER REFERENCES users(id)
);

CREATE TABLE history (
  id INTEGER PRIMARY KEY,
  spectrum_id INTEGER NOT NULL REFERENCES spectra(id) ON DELETE CASCADE,
  user_id INTEGER REFERENCES users(id),
  at TEXT NOT NULL DEFAULT (datetime('now')),
  change_json TEXT NOT NULL
);
CREATE INDEX history_spectrum ON history(spectrum_id);

CREATE TABLE instruments (
  id INTEGER PRIMARY KEY,
  facility TEXT, name TEXT NOT NULL, manufacturer TEXT, spectrometer TEXT,
  voltages_kv_json TEXT,
  created_by INTEGER REFERENCES users(id),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'retired'))
);

CREATE TABLE instrument_calibrations (
  instrument_id INTEGER NOT NULL REFERENCES instruments(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('convergence', 'collection')),
  settings_json TEXT,
  value_mrad REAL,
  uncertainty_mrad REAL
);

CREATE TABLE news (
  id INTEGER PRIMARY KEY,            -- legacy WordPress post ID
  slug TEXT UNIQUE NOT NULL,
  title TEXT NOT NULL,
  published_at TEXT NOT NULL,
  body_html TEXT,
  legacy_rank INTEGER,
  legacy_v1 TEXT
);
