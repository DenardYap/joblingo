DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='workspace_records' AND column_name='workspace_id') THEN
    ALTER TABLE workspace_records ADD COLUMN workspace_id text NOT NULL DEFAULT 'legacy';
    ALTER TABLE workspace_records DROP CONSTRAINT IF EXISTS workspace_records_pkey;
    ALTER TABLE workspace_records DROP CONSTRAINT IF EXISTS workspace_records_kind_id_pk;
    ALTER TABLE workspace_records ADD PRIMARY KEY (workspace_id,kind,id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='search_lease' AND column_name='workspace_id') THEN
    ALTER TABLE search_lease ADD COLUMN workspace_id text NOT NULL DEFAULT 'legacy';
    ALTER TABLE search_lease DROP CONSTRAINT IF EXISTS search_lease_pkey;
    ALTER TABLE search_lease ADD PRIMARY KEY (workspace_id,id);
  END IF;
  ALTER TABLE workspace_records ALTER COLUMN workspace_id DROP DEFAULT;
  ALTER TABLE search_lease ALTER COLUMN workspace_id DROP DEFAULT;
  CREATE TABLE IF NOT EXISTS workspace_accounts (
    id text PRIMARY KEY, google_sub text NOT NULL UNIQUE, email text NOT NULL,
    name text NOT NULL, workspace_id text NOT NULL UNIQUE, created_at timestamptz NOT NULL DEFAULT now()
  );
  CREATE TABLE IF NOT EXISTS oauth_states (id text PRIMARY KEY, data jsonb NOT NULL);
  CREATE TABLE IF NOT EXISTS app_metadata (id text PRIMARY KEY, data jsonb NOT NULL);
END $$;
