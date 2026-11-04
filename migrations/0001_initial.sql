CREATE TABLE IF NOT EXISTS heymyguide_leads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL CHECK (kind IN ('traveler', 'guide')),
  email_normalized TEXT NOT NULL CHECK (length(email_normalized) <= 254),
  display_name TEXT CHECK (display_name IS NULL OR length(display_name) <= 100),
  city TEXT CHECK (city IS NULL OR length(city) <= 80),
  destination TEXT CHECK (destination IS NULL OR length(destination) <= 100),
  languages TEXT CHECK (languages IS NULL OR length(languages) <= 160),
  consent_version TEXT NOT NULL,
  consent_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  source_ip_hash TEXT NOT NULL CHECK (length(source_ip_hash) = 64),
  status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'contacted', 'closed')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (kind, email_normalized)
);

CREATE INDEX IF NOT EXISTS idx_heymyguide_leads_created_at
  ON heymyguide_leads (created_at);

CREATE TABLE IF NOT EXISTS lead_rate_limits (
  ip_hash TEXT PRIMARY KEY CHECK (length(ip_hash) = 64),
  window_started_at INTEGER NOT NULL,
  request_count INTEGER NOT NULL CHECK (request_count > 0)
);
