import 'dotenv/config';
import { mkdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import pg from 'pg';
import { PGlite } from '@electric-sql/pglite';
import { defaultPreferences, preferencesSchema, type Job, type Run } from '../shared/workspace.js';
import { inWorkspace, workspaceId } from './workspace-context.js';

type Result = { rows: Record<string, unknown>[] };
export type Database = { query: (sql: string, params?: unknown[]) => Promise<Result>; close: () => Promise<void> };
let connection: Promise<Database> | undefined;
async function connect(): Promise<Database> {
  let db: Database;
  if (process.env.DATABASE_URL) {
    const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 5 });
    db = { query: (sql, params) => pool.query(sql, params), close: () => pool.end() };
  } else {
    if (process.env.NODE_ENV === 'production') throw new Error('DATABASE_URL is required in production.');
    const path=resolve(process.env.LOCAL_DATABASE_DIR || '.local/postgres');await mkdir(path,{recursive:true});
    const local = new PGlite(path);
    db = { query: (sql, params) => local.query(sql, params), close: () => local.close() };
  }
  await db.query('CREATE TABLE IF NOT EXISTS workspace_records (kind text NOT NULL, id text NOT NULL, data jsonb NOT NULL, PRIMARY KEY(kind,id))');
  await db.query('CREATE TABLE IF NOT EXISTS search_lease (id integer PRIMARY KEY, owner text, expires_at timestamptz NOT NULL)');
  const migration=await readFile(resolve('server/db/migrations/0001_private_workspaces.sql'),'utf8');
  // PGlite and pg both execute the idempotent migration as one atomic DO block.
  await db.query(migration);
  await db.query(await readFile(resolve('server/db/migrations/0002_exa_budget.sql'),'utf8'));
  return db;
}
// Root access is restricted to account/session bootstrap and worker enumeration.
export const rootDatabase = () => connection ??= connect();
export const database = () => { workspaceId();return rootDatabase(); };
export async function allWorkspaces() {
  const result=await(await rootDatabase()).query('SELECT workspace_id FROM workspace_accounts UNION SELECT DISTINCT workspace_id FROM workspace_records');
  return result.rows.map(row=>String(row.workspace_id));
}
export async function forEachWorkspace(action:()=>Promise<unknown>){
  const errors:unknown[]=[];for(const id of await allWorkspaces()){try{await inWorkspace(id,action);}catch(error){errors.push(error);}}if(errors.length)throw new AggregateError(errors,'One or more workspace background tasks could not finish.');
}
export async function list<T>(kind: string): Promise<T[]> { const r = await(await database()).query('SELECT data FROM workspace_records WHERE kind=$1 AND workspace_id=$2', [kind,workspaceId()]); return r.rows.map(row=>row.data as T); }
export async function get<T>(kind: string, id: string): Promise<T | null> { const r = await(await database()).query('SELECT data FROM workspace_records WHERE kind=$1 AND id=$2 AND workspace_id=$3', [kind,id,workspaceId()]); return r.rows[0]?.data as T ?? null; }
export async function put(kind: string, id: string, data: unknown) { await(await database()).query('INSERT INTO workspace_records(kind,id,data,workspace_id) VALUES ($1,$2,$3,$4) ON CONFLICT(workspace_id,kind,id) DO UPDATE SET data=excluded.data', [kind,id,JSON.stringify(data),workspaceId()]); }
export async function putIfMissing(kind: string, id: string, data: unknown) { await(await database()).query('INSERT INTO workspace_records(kind,id,data,workspace_id) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING', [kind,id,JSON.stringify(data),workspaceId()]); }
export async function patch<T>(kind: string, id: string, data: unknown): Promise<T | null> { const r = await(await database()).query('UPDATE workspace_records SET data=data || $3::jsonb WHERE kind=$1 AND id=$2 AND workspace_id=$4 RETURNING data', [kind,id,JSON.stringify(data),workspaceId()]); return r.rows[0]?.data as T ?? null; }
export async function discoveredJob(id: string, data: unknown) { await(await database()).query("INSERT INTO workspace_records(kind,id,data,workspace_id) VALUES ('jobs',$1,$2,$3) ON CONFLICT(workspace_id,kind,id) DO UPDATE SET data=workspace_records.data || (excluded.data - 'saved' - 'status' - 'notes' - 'appliedAt' - 'trackingUpdatedAt' - 'foundAt')", [id,JSON.stringify(data),workspaceId()]); }
export async function preferences(){await putIfMissing('settings','main',defaultPreferences);return preferencesSchema.parse(await get('settings','main'));}
export async function claim(owner: string): Promise<boolean> {
  const r=await(await database()).query("INSERT INTO search_lease(id,owner,expires_at,workspace_id) VALUES (1,$1,now()+interval '5 minutes',$2) ON CONFLICT(workspace_id,id) DO UPDATE SET owner=excluded.owner,expires_at=excluded.expires_at WHERE search_lease.expires_at<now() RETURNING id",[owner,workspaceId()]);return r.rows.length===1;
}
export async function renew(owner: string): Promise<boolean> { const r = await(await database()).query("UPDATE search_lease SET expires_at=now()+interval '5 minutes' WHERE id=1 AND owner=$1 AND workspace_id=$2 AND expires_at>now() RETURNING id", [owner,workspaceId()]); return r.rows.length === 1; }
export async function reconcileRuns() {
  await(await database()).query(`UPDATE workspace_records r SET data=r.data || jsonb_build_object('status','Failed','completedAt',now(),'error','Search was interrupted. Run again to retry.')
    WHERE r.kind='runs' AND r.workspace_id=$1 AND r.data->>'status'='Running'
    AND NOT EXISTS(SELECT 1 FROM search_lease l WHERE l.workspace_id=r.workspace_id AND l.owner=r.id AND l.expires_at>now())`,[workspaceId()]);
}
export async function finishRun(owner: string, jobs: Job[], result: Partial<Run>, refreshedJobs: Job[] = []) {
  result={...result,matchedJobIds:jobs.map(job=>job.id)};
  const saved = await(await database()).query(`WITH owned AS (
      SELECT id FROM search_lease WHERE workspace_id=$5 AND id=1 AND owner=$1 AND expires_at>now() FOR UPDATE
    ), saved_jobs AS (
      INSERT INTO workspace_records(kind,id,data,workspace_id)
      SELECT 'jobs',job->>'id',job,$5 FROM jsonb_array_elements($2::jsonb) job WHERE EXISTS(SELECT 1 FROM owned)
      ON CONFLICT(workspace_id,kind,id) DO UPDATE SET data=workspace_records.data || (excluded.data - 'saved' - 'status' - 'notes' - 'appliedAt' - 'trackingUpdatedAt' - 'foundAt') RETURNING id
    ), refreshed_jobs AS (
      UPDATE workspace_records AS existing SET data=existing.data ||
        (assessed - 'saved' - 'status' - 'notes' - 'appliedAt' - 'trackingUpdatedAt' - 'foundAt' - 'lastFoundAt' - 'foundOn')
      FROM jsonb_array_elements($4::jsonb) assessed
      WHERE existing.workspace_id=$5 AND existing.kind='jobs' AND existing.id=assessed->>'id' AND EXISTS(SELECT 1 FROM owned)
        AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements($2::jsonb) chosen WHERE chosen->>'id'=existing.id)
    ) UPDATE workspace_records SET data=data || $3::jsonb
      WHERE workspace_id=$5 AND kind='runs' AND id=$1 AND EXISTS(SELECT 1 FROM owned) RETURNING id`, [owner,JSON.stringify(jobs),JSON.stringify(result),JSON.stringify(refreshedJobs),workspaceId()]);
  if (!saved.rows.length) throw new Error('Search was interrupted. Run again to retry.');
}
export async function release(owner: string) { await(await database()).query("UPDATE search_lease SET expires_at=now(),owner=NULL WHERE id=1 AND owner=$1 AND workspace_id=$2", [owner,workspaceId()]); }
export async function closeDatabase() { if(connection){await(await connection).close();connection=undefined;} }
export async function claimResearch(owner: string): Promise<boolean> {
  const result=await(await database()).query(`INSERT INTO workspace_records(kind,id,data,workspace_id)
    VALUES ('leases','research',jsonb_build_object('owner',$1::text,'expiresAt',now()+interval '5 minutes'),$2)
    ON CONFLICT(workspace_id,kind,id) DO UPDATE SET data=excluded.data
    WHERE (workspace_records.data->>'expiresAt')::timestamptz<now() RETURNING id`,[owner,workspaceId()]);return result.rows.length===1;
}
export async function renewResearch(owner: string): Promise<boolean> {
  const result=await(await database()).query(`UPDATE workspace_records SET data=data || jsonb_build_object('expiresAt',now()+interval '5 minutes')
    WHERE workspace_id=$2 AND kind='leases' AND id='research' AND data->>'owner'=$1
    AND (data->>'expiresAt')::timestamptz>now() RETURNING id`,[owner,workspaceId()]);return result.rows.length===1;
}
export async function releaseResearch(owner: string) {await(await database()).query("DELETE FROM workspace_records WHERE workspace_id=$2 AND kind='leases' AND id='research' AND data->>'owner'=$1",[owner,workspaceId()]);}
