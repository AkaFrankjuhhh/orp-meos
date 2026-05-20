-- Defensie Personeelsportaal PostgreSQL basis schema.
-- Dit schema is bedoeld als eerste migratiestap: data.json kan hierin worden geimporteerd,
-- waarna we de applicatie per onderdeel gecontroleerd van JSON naar tabellen ombouwen.

CREATE TABLE IF NOT EXISTS app_settings (
  key text PRIMARY KEY,
  value jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);


-- Browser logins worden server-side bewaard zodat herstarts niet direct iedereen uitloggen.
CREATE TABLE IF NOT EXISTS app_sessions (
  id text PRIMARY KEY,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS app_sessions_expires_at_idx ON app_sessions(expires_at);
CREATE TABLE IF NOT EXISTS people (
  id text PRIMARY KEY,
  name text NOT NULL,
  discord_id text,
  discord_username text,
  avatar text,
  rank text,
  service_number text,
  perm_role text,
  rank_date text,
  promotion_date text,
  hired_date text,
  status text NOT NULL DEFAULT 'Actief',
  tasks text,
  previous_service_number text,
  dismissal_date text,
  dismissal_reason text,
  archived_until text,
  reactivated_date text,
  porto_phone text,
  discord_roles jsonb NOT NULL DEFAULT '[]'::jsonb,
  completed_trainings jsonb NOT NULL DEFAULT '[]'::jsonb,
  completed_operational jsonb NOT NULL DEFAULT '[]'::jsonb,
  badges jsonb NOT NULL DEFAULT '[]'::jsonb,
  extra_functions jsonb NOT NULL DEFAULT '[]'::jsonb,
  rank_history jsonb NOT NULL DEFAULT '[]'::jsonb,
  discipline jsonb NOT NULL DEFAULT '[]'::jsonb,
  mentor_checklist jsonb NOT NULL DEFAULT '{}'::jsonb,
  raw jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS people_discord_id_idx ON people(discord_id);
CREATE INDEX IF NOT EXISTS people_status_idx ON people(status);
CREATE INDEX IF NOT EXISTS people_service_number_idx ON people(service_number);

CREATE TABLE IF NOT EXISTS absences (
  id text PRIMARY KEY,
  member_id text REFERENCES people(id) ON DELETE SET NULL,
  name text,
  rank text,
  service_number text,
  from_date text,
  to_date text,
  reason text,
  status text,
  requested_at timestamptz,
  reviewed_at timestamptz,
  reviewed_by_id text,
  reviewed_by_name text,
  raw jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS i8_forms (
  id text PRIMARY KEY,
  person_id text REFERENCES people(id) ON DELETE SET NULL,
  person_name text,
  service_number text,
  rank text,
  violence_date text,
  violence_time text,
  location text,
  opco_ovd_name text,
  description text,
  force_used text,
  vehicle_violence text,
  third_party_injury text,
  truth_confirmed boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'pending',
  rejection_reason text NOT NULL DEFAULT '',
  created_at timestamptz,
  reviewed_at timestamptz,
  reviewed_by_id text,
  reviewed_by_name text,
  raw jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS i8_forms_status_idx ON i8_forms(status);
CREATE INDEX IF NOT EXISTS i8_forms_person_id_idx ON i8_forms(person_id);
CREATE INDEX IF NOT EXISTS i8_forms_created_at_idx ON i8_forms(created_at);

CREATE TABLE IF NOT EXISTS resignation_forms (
  id text PRIMARY KEY,
  member_id text REFERENCES people(id) ON DELETE SET NULL,
  name text,
  rank text,
  service_number text,
  reason text,
  status text,
  requested_at timestamptz,
  processed_at timestamptz,
  processed_by_id text,
  processed_by_name text,
  raw jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS hours (
  id text PRIMARY KEY,
  person_id text REFERENCES people(id) ON DELETE SET NULL,
  discord_id text,
  job text,
  started_at timestamptz,
  ended_at timestamptz,
  minutes integer NOT NULL DEFAULT 0,
  raw jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS porto_units (
  id text PRIMARY KEY,
  member_id text REFERENCES people(id) ON DELETE SET NULL,
  name text,
  rank text,
  service_number text,
  phone text,
  status text,
  status_detail text,
  vehicle_number text,
  vehicle_code text,
  vehicle_type text,
  vehicle_name text,
  linked_with jsonb NOT NULL DEFAULT '[]'::jsonb,
  active boolean NOT NULL DEFAULT true,
  requested_at timestamptz,
  assigned_at timestamptz,
  ended_at timestamptz,
  last_seen_at timestamptz,
  raw jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS porto_units_active_idx ON porto_units(active);
CREATE INDEX IF NOT EXISTS porto_units_vehicle_number_idx ON porto_units(vehicle_number);
CREATE INDEX IF NOT EXISTS porto_units_member_id_idx ON porto_units(member_id);

CREATE TABLE IF NOT EXISTS activity_log (
  id bigserial PRIMARY KEY,
  position integer,
  message text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
