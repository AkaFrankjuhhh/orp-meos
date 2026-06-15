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

CREATE TABLE IF NOT EXISTS blacklist_entries (
  id text PRIMARY KEY,
  person_id text,
  name text NOT NULL,
  discord_id text NOT NULL,
  rank text,
  service_number text,
  reason text,
  blacklisted_at timestamptz,
  blacklisted_by_id text,
  blacklisted_by_name text,
  revoked_at timestamptz,
  revoked_by_id text,
  revoked_by_name text,
  revoke_reason text,
  raw jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS blacklist_entries_discord_id_idx ON blacklist_entries(discord_id);
CREATE INDEX IF NOT EXISTS blacklist_entries_active_idx ON blacklist_entries(discord_id) WHERE revoked_at IS NULL;

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
  i8_number text,
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

ALTER TABLE IF EXISTS i8_forms ADD COLUMN IF NOT EXISTS i8_number text;

WITH numbered_i8 AS (
  SELECT
    id,
    lpad(row_number() over (order by created_at nulls last, id asc)::text, 3, '0') AS next_i8_number
  FROM i8_forms
)
UPDATE i8_forms
SET i8_number = numbered_i8.next_i8_number
FROM numbered_i8
WHERE i8_forms.id = numbered_i8.id
  AND coalesce(i8_forms.i8_number, '') = '';

CREATE UNIQUE INDEX IF NOT EXISTS i8_forms_i8_number_idx ON i8_forms(i8_number) WHERE coalesce(i8_number, '') <> '';
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


ALTER TABLE hours ADD COLUMN IF NOT EXISTS week_year integer;
ALTER TABLE hours ADD COLUMN IF NOT EXISTS week_number integer;
ALTER TABLE hours ADD COLUMN IF NOT EXISTS hours_value numeric(6,2);
ALTER TABLE hours ADD COLUMN IF NOT EXISTS entered_by_id text;
ALTER TABLE hours ADD COLUMN IF NOT EXISTS entered_by_name text;
ALTER TABLE hours ADD COLUMN IF NOT EXISTS entered_at timestamptz;
CREATE INDEX IF NOT EXISTS hours_week_idx ON hours(person_id, week_year, week_number);
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
CREATE INDEX IF NOT EXISTS porto_units_active_requested_idx ON porto_units(active, requested_at, id);
CREATE INDEX IF NOT EXISTS porto_units_active_vehicle_idx ON porto_units(vehicle_number, active, updated_at DESC);

WITH ranked_active_porto_units AS (
  SELECT
    id,
    row_number() over (
      PARTITION BY member_id
      ORDER BY updated_at DESC NULLS LAST, assigned_at DESC NULLS LAST, requested_at DESC NULLS LAST, id DESC
    ) AS rn
  FROM porto_units
  WHERE active = true
    AND member_id IS NOT NULL
    AND member_id <> ''
)
UPDATE porto_units
SET
  active = false,
  status = '8',
  status_detail = 'Dubbele Porto-aanmelding automatisch opgeschoond',
  vehicle_number = '',
  vehicle_code = '',
  vehicle_type = '',
  vehicle_name = '',
  linked_with = '[]'::jsonb,
  ended_at = now(),
  updated_at = now()
WHERE id IN (
  SELECT id
  FROM ranked_active_porto_units
  WHERE rn > 1
);

CREATE UNIQUE INDEX IF NOT EXISTS porto_units_one_active_member_uidx
  ON porto_units(member_id)
  WHERE active = true
    AND member_id IS NOT NULL
    AND member_id <> '';

CREATE TABLE IF NOT EXISTS activity_log (
  id bigserial PRIMARY KEY,
  position integer,
  message text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public_form_submissions (
  id text PRIMARY KEY,
  form_slug text NOT NULL,
  form_title text NOT NULL,
  answers jsonb NOT NULL DEFAULT '{}'::jsonb,
  submitted_at timestamptz NOT NULL DEFAULT now(),
  ip text,
  user_agent text,
  case_number integer,
  webhook_status text,
  raw jsonb NOT NULL DEFAULT '{}'::jsonb
);

ALTER TABLE public_form_submissions ADD COLUMN IF NOT EXISTS case_number integer;
CREATE INDEX IF NOT EXISTS public_form_submissions_slug_idx ON public_form_submissions(form_slug, submitted_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS public_form_submissions_slug_case_number_uidx ON public_form_submissions(form_slug, case_number) WHERE case_number IS NOT NULL;


CREATE TABLE IF NOT EXISTS public_form_configs (
  slug text PRIMARY KEY,
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_by_id text,
  updated_by_name text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS audit_log (
  id uuid PRIMARY KEY,
  scope text NOT NULL,
  action text NOT NULL,
  target_id text,
  target_label text,
  actor_id text,
  actor_name text,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS audit_log_scope_created_idx ON audit_log(scope, created_at DESC);
CREATE INDEX IF NOT EXISTS audit_log_target_idx ON audit_log(target_id, created_at DESC);


CREATE TABLE IF NOT EXISTS discord_sync_jobs (
  id uuid PRIMARY KEY,
  type text NOT NULL,
  person_id text REFERENCES people(id) ON DELETE SET NULL,
  discord_id text,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'pending',
  attempts integer NOT NULL DEFAULT 0,
  max_attempts integer NOT NULL DEFAULT 5,
  last_error text,
  run_after timestamptz NOT NULL DEFAULT now(),
  locked_at timestamptz,
  locked_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

CREATE INDEX IF NOT EXISTS discord_sync_jobs_status_run_idx ON discord_sync_jobs(status, run_after, created_at);
CREATE INDEX IF NOT EXISTS discord_sync_jobs_person_idx ON discord_sync_jobs(person_id, created_at DESC);
CREATE INDEX IF NOT EXISTS discord_sync_jobs_discord_idx ON discord_sync_jobs(discord_id, created_at DESC);

CREATE TABLE IF NOT EXISTS side_task_members (
  id text PRIMARY KEY,
  task_key text NOT NULL,
  discord_id text NOT NULL,
  discord_username text NOT NULL DEFAULT '',
  display_name text NOT NULL DEFAULT '',
  avatar_url text NOT NULL DEFAULT '',
  call_sign text NOT NULL DEFAULT '',
  alias_name text NOT NULL DEFAULT '',
  original_nickname text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT '8',
  status_detail text NOT NULL DEFAULT 'Niet aanwezig',
  specialties jsonb NOT NULL DEFAULT '[]'::jsonb,
  added_by_discord_id text NOT NULL DEFAULT '',
  raw jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS side_task_members_task_discord_uidx ON side_task_members(task_key, discord_id);
CREATE INDEX IF NOT EXISTS side_task_members_task_status_idx ON side_task_members(task_key, status, updated_at DESC);
