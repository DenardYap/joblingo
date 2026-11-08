import { createHash, randomUUID } from 'node:crypto';
import { database } from './store.js';
import { workspaceId } from './workspace-context.js';

const UNIT=1_000_000;
export class ExaBudgetError extends Error {
  readonly code='EXA_BUDGET_EXCEEDED';
  constructor(){super('The shared Exa daily budget is reached or reserved by work in progress. New daily funds reset at midnight Pacific; unresolved requests remain reserved. Saved results remain available.');}
}
export const budgetDay=(now=new Date())=>new Intl.DateTimeFormat('en-CA',{timeZone:'America/Los_Angeles',year:'numeric',month:'2-digit',day:'2-digit'}).format(now);
export function exaLimitUsd(){const value=Number(process.env.EXA_DAILY_BUDGET_USD ?? '2');if(!Number.isFinite(value)||value<0||value>100)throw new Error('EXA_DAILY_BUDGET_USD must be between 0 and 100.');return value;}
const scope=()=>{if(!process.env.EXA_API_KEY)throw new Error('Configure EXA_API_KEY on the server.');return createHash('sha256').update(process.env.EXA_API_KEY).digest('hex');};
const units=(dollars:number)=>{if(!Number.isFinite(dollars)||dollars<0)throw new Error('Invalid provider cost.');return Math.ceil(Number((dollars*UNIT).toFixed(6)));};

// The optional bootstrap is read-only provider history, so existing Agent spend
// is not reset to zero when this guard is deployed onto an existing account.
export async function reserveExa(maximumUsd:number, bootstrap?:()=>Promise<number>) {
  const workspace=workspaceId(), key=scope(), limit=units(exaLimitUsd()), maximum=units(maximumUsd), db=await database();
  let day=budgetDay();
  if(!maximum || maximum>limit)throw new ExaBudgetError();
  const existing=await db.query('SELECT scope FROM exa_budget_accounts WHERE scope=$1',[key]);
  if(!existing.rows.length){
    const baseline=bootstrap ? units(await bootstrap()) : 0;
    day=budgetDay();
    await db.query('INSERT INTO exa_budget_accounts(scope,day,charged,held) VALUES($1,$2,$3,0) ON CONFLICT DO NOTHING',[key,day,baseline]);
  }
  day=budgetDay();
  const id=randomUUID();
  const result=await db.query(`WITH reserved AS (
    UPDATE exa_budget_accounts SET day=$2,charged=CASE WHEN day=$2 THEN charged ELSE 0 END,held=held+$3
    WHERE scope=$1 AND (CASE WHEN day=$2 THEN charged ELSE 0 END)+held+$3<=$4 RETURNING scope
  ) INSERT INTO exa_budget_reservations(id,scope,workspace_id,day,maximum)
    SELECT $5,scope,$6,$2,$3 FROM reserved RETURNING id`,[key,day,maximum,limit,id,workspace]);
  if(!result.rows.length)throw new ExaBudgetError();
  return id;
}
export async function bindExaReservation(id:string,remoteId:string){await(await database()).query('UPDATE exa_budget_reservations SET remote_id=$3 WHERE id=$1 AND workspace_id=$2',[id,workspaceId(),remoteId]);}
export async function settleExa(id:string,actualUsd?:number){
  const actual=actualUsd===undefined?null:units(actualUsd);
  await(await database()).query(`WITH settled AS (
    UPDATE exa_budget_reservations SET state='settled',charged=COALESCE($3::bigint,maximum)
    WHERE id=$1 AND workspace_id=$2 AND state='reserved' RETURNING scope,maximum,charged
  ) UPDATE exa_budget_accounts a SET day=$4,
    charged=(CASE WHEN a.day=$4 THEN a.charged ELSE 0 END)+s.charged,held=a.held-s.maximum
    FROM settled s WHERE a.scope=s.scope`,[id,workspaceId(),actual,budgetDay()]);
}
export async function settleExaRun(remoteId:string,actualUsd?:number){
  const result=await(await database()).query("SELECT id FROM exa_budget_reservations WHERE workspace_id=$1 AND remote_id=$2 AND state='reserved'",[workspaceId(),remoteId]);
  for(const row of result.rows)await settleExa(String(row.id),actualUsd);
}
export async function exaUsage(){
  const result=await(await database()).query(`SELECT COALESCE(sum(charged) FILTER(WHERE state='settled' AND day=$2),0) AS charged,
    COALESCE(sum(maximum) FILTER(WHERE state='reserved'),0) AS held FROM exa_budget_reservations WHERE workspace_id=$1 AND scope=$3`,[workspaceId(),budgetDay(),scope()]);
  return {limitUsd:exaLimitUsd(),usedUsd:Number(result.rows[0]?.charged ?? 0)/UNIT,reservedUsd:Number(result.rows[0]?.held ?? 0)/UNIT,resetTimezone:'America/Los_Angeles'};
}
