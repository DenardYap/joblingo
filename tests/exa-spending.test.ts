import assert from 'node:assert/strict';
import {after,before,test} from 'node:test';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import type Exa from 'exa-js';
import {inWorkspace} from '../server/workspace-context.js';
import {database,closeDatabase,get,list,put,claim,finishRun,release} from '../server/store.js';
import {budgetDay,bindExaReservation,ExaBudgetError,exaUsage,reserveExa,settleExa,settleExaRun} from '../server/exa-budget.js';
import {meteredExa} from '../server/exa.js';
import {examples} from '../server/fixtures.js';
import {companyResearchKey,processResearch,readResearch,startResearch,type Research} from '../server/research.js';
import {companyListing} from '../server/company-listing.js';
import {findCompanyLogo} from '../server/company-logo.js';
import {createHash} from 'node:crypto';
let directory:string;let sequence=0;
before(async()=>{directory=await mkdtemp(join(tmpdir(),'exa-budget-'));process.env.LOCAL_DATABASE_DIR=directory;delete process.env.DATABASE_URL;});
after(async()=>{await closeDatabase();await rm(directory,{recursive:true,force:true});});
const reset=()=>{process.env.EXA_API_KEY=`test-only-budget-${++sequence}`;process.env.EXA_DAILY_BUDGET_USD='2';};
const workspace=<T>(fn:()=>Promise<T>)=>inWorkspace('owner',fn);
function fakeClient(options:{fail?:boolean;baseline?:number}={}){
 let paidCalls=0;const createdAt=new Date().toISOString();
 const completed={id:'agent-run',status:'completed',createdAt,costDollars:{total:0.025}};
 const raw={search:async()=>{paidCalls++;if(options.fail)throw new Error('Response lost');return {costDollars:{total:0.01},results:[]};},getContents:async()=>{paidCalls++;return {costDollars:{total:0.001},results:[]};},agent:{runs:{
  list:async()=>({data:options.baseline?[{...completed,costDollars:{total:options.baseline}}]:[],hasMore:false,nextCursor:null}),
  create:async()=>{paidCalls++;return {...completed,status:'running',costDollars:undefined};},get:async()=>completed,pollUntilFinished:async()=>completed,cancel:async()=>({...completed,status:'cancelled'}),
 }}};
 return {client:meteredExa(raw as unknown as Exa),calls:()=>paidCalls};
}
test('concurrent workspaces share one durable ceiling; settling twice cannot refund twice',async()=>{
 reset();const attempts=await Promise.allSettled(Array.from({length:20},(_,i)=>inWorkspace(i%2?'alice':'bob',()=>reserveExa(0.25))));
 const accepted=attempts.flatMap((r,i)=>r.status==='fulfilled'?[{id:r.value,workspace:i%2?'alice':'bob'}]:[]);
 assert.equal(accepted.length,8);assert.ok(attempts.filter(r=>r.status==='rejected').every(r=>r.reason instanceof ExaBudgetError));
 for(const item of accepted)await inWorkspace(item.workspace,async()=>{await settleExa(item.id,0.05);await settleExa(item.id,0);});
 await workspace(async()=>{await reserveExa(1.5);await assert.rejects(reserveExa(0.11),ExaBudgetError);});
});
test('reservation and remote settlement are private to their owning workspace',async()=>{
 reset();const id=await workspace(()=>reserveExa(1));await workspace(()=>bindExaReservation(id,'private-run'));
 await inWorkspace('other',async()=>{await settleExa(id,0);await settleExaRun('private-run',0);assert.equal((await exaUsage()).reservedUsd,0);});
 await workspace(async()=>{assert.equal((await exaUsage()).reservedUsd,1);await settleExaRun('private-run',0.2);assert.equal((await exaUsage()).usedUsd,0.2);});
});
test('in-flight work still reserves funds across midnight',async()=>{
 reset();await workspace(async()=>{
  const id=await reserveExa(1.5);
  await(await database()).query("UPDATE exa_budget_accounts SET day='2026-01-01',charged=1500000 WHERE scope=(SELECT scope FROM exa_budget_reservations WHERE id=$1 AND workspace_id='owner')",[id]);
  await assert.rejects(reserveExa(0.6),ExaBudgetError);
  await settleExa(id,0.4);await reserveExa(1.5);await assert.rejects(reserveExa(0.11),ExaBudgetError);
 });
 assert.equal(budgetDay(new Date('2026-11-07T07:59:59Z')),'2026-11-06');assert.equal(budgetDay(new Date('2026-11-07T08:00:00Z')),'2026-11-07');
});
test('searches, contents and terminal Agent costs all settle through the same ledger',async()=>{
 reset();const {client,calls}=fakeClient();await workspace(async()=>{
  await client.search('roles',{type:'auto',contents:{highlights:true}});await client.getContents(['https://example.test/job'],{text:true});
  await client.agent.runs.create({query:'Company facts',effort:'low'});assert.equal((await exaUsage()).reservedUsd,0.035);
  await client.agent.runs.get('agent-run');await client.agent.runs.get('agent-run');
  assert.equal((await exaUsage()).usedUsd,0.036);assert.equal((await exaUsage()).reservedUsd,0);
 });assert.equal(calls(),3);
});
test('unknown failures retain the upper bound and cannot retry past the ceiling',async()=>{
 reset();process.env.EXA_DAILY_BUDGET_USD='0.3';const {client,calls}=fakeClient({fail:true});await workspace(async()=>{
  await assert.rejects(client.search('one'),/Response lost/);await assert.rejects(client.search('two'),/Response lost/);
  await assert.rejects(client.search('three'),ExaBudgetError);assert.equal((await exaUsage()).reservedUsd,0.3);
 });assert.equal(calls(),2);
});
test('pre-existing provider spend and a zero-dollar kill switch stop requests before purchase',async()=>{
 reset();const existing=fakeClient({baseline:3});await workspace(()=>assert.rejects(existing.client.search('roles'),ExaBudgetError));assert.equal(existing.calls(),0);
 reset();process.env.EXA_DAILY_BUDGET_USD='0';const disabled=fakeClient();await workspace(()=>assert.rejects(disabled.client.agent.runs.create({query:'facts',effort:'low'}),ExaBudgetError));assert.equal(disabled.calls(),0);
 await assert.rejects(reserveExa(0.1),/signed-in workspace/);
});
const realJob=(id:string)=>({...examples()[0]!,id,example:false,company:'Test Employer',url:`https://careers.example.test/${id}`});
test('discovery and legacy queues never opt into research; explicit requests deduplicate by employer',async()=>{
 reset();process.env.EXA_DAILY_BUDGET_USD='0';await inWorkspace('research',async()=>{
  const a=realJob('a'),b=realJob('b');await put('jobs',a.id,a);await put('jobs',b.id,b);
  await put('research',a.id,{id:'',jobId:a.id,status:'queued',createdAt:new Date().toISOString()});
  await processResearch();assert.equal((await get<Research>('research',a.id))?.status,'queued');assert.equal((await list('company-research')).length,0);
  await put('runs','run',{id:'run'});await claim('run');await finishRun('run',[realJob('c')],{status:'Completed'});await release('run');assert.equal(await get('research','c'),null);
  const [first,second]=await Promise.all([startResearch(a),startResearch(b)]);assert.equal(first.companyKey,second.companyKey);assert.equal((await list('company-research')).length,1);
  await processResearch();assert.match((await readResearch(a.id))?.error ?? '',/daily budget/);
 });
});
test('already-paid company facts are reused across roles and remain private',async()=>{
 reset();await inWorkspace('cached',async()=>{
  const a=realJob('a'),b=realJob('b');await put('jobs',a.id,a);await put('jobs',b.id,b);
  const record={id:'existing',jobId:a.id,status:'completed',createdAt:new Date().toISOString(),data:{employerName:a.company,company:{headcount:'200 employees'},people:[],sources:[]}};
  await put('research',a.id,record);assert.equal((await startResearch(b)).id,'existing');assert.equal((await readResearch(b.id))?.data?.company.headcount,'200 employees');assert.equal((await list('company-research')).length,0);
  assert.equal(companyResearchKey(a),companyResearchKey(b));
 });
 await inWorkspace('no-cache',async()=>{await put('jobs','b',realJob('b'));assert.equal(await readResearch('b'),null);});
});
test('company ownership is cached by employer and browsing missing logos never starts a search',async()=>{
 reset();process.env.EXA_DAILY_BUDGET_USD='0';await inWorkspace('ownership',async()=>{
  const key=createHash('sha256').update('identity-v3|testemployer').digest('hex');
  const listing={status:'Private',checkedAt:new Date().toISOString(),sourceUrl:'https://example.test/about',exchange:null,ticker:null,evidence:'Test Employer is private'};
  await put('company-listings',key,listing);assert.deepEqual(await companyListing('Test Employer','https://example.test/job1'),listing);assert.deepEqual(await companyListing('Test Employer','https://example.test/job2'),listing);
  assert.equal(await findCompanyLogo('Test Employer',{url:'https://example.test/job3',description:'A role'}),null);
  assert.equal((await exaUsage()).usedUsd,0);assert.equal((await exaUsage()).reservedUsd,0);
 });
});


test('the public client cannot bypass metering through another SDK surface',()=>{
 const {client}=fakeClient();assert.equal((client as unknown as Record<string,unknown>).findSimilar,undefined);
 assert.equal((client.agent.runs as unknown as Record<string,unknown>).createAndWait,undefined);
});
