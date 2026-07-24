CREATE TABLE IF NOT EXISTS app_state (
  state_key text PRIMARY KEY,
  state jsonb NOT NULL,
  revision bigint NOT NULL DEFAULT 0 CHECK (revision >= 0),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS app_state_revisions (
  id bigserial PRIMARY KEY,
  state_key text NOT NULL,
  revision bigint NOT NULL CHECK (revision >= 0),
  state jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT app_state_revisions_state_revision_unique UNIQUE (state_key, revision)
);

CREATE INDEX IF NOT EXISTS app_state_revisions_lookup_idx
  ON app_state_revisions (state_key, revision DESC);
