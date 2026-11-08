DO $$
BEGIN
-- Shared infrastructure counters contain no workspace content. Detailed entries
-- remain private to the workspace that reserved the request.
CREATE TABLE IF NOT EXISTS exa_budget_accounts (
  scope text PRIMARY KEY, day text NOT NULL,
  charged bigint NOT NULL DEFAULT 0, held bigint NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS exa_budget_reservations (
  id text PRIMARY KEY, scope text NOT NULL REFERENCES exa_budget_accounts(scope),
  workspace_id text NOT NULL, day text NOT NULL, maximum bigint NOT NULL,
  charged bigint, remote_id text, state text NOT NULL DEFAULT 'reserved',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS exa_budget_remote ON exa_budget_reservations(workspace_id,remote_id);
END $$;
