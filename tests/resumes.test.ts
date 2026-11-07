import { test } from 'node:test';
import assert from 'node:assert/strict';
import { candidateSources, reviseResume, verifiedEvidence, verifiedSearchTerms } from '../shared/resumes.js';
import { readResume, resumePdf } from '../server/resumes.js';
import { PDFParse } from 'pdf-parse';
import type { Resume } from '../shared/workspace.js';

const original: Resume = {id:'resume',name:'Revenue.docx',text:'Reviewed revenue controls and ASC 606 contract accounting. Led a team of eight auditors.',createdAt:'2026-01-01T00:00:00Z'};
test('editing preserves the original across subsequent changes and rejects a stale editor', () => {
  const first=reviseResume(original,{name:'Revenue',text:original.text+' Tested SOX 404 controls.',revision:1});
  const second=reviseResume(first,{name:'Revenue accounting',text:first.text+' Reviewed deferred revenue.',revision:2});
  assert.equal(second.originalText,original.text);
  assert.equal(second.originalName,original.name);
  assert.equal(second.createdAt,original.createdAt);
  assert.equal(second.revision,3);
  assert.throws(()=>reviseResume(second,{name:'stale',text:original.text,revision:1}),/another window/);
});
test('editing rejects empty or oversized resumes without modifying the supplied record', () => {
  for(const text of ['', 'too short', 'a'.repeat(50001)]) assert.throws(()=>reviseResume(original,{name:'Revenue',text,revision:1}));
  assert.equal(original.originalText,undefined);
});
test('matching accepts exact evidence from either selected resume or additional background', () => {
  const sources=candidateSources(original,'Tested a $90M business combination under ASC 805.');
  assert.deepEqual(verifiedEvidence(['reviewed revenue controls','Tested a $90M business combination','Owned the month-end close','SQL'],sources),['reviewed revenue controls','Tested a $90M business combination']);
  assert.deepEqual(candidateSources(null,'  '),[]);
  assert.deepEqual(candidateSources(null,'  Audited controls. '),['Audited controls.']);
});
test('discovery strips ungrounded terms, contacts, URLs and phone-like values', () => {
  const sources=[original.text, 'ASC 805. Reach accountant@example.test, https://example.test, 555-123-4567'];
  assert.deepEqual(verifiedSearchTerms(['ASC 606','ASC 805','NetSuite','accountant@example.test','https://example.test','555-123-4567','ASC 606'],sources),['ASC 606','ASC 805']);
});
test('upload parsing retains original text and rejects unsupported or empty content',async()=>{
  const file=(originalname:string,text:string)=>({originalname,buffer:Buffer.from(text)} as Express.Multer.File);
  const parsed=await readResume(file('Revenue.TXT',original.text));
  assert.equal(parsed.originalText,original.text);
  assert.equal(parsed.text,original.text);
  assert.equal(parsed.revision,1);
  await assert.rejects(readResume(file('Resume.html',original.text)),/PDF, DOCX/);
  await assert.rejects(readResume(file('Resume.txt','short')),/enough text/);
});
test('PDF exports retain content on one page and reject real layout overflow',async()=>{
  const buffer=await resumePdf('EXAMPLE CANDIDATE\nWORK EXPERIENCE\n- Reviewed ASC 606 revenue controls and contract accounting.');
  const parser=new PDFParse({data:buffer});
  try { const result=await parser.getText(); assert.equal(result.total,1); assert.match(result.text,/Reviewed ASC 606/); } finally { await parser.destroy(); }
  await assert.rejects(resumePdf(Array.from({length:80},(_,i)=>`Experience ${i}: reviewed revenue controls and contract accounting.`).join('\n')),/exceeds one page/);
});
