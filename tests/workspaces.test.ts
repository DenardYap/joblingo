import {after,before,test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {archiveResume} from '../server/resumes.js';
import {inWorkspace,workspaceId} from '../server/workspace-context.js';
import {accountForGoogle,establishSession,sessionAccount,type Account} from '../server/auth.js';
import {rootDatabase,get,list,put,patch,claim,renew,release,finishRun,closeDatabase,preferences} from '../server/store.js';
import type {Request,Response} from 'express';
let directory:string,alice:Account,bob:Account;
before(async()=>{
 directory=await mkdtemp(join(tmpdir(),'private-workspaces-'));process.env.LOCAL_DATABASE_DIR=directory;delete process.env.DATABASE_URL;
 process.env.SESSION_SECRET='private-workspace-test-secret-at-least-32-characters';process.env.APP_PASSWORD='test-only-password';
 await(await rootDatabase()).query("INSERT INTO app_metadata(id,data) VALUES('legacy-owner',$1)",[JSON.stringify({email:'alice@example.test'})]);
 alice=await accountForGoogle({sub:'google-alice',email:'alice@example.test',name:'Alice',authoritativeEmail:true});
 bob=await accountForGoogle({sub:'google-bob',email:'bob@example.test',name:'Bob',authoritativeEmail:true});
});
after(async()=>{await closeDatabase();await rm(directory,{recursive:true,force:true});});
test('requires a workspace and claims legacy records only for the verified prior owner',async()=>{
 await assert.rejects(get('resumes','known-id'),/signed-in workspace/);assert.equal(alice.workspace_id,'legacy');assert.notEqual(bob.workspace_id,'legacy');
});
test('same record IDs, secrets, resume files and settings remain private across simultaneous users',async()=>{
 await Promise.all([alice,bob].map(account=>inWorkspace(account.workspace_id,async()=>{
  await put('jobs','same-job',{notes:account.name});await put('resume-files','same-resume',{pdf:account.name});await put('private','google-token',{encrypted:account.name});
  const config=await preferences();assert.equal(config.candidateBackground,'');await put('settings','main',{...config,candidateBackground:account.name});
 })));
 await inWorkspace(alice.workspace_id,async()=>{await patch('jobs','same-job',{notes:'Alice edited'});assert.deepEqual(await get('resume-files','same-resume'),{pdf:'Alice'});});
 await inWorkspace(bob.workspace_id,async()=>{assert.deepEqual(await get('jobs','same-job'),{notes:'Bob'});assert.deepEqual(await get('private','google-token'),{encrypted:'Bob'});assert.equal((await preferences()).candidateBackground,'Bob');assert.equal((await list('jobs')).length,1);});
});
test('search leases and completion cannot affect another user with identical job and run IDs',async()=>{
 await inWorkspace(alice.workspace_id,async()=>{await put('runs','run',{status:'Running'});assert.equal(await claim('run'),true);});
 await inWorkspace(bob.workspace_id,async()=>{await put('runs','run',{status:'Running'});assert.equal(await claim('run'),true);await release('run');assert.equal(await renew('run'),false);});
 await inWorkspace(alice.workspace_id,async()=>{assert.equal(await renew('run'),true);await finishRun('run',[],{status:'Completed'});assert.equal((await get<{status:string}>('runs','run'))?.status,'Completed');await release('run');});
 await inWorkspace(bob.workspace_id,async()=>{assert.equal((await get<{status:string}>('runs','run'))?.status,'Running');});
});
test('site password cookies cannot authenticate a user and tampered account sessions fail',async()=>{
 const cookies:Record<string,string>={};establishSession({cookie:(name:string,value:string)=>{cookies[name]=value;return{};}}as Response,alice);
 const header=()=>Object.entries(cookies).map(([name,value])=>`${name}=${value}`).join('; ');
 assert.equal((await sessionAccount({headers:{cookie:header()}}as Request))?.id,alice.id);
 const session=cookies.workspace_session!;delete cookies.workspace_session;assert.equal(await sessionAccount({headers:{cookie:header()}}as Request),null);
 cookies.workspace_session=session.replace(alice.id,bob.id);assert.equal(await sessionAccount({headers:{cookie:header()}}as Request),null);
 assert.throws(()=>workspaceId(),/signed-in workspace/);
});

test('resume removal is repeatable, preserves source files, and clears only its own matching selection',async()=>{
 for(const account of [alice,bob])await inWorkspace(account.workspace_id,async()=>{
  await put('resumes','remove-me',{id:'remove-me',name:account.name,text:'Source resume'});
  await put('resume-files','remove-me',{pdf:account.name});
  await put('settings','main',{...(await preferences()),matchingResumeId:'remove-me'});
 });
 await inWorkspace(alice.workspace_id,async()=>{
  await archiveResume('remove-me');await archiveResume('remove-me');
  assert.equal(await get('resumes','remove-me'),null);
  assert.deepEqual(await get('archived-resume-files','remove-me'),{pdf:'Alice'});
  assert.equal((await preferences()).matchingResumeId,null);
 });
 await inWorkspace(bob.workspace_id,async()=>{
  assert.ok(await get('resumes','remove-me'));assert.equal(await get('archived-resumes','remove-me'),null);
  assert.equal((await preferences()).matchingResumeId,'remove-me');
 });
});

test('consolidated tracking synchronizes copies without crossing workspaces or deleting draft references',async()=>{
 const {examples}=await import('../server/fixtures.js');
 const {groupedJob,updateJobTracking}=await import('../server/job-groups.js');
 const a={...examples()[0]!,id:'copy-a',example:false,company:'Example Employer',url:'https://example.test/a',saved:true,status:'Applied' as const};
 const b={...a,id:'copy-b',url:'https://example.test/b',saved:false,status:'Not started' as const};
 for(const space of ['dedup-alice','dedup-bob'])await inWorkspace(space,async()=>{
  await put('jobs',a.id,a);await put('jobs',b.id,b);await put('drafts','draft',{id:'draft',jobId:b.id,text:'Preserved'});
 });
 await inWorkspace('dedup-alice',async()=>{
  assert.equal((await groupedJob(a.id))?.relatedJobIds?.length,2);
  await updateJobTracking(a.id,{saved:false,status:'Interviewing',notes:'Follow up Friday'});
  for(const id of [a.id,b.id]){const stored=await get<typeof a>('jobs',id);assert.equal(stored?.saved,false);assert.equal(stored?.status,'Interviewing');}
  assert.deepEqual(await get('drafts','draft'),{id:'draft',jobId:b.id,text:'Preserved'});
  assert.equal((await list('jobs')).length,2);
 });
 await inWorkspace('dedup-bob',async()=>{assert.equal((await get<typeof a>('jobs',a.id))?.saved,true);assert.equal((await get<typeof b>('jobs',b.id))?.status,'Not started');});
});
