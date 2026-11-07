import 'dotenv/config';
import { resolve } from 'node:path';
import pg from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required for migrations.');
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1, connectionTimeoutMillis: 10000 });
try {
  await migrate(drizzle(pool), { migrationsFolder: resolve('server/db/migrations') });
  console.log('Database migrations completed.');
} catch (error) {
  const detail = error instanceof Error ? error : new Error('Unknown database migration error.');
  // Connection strings contain credentials; report the cause without dumping config.
  const cause = detail.cause instanceof Error ? detail.cause.message : detail.message;
  console.error('Database migration failed:', cause.replaceAll(process.env.DATABASE_URL, '[database URL]'));
  process.exitCode = 1;
} finally {
  await pool.end();
}
