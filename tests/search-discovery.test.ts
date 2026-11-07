import assert from 'node:assert/strict';
import test from 'node:test';
import { canonicalJobUrl, discoverUntilTarget, type Candidate } from '../server/search/discovery.js';

const candidate = (id: number): Candidate => ({ title:`Job ${id}`,url:`https://careers.example.com/jobs/${id}` });
const plan = [{query:'recent roles',days:1},{query:'more matching roles',days:7}];
const progress = async () => {};
const key = (item: Candidate) => canonicalJobUrl(item.url);

test('a sparse first search continues until 30 qualifying jobs, rather than stopping at 24 reviewed', async () => {
  let searches=0;
  const result=await discoverUntilTarget({target:30,maxReviewed:360,plan,key,progress,
    search:async()=>++searches===1 ? Array.from({length:24},(_,i)=>candidate(i)) : Array.from({length:20},(_,i)=>candidate(i+24)),
    review:async item=>Number(item.title.slice(4))<14 ? null : item,
  });
  assert.equal(searches,2); assert.equal(result.matches.length,30);
  assert.equal(result.stats.reviewed,44); assert.equal(result.stopReason,'target_reached');
});

test('duplicate URLs across searches are reviewed only once, and exhaustion remains explicit', async()=>{
  let searches=0; const reviewed:string[]=[];
  const result=await discoverUntilTarget({target:30,maxReviewed:360,plan,key,progress,
    search:async()=>++searches===1 ? [candidate(1)] : [{...candidate(1),url:`${candidate(1).url}?utm_source=other#apply`},candidate(2)],
    review:async item=>{reviewed.push(item.url);return item;},
  });
  assert.equal(reviewed.length,2); assert.equal(result.stats.duplicates,1);
  assert.equal(result.stats.discovered,2); assert.equal(result.matches.length,2);
  assert.equal(result.stopReason,'searches_exhausted');
});

test('a bounded review budget does not overrun in concurrent batches or imply the target was met',async()=>{
  const result=await discoverUntilTarget({target:30,maxReviewed:5,plan,key,progress,
    search:async()=>Array.from({length:30},(_,i)=>candidate(i)),review:async()=>null,
  });
  assert.equal(result.stats.reviewed,5); assert.equal(result.matches.length,0);
  assert.equal(result.stopReason,'review_limit');
});

test('provider errors retain already qualified results without claiming a complete search',async()=>{
  let searches=0;
  const result=await discoverUntilTarget({target:30,maxReviewed:360,plan,key,progress,
    search:async()=>{if(++searches>1)throw new Error('provider unavailable');return [candidate(1)];},
    review:async item=>item,
  });
  assert.equal(result.matches.length,1); assert.equal(result.stopReason,'provider_error');
  assert.ok(result.error instanceof Error);
});

test('new search results are considered before refreshing older saved matches',async()=>{
  let searches=0;
  const result=await discoverUntilTarget({target:1,maxReviewed:10,plan,key,progress,initial:[candidate(1)],
    search:async()=>{searches++;return [candidate(2)];},review:async item=>item,
  });
  assert.equal(searches,1); assert.equal(result.matches[0]?.url,candidate(2).url);
});

test('each completed review batch exposes verified matches for durable checkpoints',async()=>{
 const checkpoints:number[]=[];
 await discoverUntilTarget({target:30,maxReviewed:10,plan,key,
  progress:async(stats,matches)=>{assert.equal(stats.matched,Math.min(30,matches.length));checkpoints.push(matches.length);},
  search:async query=>{if(query===plan[1])throw new Error('temporary failure');return [candidate(1),candidate(2),candidate(3)];},
  review:async item=>item,
 });
 assert.ok(checkpoints.includes(3));assert.equal(checkpoints.at(-1),3);
});
