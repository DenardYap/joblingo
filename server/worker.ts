import 'dotenv/config';
import { startRun } from './search/runner.js';
import { closeDatabase, forEachWorkspace } from './store.js';
import { processResearch } from './research.js';
if (!process.env.DATABASE_URL) throw new Error('The cron worker requires DATABASE_URL; the local app handles local scheduling.');
try { await forEachWorkspace(async()=>{const run=await startRun('Scheduled',false);if(run?.status==='Failed'){console.error(run.error);process.exitCode=1;}await processResearch();}); }
catch (error) { console.error(error instanceof Error ? error.message : 'Scheduled search failed.'); process.exitCode = 1; }
finally { await closeDatabase(); }
