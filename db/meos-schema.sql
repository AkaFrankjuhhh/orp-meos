BEGIN;

CREATE TABLE IF NOT EXISTS meos_person_entries (
  id text PRIMARY KEY,
  person_id text NOT NULL,
  entry_type text NOT NULL CHECK (entry_type IN ('record', 'note', 'fine')),
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS meos_person_entries_person_type_created_idx
  ON meos_person_entries(person_id, entry_type, created_at DESC);

CREATE TABLE IF NOT EXISTS meos_process_verbals (
  id text PRIMARY KEY,
  created_by_key text NOT NULL,
  status text NOT NULL CHECK (status IN ('concept', 'definitief')),
  type text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS meos_process_verbals_owner_updated_idx
  ON meos_process_verbals(created_by_key, updated_at DESC);
CREATE INDEX IF NOT EXISTS meos_process_verbals_status_updated_idx
  ON meos_process_verbals(status, updated_at DESC);

CREATE TABLE IF NOT EXISTS meos_general_notes (
  actor_key text PRIMARY KEY,
  note text NOT NULL DEFAULT '',
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

CREATE INDEX IF NOT EXISTS audit_log_scope_created_idx
  ON audit_log(scope, created_at DESC);
CREATE INDEX IF NOT EXISTS audit_log_target_idx
  ON audit_log(target_id, created_at DESC);

COMMIT;
