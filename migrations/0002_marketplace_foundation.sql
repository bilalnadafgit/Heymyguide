PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS marketplace_users (
  id TEXT PRIMARY KEY CHECK (length(id) = 36),
  role TEXT NOT NULL CHECK (role IN ('traveler', 'guide', 'admin')),
  email_normalized TEXT CHECK (email_normalized IS NULL OR length(email_normalized) <= 254),
  phone_e164 TEXT CHECK (phone_e164 IS NULL OR length(phone_e164) BETWEEN 8 AND 16),
  email_verified_at TEXT,
  phone_verified_at TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'active', 'suspended', 'closed')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  CHECK (email_normalized IS NOT NULL OR phone_e164 IS NOT NULL)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_marketplace_users_email
  ON marketplace_users (email_normalized) WHERE email_normalized IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_marketplace_users_phone
  ON marketplace_users (phone_e164) WHERE phone_e164 IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_marketplace_users_role_status
  ON marketplace_users (role, status);
CREATE UNIQUE INDEX IF NOT EXISTS idx_single_active_marketplace_admin
  ON marketplace_users (role) WHERE role = 'admin' AND status = 'active';

CREATE TABLE IF NOT EXISTS auth_challenges (
  id TEXT PRIMARY KEY CHECK (length(id) = 36),
  subject_hash TEXT NOT NULL CHECK (length(subject_hash) = 64),
  purpose TEXT NOT NULL CHECK (purpose IN ('sign_in', 'admin_bootstrap')),
  role TEXT NOT NULL CHECK (role IN ('traveler', 'guide', 'admin')),
  channel TEXT NOT NULL CHECK (channel IN ('email', 'phone')),
  contact_value TEXT NOT NULL CHECK (length(contact_value) BETWEEN 8 AND 254),
  code_hash TEXT NOT NULL CHECK (length(code_hash) = 64),
  expires_at INTEGER NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 5),
  consumed_at INTEGER,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_auth_challenges_expiry ON auth_challenges (expires_at);

CREATE TABLE IF NOT EXISTS auth_rate_limits (
  rate_key_hash TEXT PRIMARY KEY CHECK (length(rate_key_hash) = 64),
  window_started_at INTEGER NOT NULL,
  request_count INTEGER NOT NULL CHECK (request_count > 0)
);

CREATE TABLE IF NOT EXISTS auth_sessions (
  id_hash TEXT PRIMARY KEY CHECK (length(id_hash) = 64),
  user_id TEXT NOT NULL REFERENCES marketplace_users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL,
  revoked_at INTEGER,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_auth_sessions_user ON auth_sessions (user_id, expires_at);

CREATE TABLE IF NOT EXISTS guide_profiles (
  user_id TEXT PRIMARY KEY REFERENCES marketplace_users(id) ON DELETE CASCADE,
  display_name TEXT NOT NULL CHECK (length(display_name) BETWEEN 1 AND 100),
  country_code TEXT NOT NULL CHECK (length(country_code) = 2),
  country_name TEXT NOT NULL CHECK (length(country_name) BETWEEN 1 AND 100),
  region TEXT NOT NULL CHECK (length(region) BETWEEN 1 AND 120),
  city TEXT NOT NULL CHECK (length(city) BETWEEN 1 AND 120),
  timezone TEXT NOT NULL CHECK (length(timezone) BETWEEN 1 AND 80),
  bio TEXT NOT NULL DEFAULT '' CHECK (length(bio) <= 2000),
  languages_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(languages_json)),
  daily_fee_minor INTEGER NOT NULL CHECK (daily_fee_minor > 0),
  currency TEXT NOT NULL CHECK (length(currency) = 3),
  verification_status TEXT NOT NULL DEFAULT 'pending' CHECK (verification_status IN ('pending', 'approved', 'rejected', 'suspended')),
  verification_provider TEXT,
  verification_reference TEXT,
  public_listing INTEGER NOT NULL DEFAULT 0 CHECK (public_listing IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  CHECK (public_listing = 0 OR verification_status = 'approved')
);
CREATE INDEX IF NOT EXISTS idx_guide_profiles_location
  ON guide_profiles (country_code, region, city, verification_status, public_listing);

CREATE TABLE IF NOT EXISTS guide_experiences (
  id TEXT PRIMARY KEY CHECK (length(id) = 36),
  guide_user_id TEXT NOT NULL REFERENCES guide_profiles(user_id) ON DELETE CASCADE,
  title TEXT NOT NULL CHECK (length(title) BETWEEN 3 AND 120),
  description TEXT NOT NULL CHECK (length(description) BETWEEN 1 AND 3000),
  duration_minutes INTEGER NOT NULL CHECK (duration_minutes BETWEEN 30 AND 1440),
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX IF NOT EXISTS idx_guide_experiences_active
  ON guide_experiences (guide_user_id, active);

CREATE TABLE IF NOT EXISTS guide_availability (
  id TEXT PRIMARY KEY CHECK (length(id) = 36),
  guide_user_id TEXT NOT NULL REFERENCES guide_profiles(user_id) ON DELETE CASCADE,
  starts_at TEXT NOT NULL,
  ends_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'held', 'booked', 'blocked', 'completed')),
  hold_expires_at INTEGER,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  CHECK (julianday(ends_at) > julianday(starts_at))
);
CREATE INDEX IF NOT EXISTS idx_guide_availability_open
  ON guide_availability (guide_user_id, status, starts_at, ends_at);

CREATE TABLE IF NOT EXISTS guide_bookings (
  id TEXT PRIMARY KEY CHECK (length(id) = 36),
  traveler_user_id TEXT NOT NULL REFERENCES marketplace_users(id),
  guide_user_id TEXT NOT NULL REFERENCES guide_profiles(user_id),
  availability_id TEXT NOT NULL REFERENCES guide_availability(id),
  experience_id TEXT REFERENCES guide_experiences(id),
  status TEXT NOT NULL DEFAULT 'requested' CHECK (status IN ('requested', 'confirmed', 'in_progress', 'completion_pending', 'completed', 'cancelled', 'disputed')),
  starts_at TEXT NOT NULL,
  ends_at TEXT NOT NULL,
  guide_fee_minor INTEGER NOT NULL CHECK (guide_fee_minor > 0),
  currency TEXT NOT NULL CHECK (length(currency) = 3),
  payment_method TEXT NOT NULL DEFAULT 'cash_direct' CHECK (payment_method IN ('cash_direct', 'online_future')),
  cash_status TEXT NOT NULL DEFAULT 'not_due' CHECK (cash_status IN ('not_due', 'due', 'guide_reported_paid', 'traveler_confirmed', 'disputed')),
  requested_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  confirmed_at TEXT,
  completed_at TEXT,
  cancelled_at TEXT,
  CHECK (julianday(ends_at) > julianday(starts_at)),
  CHECK (traveler_user_id <> guide_user_id)
);
CREATE INDEX IF NOT EXISTS idx_guide_bookings_traveler
  ON guide_bookings (traveler_user_id, requested_at);
CREATE INDEX IF NOT EXISTS idx_guide_bookings_guide
  ON guide_bookings (guide_user_id, status, starts_at);
CREATE TABLE IF NOT EXISTS booking_completion_challenges (
  booking_id TEXT PRIMARY KEY REFERENCES guide_bookings(id) ON DELETE CASCADE,
  code_hash TEXT NOT NULL CHECK (length(code_hash) = 64),
  expires_at INTEGER NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 5),
  verified_at INTEGER,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS marketplace_audit_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  actor_user_id TEXT REFERENCES marketplace_users(id) ON DELETE SET NULL,
  subject_user_id TEXT REFERENCES marketplace_users(id) ON DELETE SET NULL,
  booking_id TEXT REFERENCES guide_bookings(id) ON DELETE SET NULL,
  event_type TEXT NOT NULL CHECK (length(event_type) BETWEEN 1 AND 80),
  details_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(details_json)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX IF NOT EXISTS idx_marketplace_audit_created
  ON marketplace_audit_events (created_at);

CREATE TABLE IF NOT EXISTS safety_reports (
  id TEXT PRIMARY KEY CHECK (length(id) = 36),
  reporter_user_id TEXT NOT NULL REFERENCES marketplace_users(id),
  reported_user_id TEXT NOT NULL REFERENCES marketplace_users(id),
  booking_id TEXT REFERENCES guide_bookings(id),
  category TEXT NOT NULL CHECK (category IN ('safety', 'misconduct', 'payment', 'no_show', 'other')),
  description TEXT NOT NULL CHECK (length(description) BETWEEN 10 AND 3000),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'reviewing', 'resolved', 'dismissed')),
  resolution_note TEXT CHECK (resolution_note IS NULL OR length(resolution_note) <= 1000),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  CHECK (reporter_user_id <> reported_user_id)
);
CREATE INDEX IF NOT EXISTS idx_safety_reports_status
  ON safety_reports (status, created_at);

CREATE TRIGGER IF NOT EXISTS prevent_guide_availability_overlap_insert
BEFORE INSERT ON guide_availability
WHEN NEW.status IN ('open', 'held', 'booked')
 AND EXISTS (
   SELECT 1 FROM guide_availability existing
   WHERE existing.guide_user_id = NEW.guide_user_id
     AND existing.status IN ('open', 'held', 'booked')
     AND julianday(existing.starts_at) < julianday(NEW.ends_at)
     AND julianday(existing.ends_at) > julianday(NEW.starts_at)
 )
BEGIN
  SELECT RAISE(ABORT, 'guide availability overlaps an existing slot');
END;

CREATE TRIGGER IF NOT EXISTS prevent_guide_availability_overlap_update
BEFORE UPDATE OF starts_at, ends_at, status, guide_user_id ON guide_availability
WHEN NEW.status IN ('open', 'held', 'booked')
 AND EXISTS (
   SELECT 1 FROM guide_availability existing
   WHERE existing.id <> NEW.id
     AND existing.guide_user_id = NEW.guide_user_id
     AND existing.status IN ('open', 'held', 'booked')
     AND julianday(existing.starts_at) < julianday(NEW.ends_at)
     AND julianday(existing.ends_at) > julianday(NEW.starts_at)
 )
BEGIN
  SELECT RAISE(ABORT, 'guide availability overlaps an existing slot');
END;

CREATE TRIGGER IF NOT EXISTS require_verified_guide_for_public_listing
BEFORE UPDATE OF public_listing, verification_status ON guide_profiles
WHEN NEW.public_listing = 1 AND (
  NEW.verification_status <> 'approved'
  OR NOT EXISTS (
    SELECT 1 FROM marketplace_users user
    WHERE user.id = NEW.user_id
      AND user.role = 'guide'
      AND user.status = 'active'
      AND user.phone_verified_at IS NOT NULL
  )
)
BEGIN
  SELECT RAISE(ABORT, 'public listings require an active phone-verified approved guide');
END;

CREATE TRIGGER IF NOT EXISTS require_verified_guide_for_public_listing_insert
BEFORE INSERT ON guide_profiles
WHEN NEW.public_listing = 1 AND (
  NEW.verification_status <> 'approved'
  OR NOT EXISTS (
    SELECT 1 FROM marketplace_users user
    WHERE user.id = NEW.user_id
      AND user.role = 'guide'
      AND user.status = 'active'
      AND user.phone_verified_at IS NOT NULL
  )
)
BEGIN
  SELECT RAISE(ABORT, 'public listings require an active phone-verified approved guide');
END;

CREATE TRIGGER IF NOT EXISTS require_verified_guide_for_availability_insert
BEFORE INSERT ON guide_availability
WHEN NOT EXISTS (
  SELECT 1
  FROM guide_profiles profile
  JOIN marketplace_users user ON user.id = profile.user_id
  WHERE profile.user_id = NEW.guide_user_id
    AND profile.verification_status = 'approved'
    AND user.role = 'guide'
    AND user.status = 'active'
    AND user.phone_verified_at IS NOT NULL
)
BEGIN
  SELECT RAISE(ABORT, 'only active, phone-verified, approved guides can publish availability');
END;

CREATE TRIGGER IF NOT EXISTS require_verified_guide_for_availability_update
BEFORE UPDATE OF guide_user_id, status ON guide_availability
WHEN NEW.status IN ('open', 'held')
 AND NOT EXISTS (
  SELECT 1
  FROM guide_profiles profile
  JOIN marketplace_users user ON user.id = profile.user_id
  WHERE profile.user_id = NEW.guide_user_id
    AND profile.verification_status = 'approved'
    AND user.role = 'guide'
    AND user.status = 'active'
    AND user.phone_verified_at IS NOT NULL
)
BEGIN
  SELECT RAISE(ABORT, 'only active, phone-verified, approved guides can offer availability');
END;

CREATE TRIGGER IF NOT EXISTS validate_booking_insert
BEFORE INSERT ON guide_bookings
WHEN NOT EXISTS (
  SELECT 1
  FROM guide_availability slot
  JOIN guide_profiles profile ON profile.user_id = slot.guide_user_id
  JOIN marketplace_users guide ON guide.id = profile.user_id
  JOIN marketplace_users traveler ON traveler.id = NEW.traveler_user_id
  WHERE slot.id = NEW.availability_id
    AND slot.guide_user_id = NEW.guide_user_id
    AND slot.status = 'held'
    AND slot.starts_at = NEW.starts_at
    AND slot.ends_at = NEW.ends_at
    AND profile.verification_status = 'approved'
    AND profile.public_listing = 1
    AND guide.role = 'guide'
    AND guide.status = 'active'
    AND guide.phone_verified_at IS NOT NULL
    AND traveler.role = 'traveler'
    AND traveler.status = 'active'
    AND (traveler.email_verified_at IS NOT NULL OR traveler.phone_verified_at IS NOT NULL)
)
BEGIN
  SELECT RAISE(ABORT, 'booking requires a held slot, verified public guide, and verified traveler contact');
END;

CREATE TRIGGER IF NOT EXISTS mark_slot_booked_after_booking_insert
AFTER INSERT ON guide_bookings
BEGIN
  UPDATE guide_availability
  SET status = 'booked'
  WHERE id = NEW.availability_id AND status = 'held';
END;

CREATE TRIGGER IF NOT EXISTS release_slot_after_booking_cancel
AFTER UPDATE OF status ON guide_bookings
WHEN NEW.status = 'cancelled' AND OLD.status <> 'cancelled'
BEGIN
  UPDATE guide_availability
  SET status = CASE WHEN EXISTS (
    SELECT 1 FROM guide_profiles profile
    JOIN marketplace_users user ON user.id = profile.user_id
    WHERE profile.user_id = NEW.guide_user_id
      AND profile.verification_status = 'approved'
      AND user.role = 'guide'
      AND user.status = 'active'
      AND user.phone_verified_at IS NOT NULL
  ) THEN 'open' ELSE 'blocked' END,
  hold_expires_at = NULL
  WHERE id = NEW.availability_id AND status = 'booked';
END;

CREATE TRIGGER IF NOT EXISTS require_completion_otp_before_booking_complete
BEFORE UPDATE OF status ON guide_bookings
WHEN NEW.status = 'completed'
 AND (
   OLD.status <> 'completion_pending'
   OR NOT EXISTS (
     SELECT 1 FROM booking_completion_challenges challenge
     WHERE challenge.booking_id = NEW.id
       AND challenge.verified_at IS NOT NULL
   )
 )
BEGIN
  SELECT RAISE(ABORT, 'traveler must verify the trip completion code before completion');
END;

CREATE TRIGGER IF NOT EXISTS finish_slot_after_booking_complete
AFTER UPDATE OF status ON guide_bookings
WHEN NEW.status = 'completed' AND OLD.status <> 'completed'
BEGIN
  UPDATE guide_availability SET status = 'completed'
  WHERE id = NEW.availability_id AND status = 'booked';
  UPDATE guide_bookings SET cash_status = 'due'
  WHERE id = NEW.id AND cash_status = 'not_due';
END;

CREATE TRIGGER IF NOT EXISTS enforce_booking_status_transitions
BEFORE UPDATE OF status ON guide_bookings
WHEN NEW.status <> OLD.status
 AND NOT (
   (OLD.status = 'requested' AND NEW.status IN ('confirmed', 'cancelled'))
   OR (OLD.status = 'confirmed' AND NEW.status IN ('in_progress', 'cancelled'))
   OR (OLD.status = 'in_progress' AND NEW.status = 'completion_pending')
   OR (OLD.status = 'completion_pending' AND NEW.status IN ('completed', 'disputed'))
   OR (OLD.status = 'completed' AND NEW.status = 'disputed')
 )
BEGIN
  SELECT RAISE(ABORT, 'invalid booking status transition');
END;

CREATE TRIGGER IF NOT EXISTS enforce_cash_status_transitions
BEFORE UPDATE OF cash_status ON guide_bookings
WHEN NEW.cash_status <> OLD.cash_status
 AND NOT (
   (OLD.cash_status = 'not_due' AND NEW.cash_status = 'due')
   OR (OLD.cash_status = 'due' AND NEW.cash_status IN ('guide_reported_paid', 'disputed'))
   OR (OLD.cash_status = 'guide_reported_paid' AND NEW.cash_status IN ('traveler_confirmed', 'disputed'))
 )
BEGIN
  SELECT RAISE(ABORT, 'invalid cash payment status transition');
END;

CREATE TRIGGER IF NOT EXISTS validate_booking_completion_pending
BEFORE UPDATE OF status ON guide_bookings
WHEN NEW.status = 'completion_pending'
 AND (
   OLD.status <> 'in_progress'
   OR julianday(NEW.ends_at) > julianday('now')
 )
BEGIN
  SELECT RAISE(ABORT, 'trip completion can be requested only after the scheduled end');
END;

CREATE TRIGGER IF NOT EXISTS validate_booking_start
BEFORE UPDATE OF status ON guide_bookings
WHEN NEW.status = 'in_progress'
 AND (
   OLD.status <> 'confirmed'
   OR julianday(NEW.starts_at) > julianday('now')
   OR julianday(NEW.ends_at) <= julianday('now')
 )
BEGIN
  SELECT RAISE(ABORT, 'trip can start only during its confirmed time slot');
END;
