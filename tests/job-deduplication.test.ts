import assert from 'node:assert/strict';
import test from 'node:test';
import { examples } from '../server/fixtures.js';
import { applicationIdentity, deduplicateJobs, mergeJobCopies, sameJob } from '../shared/job-deduplication.js';
import type { Job } from '../shared/workspace.js';
const job=(id:string,overrides:Partial<Job>={}):Job=>({...examples()[0]!,id,example:false,company:'Scale AI',title:'Technical Revenue Accounting Manager',location:'San Francisco, CA',workplace:'On-site',url:`https://example.com/${id}`,postedAt:'2026-11-06T12:00:00Z',...overrides});

test('cross-site role copies normalize company, title and location without losing tracking',()=>{
 const a=job('a',{saved:true,notes:'Ask recruiter',status:'Applied',appliedAt:'2026-11-06T15:00:00Z'});
 const b=job('b',{company:'Scale AI, Inc.',location:'San Francisco, California, United States',notes:'Confirm office days'});
 const grouped=deduplicateJobs([a,b]);assert.equal(grouped.length,1);
 assert.equal(grouped[0]!.saved,true);assert.equal(grouped[0]!.status,'Applied');
 assert.match(grouped[0]!.notes,/Ask recruiter/);assert.match(grouped[0]!.notes,/Confirm office days/);
 assert.deepEqual(grouped[0]!.relatedJobIds,['a','b']);assert.equal(grouped[0]!.listings!.length,2);
});
test('remote suffixes do not create a second Gurobi role',()=>{
 const a=job('a',{company:'Gurobi Optimization',title:'Revenue Accounting Manager (USA - Remote)',location:'United States',workplace:'Remote'});
 const b=job('b',{company:'Gurobi Optimization',title:'Revenue Accounting Manager',location:'USA',workplace:'Remote'});
 assert.ok(sameJob(a,b));
});
test('separate employers, specialties, cities, requisitions and hiring cycles stay separate',()=>{
 const base=job('a');
 for(const change of [{company:'Other Co'},{title:'Senior Technical Revenue Accounting Manager'},{location:'San Jose, CA'},{company:'Undisclosed company'},{postedAt:'2026-08-01T00:00:00Z'}])assert.equal(sameJob(base,job('b',change)),false);
 assert.equal(sameJob(job('a',{url:'https://job-boards.greenhouse.io/scale/jobs/123'}),job('b',{url:'https://job-boards.greenhouse.io/scale/jobs/456'})),false);
 assert.equal(sameJob(job('a',{company:'Undisclosed company'}),job('b',{company:'Undisclosed company'})),false);
});
test('new tracking edits override inherited status and bookmark, and reposts keep original age',()=>{
 const a=job('a',{saved:true,status:'Applied',postedAt:'2026-11-05T00:00:00Z'});
 const b=job('b',{saved:false,status:'Not started',trackingUpdatedAt:'2026-11-07T00:00:00Z'});
 const merged=mergeJobCopies([a,b]);assert.equal(merged.saved,false);assert.equal(merged.status,'Not started');assert.equal(merged.postedAt,a.postedAt);
});

test('a meaningful specialty is not removed just because its qualifier also mentions remote',()=>{
 assert.equal(sameJob(job('a',{title:'Senior Accountant (Revenue, Remote)'}),job('b',{title:'Senior Accountant'})),false);
 assert.equal(sameJob(job('a',{url:'https://visa.wd5.myworkdayjobs.com/Jobs/job/City/Accountant_R100'}),job('b',{url:'https://visa.wd5.myworkdayjobs.com/Jobs/job/City/Accountant_R200'})),false);
});

test('remote San Francisco and Bay Area variants consolidate without merging on-site cities',()=>{
 const a=job('a',{company:'Udemy',title:'Senior Revenue Accountant',location:'San Francisco, CA, United States',workplace:'Remote'});
 const b=job('b',{...a,id:'b',url:'https://example.com/b',location:'San Francisco Bay Area, CA, United States'});
 assert.ok(sameJob(a,b));
 assert.equal(sameJob({...a,workplace:'On-site'},{...b,workplace:'On-site'}),false);
});


test('the original application ID merges title variants but keeps distinct requisitions apart',()=>{
 const original='https://job-boards.greenhouse.io/ethernovia/jobs/5271789007';
 const a=job('a',{company:'Ethernovia',title:'Senior Accountant',applicationIdentity:applicationIdentity(original)!});
 const b=job('b',{company:'Ethernovia, Inc.',title:'Senior Accountant (Semiconductor Industry)',url:original});
 assert.ok(sameJob(a,b));
 const redirect='https://example.com/apply?to='+encodeURIComponent('https://nvidia.wd5.myworkdayjobs.com/Jobs/job/City/Accountant_JR2023968');
 assert.equal(applicationIdentity(redirect)?.id,'jr2023968');
 assert.equal(sameJob(job('a',{applicationIdentity:applicationIdentity(redirect)!}),job('b',{applicationIdentity:applicationIdentity('https://nvidia.wd5.myworkdayjobs.com/Jobs/job/City/Accountant_JR2026447')!})),false);
 assert.equal(applicationIdentity('https://notgreenhouse.io/ethernovia/jobs/5271789007'),null);
});

test('saved run counts follow consolidated IDs instead of preserving a duplicate-inflated target',async()=>{
 const {distinctRun}=await import('../shared/search-runs.js');
 const a=job('a'),b=job('b');
 const run={id:'run',startedAt:'2026-11-07T00:00:00Z',completedAt:'2026-11-07T00:01:00Z',status:'Completed' as const,trigger:'Manual' as const,found:2,reviewed:2,excluded:0,error:null,scheduledKey:null,attempt:1,target:2,matchedJobIds:['a','b']};
 const updated=distinctRun(run,deduplicateJobs([a,b]));assert.equal(updated.found,1);assert.equal(updated.stopReason,'deduplicated');
 assert.equal(run.found,2);
});
