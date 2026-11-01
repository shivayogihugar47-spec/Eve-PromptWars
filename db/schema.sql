-- EventMate Live – database schema
-- Run via: npm run db:migrate

-- Enable pgcrypto for gen_random_uuid() on older Postgres versions
-- (Neon ships Postgres 16 which has it built-in)

-- -----------------------------------------------------------------------
-- events
-- -----------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS events (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  stage        TEXT        NOT NULL DEFAULT 'ask',
  answers      JSONB       NOT NULL DEFAULT '{}',
  event_type   TEXT,
  event_date   DATE,
  budget_total NUMERIC,
  current_plan_version INT NOT NULL DEFAULT 0,
  organizer_token_hash TEXT,
  organizer_token_expires_at TIMESTAMPTZ,
  owner_user_id TEXT,
  event_end_at TIMESTAMPTZ,
  venue_closes_at TEXT,
  outdoor BOOLEAN NOT NULL DEFAULT FALSE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- -----------------------------------------------------------------------
-- tasks
-- -----------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS tasks (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id     UUID        REFERENCES events(id) ON DELETE CASCADE,
  title        TEXT        NOT NULL,
  start_time   TIMESTAMPTZ,
  duration_min INT,
  owner_name   TEXT,
  owner_phone  TEXT,
  depends_on   UUID[]      NOT NULL DEFAULT '{}',
  budget_item  TEXT,
  status       TEXT        NOT NULL DEFAULT 'pending',
  end_time     TIMESTAMPTZ,
  actual_start_time TIMESTAMPTZ,
  actual_end_time TIMESTAMPTZ,
  vendor_name  TEXT
);

-- -----------------------------------------------------------------------
-- budget_items
-- -----------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS budget_items (
  id         UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id   UUID    REFERENCES events(id) ON DELETE CASCADE,
  category   TEXT    NOT NULL,
  allocated  NUMERIC NOT NULL,
  actual     NUMERIC NOT NULL DEFAULT 0
);

-- -----------------------------------------------------------------------
-- expenses
-- -----------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS expenses (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id   UUID        REFERENCES events(id) ON DELETE CASCADE,
  vendor     TEXT        NOT NULL,
  amount     NUMERIC     NOT NULL,
  category   TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- -----------------------------------------------------------------------
-- messages
-- -----------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS messages (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id   UUID        REFERENCES events(id) ON DELETE CASCADE,
  role       TEXT        NOT NULL,
  content    TEXT        NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- -----------------------------------------------------------------------
-- plan_versions
-- -----------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS plan_versions (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id    UUID        REFERENCES events(id) ON DELETE CASCADE,
  version     INT         NOT NULL,
  plan        JSONB       NOT NULL,
  change_note TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE events ADD COLUMN IF NOT EXISTS current_plan_version INT NOT NULL DEFAULT 0;
ALTER TABLE events ADD COLUMN IF NOT EXISTS organizer_token_hash TEXT;
ALTER TABLE events ADD COLUMN IF NOT EXISTS organizer_token_expires_at TIMESTAMPTZ;
UPDATE events
SET organizer_token_expires_at = created_at + INTERVAL '90 days'
WHERE organizer_token_hash IS NOT NULL AND organizer_token_expires_at IS NULL;
ALTER TABLE events ADD COLUMN IF NOT EXISTS owner_user_id TEXT;
ALTER TABLE events ADD COLUMN IF NOT EXISTS event_end_at TIMESTAMPTZ;
ALTER TABLE events ADD COLUMN IF NOT EXISTS venue_closes_at TEXT;
ALTER TABLE events ADD COLUMN IF NOT EXISTS outdoor BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS end_time TIMESTAMPTZ;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS actual_start_time TIMESTAMPTZ;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS actual_end_time TIMESTAMPTZ;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS vendor_name TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS plan_versions_event_version_idx ON plan_versions(event_id, version);
CREATE INDEX IF NOT EXISTS events_owner_created_idx ON events(owner_user_id, created_at DESC);

-- Append-only history. The restrictive foreign key prevents an event deletion
-- from cascading into the audit log.
CREATE TABLE IF NOT EXISTS plan_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID NOT NULL REFERENCES events(id),
  type TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}',
  actor TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS plan_events_event_created_idx ON plan_events(event_id, created_at DESC);

CREATE OR REPLACE FUNCTION reject_plan_event_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'plan_events is append-only';
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS plan_events_no_update_or_delete ON plan_events;
CREATE TRIGGER plan_events_no_update_or_delete
  BEFORE UPDATE OR DELETE ON plan_events
  FOR EACH ROW EXECUTE FUNCTION reject_plan_event_mutation();

CREATE TABLE IF NOT EXISTS risks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID NOT NULL REFERENCES events(id),
  title TEXT NOT NULL,
  trigger_type TEXT NOT NULL,
  likelihood TEXT NOT NULL CHECK (likelihood IN ('low', 'medium', 'high')),
  backup_action JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'ready' CHECK (status IN ('ready', 'triggered', 'resolved', 'dismissed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS risks_event_status_idx ON risks(event_id, status);

CREATE TABLE IF NOT EXISTS owner_links (
  token TEXT PRIMARY KEY,
  event_id UUID NOT NULL REFERENCES events(id),
  task_ids UUID[] NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS run_proposals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID NOT NULL REFERENCES events(id),
  source_version INT NOT NULL,
  payload JSONB NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL DEFAULT now() + interval '30 minutes',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS run_proposals_event_expiry_idx ON run_proposals(event_id, expires_at);

CREATE TABLE IF NOT EXISTS run_apply_requests (
  idempotency_key TEXT PRIMARY KEY,
  event_id UUID NOT NULL REFERENCES events(id),
  version INT NOT NULL,
  operation_nonce UUID NOT NULL UNIQUE,
  result JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE run_apply_requests ADD COLUMN IF NOT EXISTS operation_nonce UUID;
CREATE UNIQUE INDEX IF NOT EXISTS run_apply_operation_nonce_idx ON run_apply_requests(operation_nonce);

CREATE TABLE IF NOT EXISTS run_rate_limits (
  bucket TEXT NOT NULL,
  window_started_at TIMESTAMPTZ NOT NULL,
  hits INT NOT NULL,
  PRIMARY KEY (bucket, window_started_at)
);

CREATE TABLE IF NOT EXISTS event_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID NOT NULL REFERENCES events(id),
  name TEXT NOT NULL,
  structure JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
