import 'dotenv/config';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import pg from 'pg';

const tables = {
  workspace_accounts: ['id', 'google_sub', 'email', 'name', 'workspace_id', 'created_at'],
  workspace_records: ['workspace_id', 'kind', 'id', 'data'],
  app_metadata: ['id', 'data'],
};
const canonical = value => value instanceof Date ? value.toISOString() : Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
const ordered = rows => rows.map(canonical).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
const digest = rows => createHash('sha256').update(JSON.stringify(ordered(rows))).digest('hex');
const describe = data => Object.fromEntries(Object.entries(data).map(([table, rows]) => [table, { count: rows.length, sha256: digest(rows) }]));
const readTables = async db => {
  const data = {};
  for (const [table, columns] of Object.entries(tables)) {
    data[table] = (await db.query(`SELECT ${columns.join(',')} FROM ${table}${table === 'workspace_records' ? " WHERE kind <> 'leases'" : ''}`)).rows;
  }
  return data;
};
const [command, filename, localDirectory] = process.argv.slice(2);
if (!['export', 'import', 'verify'].includes(command) || !filename) throw new Error('Usage: node scripts/workspace-snapshot.mjs export|import|verify PRIVATE_JSON_PATH [OFFLINE_PGLITE_DIRECTORY]');
if (command === 'export') {
  if (!localDirectory) throw new Error('Export requires an offline PGlite directory. Stop the API before copying/opening it.');
  const { PGlite } = await import('@electric-sql/pglite');
  const db = new PGlite(resolve(localDirectory));
  try {
    const data = await readTables(db);
    await writeFile(filename, JSON.stringify({ version: 1, exportedAt: new Date().toISOString(), tables: data }), { mode: 0o600, flag: 'wx' });
    console.log(JSON.stringify(describe(data), null, 2));
  } finally { await db.close(); }
} else {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL must point to the target PostgreSQL database.');
  const snapshot = JSON.parse(await readFile(filename, 'utf8'));
  if (snapshot.version !== 1 || Object.keys(tables).some(table => !Array.isArray(snapshot.tables?.[table]))) throw new Error('Invalid workspace snapshot.');
  const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  try {
    if (command === 'import') {
      await db.query('BEGIN');
      await db.query('LOCK TABLE workspace_accounts,workspace_records,app_metadata IN EXCLUSIVE MODE');
      for (const table of Object.keys(tables)) {
        if (Number((await db.query(`SELECT count(*) AS n FROM ${table}`)).rows[0].n)) throw new Error(`Refusing to overwrite non-empty ${table}.`);
      }
      for (const [table, columns] of Object.entries(tables)) {
        for (const row of snapshot.tables[table]) {
          if (table === 'workspace_records' && row.kind === 'leases') continue;
          await db.query(`INSERT INTO ${table} (${columns.join(',')}) VALUES (${columns.map((_, index) => `$${index + 1}`).join(',')})`, columns.map(column => column === 'data' ? JSON.stringify(row[column]) : row[column]));
        }
      }
    }
    const actual = await readTables(db);
    for (const table of Object.keys(tables)) {
      if (digest(actual[table]) !== digest(snapshot.tables[table].filter(row => row.kind !== 'leases'))) throw new Error(`Verification failed for ${table}.`);
    }
    if (command === 'import') await db.query('COMMIT');
    console.log(JSON.stringify({ verified: true, tables: describe(actual) }, null, 2));
  } catch (error) {
    if (command === 'import') await db.query('ROLLBACK');
    throw error;
  } finally { await db.end(); }
}
