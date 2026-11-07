import { WORD_LAYOUT_VERSION,pdfWordCompanion,readPdfTemplate,patchPdfTemplate } from './pdf-template.js';
import { workspaceId } from './workspace-context.js';
import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import { z } from 'zod';
import { PDFParse } from 'pdf-parse';
import mammoth from 'mammoth';
import PDFDocument from 'pdfkit';
import { google } from 'googleapis';
import { structured } from './ai.js';
import { get, put, database } from './store.js';
import { PDF_LAYOUT_VERSION, patchTemplate, readTemplate, templatePdf, type BlockEdit } from './docx-template.js';
import { googleAuth } from './google.js';
import type { Draft, Job, Resume } from '../shared/workspace.js';

export async function readResume(file: Express.Multer.File): Promise<Resume> {
  const extension = file.originalname.split('.').pop()?.toLowerCase();
  let text: string;
  if (extension === 'pdf') {
    const parser = new PDFParse({ data: file.buffer });
    try { text = (await parser.getText()).text; } finally { await parser.destroy(); }
  } else if (extension === 'docx') text = (await mammoth.extractRawText({ buffer: file.buffer })).value;
  else if (extension === 'txt') text = file.buffer.toString('utf8');
  else throw new Error('Upload a PDF, DOCX, or plain text resume.');
  text = text.trim();
  if (text.length < 50) throw new Error('Couldn’t read enough text. Upload a text-based PDF, DOCX, or TXT file.');
  if (text.length > 50000) throw new Error('This resume is too long. Upload a shorter version.');
  return { id: randomUUID(), name: file.originalname.slice(0, 160), text, originalText: text, originalName: file.originalname.slice(0, 160), revision: 1, createdAt: new Date().toISOString() };
}
const draftSchema = z.object({ edits: z.array(z.object({id:z.string(),text:z.string()})), changes: z.array(z.string()), warnings: z.array(z.string()) });
type ResumeFile={docx?:string;pdf?:string};
type DraftFile={docx:string;pdf:string;template:string;templateFormat?:'pdf';wordLayoutVersion?:number;pdfLayoutVersion?:number};
export async function attachTemplate(resume:Resume,file:Express.Multer.File){
  if(!file.originalname.toLowerCase().endsWith('.docx'))throw new Error('Upload the original DOCX to preserve its formatting.');
  const original=(await mammoth.extractRawText({buffer:file.buffer})).value.trim();
  if(original !== (resume.originalText ?? resume.text))throw new Error('This file does not match the original uploaded resume.');
  readTemplate(file.buffer);
  await put('resume-files',resume.id,{docx:file.buffer.toString('base64')});
  await put('resumes',resume.id,{...resume,templateAvailable:true});
}
export async function storeResumeTemplate(resume:Resume,file:Express.Multer.File){
  if(file.originalname.toLowerCase().endsWith('.docx'))await attachTemplate(resume,file);
  else if(file.originalname.toLowerCase().endsWith('.pdf')){let templateAvailable=true;try{await readPdfTemplate(file.buffer);}catch{templateAvailable=false;}await put('resume-files',resume.id,{pdf:file.buffer.toString('base64')});await put('resumes',resume.id,{...resume,templateAvailable});}
}
async function buildDraft(template:Buffer,edits:BlockEdit[],pdf=false){
  if(pdf){const result=await patchPdfTemplate(template,edits);return{...result,text:(await mammoth.extractRawText({buffer:result.docx})).value.trim()};}
  const docx=patchTemplate(template,edits);const rendered=await templatePdf(docx);
  return {docx,pdf:rendered.pdf,pages:rendered.pages,blocks:readTemplate(docx).blocks,text:(await mammoth.extractRawText({buffer:docx})).value.trim()};
}
export async function tailor(job: Job, resume: Resume, candidateBackground = ''): Promise<Draft> {
  const source=await get<ResumeFile>('resume-files',resume.id);
  if(!source?.docx&&!source?.pdf)throw new Error('Upload a one-page PDF or DOCX resume before tailoring.');
  const isPdf=Boolean(source.pdf);const template=Buffer.from((source.pdf||source.docx)!,'base64');const slots=isPdf?await readPdfTemplate(template):readTemplate(template).blocks;
  const system=`Act as an expert career coach. Tailor only the supplied editable paragraphs of this resume to the job. Return every editable paragraph exactly once using its existing id. Do not add, remove or reorder paragraphs.
The uploaded template controls all formatting, name/contact information, employers, titles, dates and education; none of these are editable.
Rewrite each experience bullet as one concise sentence using the Action–Context–Result framework: start with a strong action verb, describe the relevant work and its scope, then state the supported outcome. Incorporate the job description's most relevant keywords where they accurately describe the candidate's experience. Avoid clichés such as "passionate", "team player" and "results-driven".
Preserve the substance, scope and useful quantified achievements; condense wording instead of removing evidence. Preserve verified numbers and percentages from the resume or candidate background. Never invent or infer impact metrics. If no quantified result is supported, use a factual qualitative outcome; if no outcome is evidenced, describe the verified work without manufacturing a result to complete the framework.
Use the current working resume and additional background as candidate facts, with original slots as layout references. User edits supersede the original wording; flag conflicting facts. Do not mix employers or repeat accomplishments. Audit/testing and reviewing controls does NOT mean preparing journal entries or owning a close. Never invent metrics, tools, experience or eligibility. Skills must be evidenced; emphasize relevant existing skills and keep the skills paragraph a concise list.
Do not prefix bullets; numbering is already in the template. Target 280–330 words across editable paragraphs, with most bullets on one or two lines. Use existing slot lengths as upper bounds where possible. Keep the best details and make the connection to the job explicit without exaggeration. Explain meaningful changes and flag unsupported job requirements separately. Use plain section names in review notes; never expose paragraph ids or implementation details.`;
  const instructions=isPdf?`${system} The uploaded PDF is the exact visual reference. Every bullet must fit inside its original maxLines and original text length. Protected content never moves. Keep short one-line bullets short. The server validates exact PDF line fit. Do not add warnings about file access, rendering, line fit or internal block ids; review notes should cover candidate facts and job gaps.`:system;
  let result=await structured(draftSchema,instructions,{currentResume:resume.text,additionalBackground:candidateBackground,editableParagraphs:slots,job:{title:job.title,company:job.company,description:job.description}});
  let built:Awaited<ReturnType<typeof buildDraft>>|undefined;
  for(let attempt=0;attempt<3;attempt++){
    if(result.edits.length!==slots.length)throw new Error('The generated resume omitted a paragraph. Try creating it again.');
    let layoutError='';
    try{built=await buildDraft(template,result.edits,isPdf);}catch(error){if(!isPdf||!/(?:exceeds its original|original embedded font cannot render)/.test(String((error as Error).message)))throw error;layoutError=(error as Error).message;}
    if(built?.pages===1&&!layoutError)break;
    if(attempt===2)throw new Error(isPdf?(layoutError||'The tailored text still exceeds its original text areas. Try again with shorter bullets.'):'The tailored text still exceeds one page in the original layout. Try another version.');
    result=await structured(draftSchema,instructions,{currentResume:resume.text,additionalBackground:candidateBackground,editableParagraphs:slots,previous:result,job:{title:job.title,description:job.description},revisionInstruction:`${layoutError || `The PDF was ${built?.pages} pages.`} Shorten editable paragraphs by another 20 percent. Maintain one concise Action–Context–Result sentence per experience bullet, using only supported facts and outcomes. Preserve core metrics and scope; reduce repetition and secondary detail. Do not change layout or protected content.`});
  }
  const draft:Draft={id:randomUUID(),jobId:job.id,resumeId:resume.id,resumeRevision:resume.revision??1,backgroundUsed:Boolean(candidateBackground.trim()),createdAt:new Date().toISOString(),format:isPdf?'original-pdf':'original-docx',revision:1,text:built!.text,blocks:built!.blocks,changes:result.changes,warnings:result.warnings.filter(w=>!/exact line fit cannot|without the referenced PDF|rendered DOCX/i.test(w))};
  await put('draft-files',draft.id,{docx:built!.docx.toString('base64'),pdf:built!.pdf.toString('base64'),template:(source.pdf||source.docx)!,...(isPdf?{templateFormat:'pdf',wordLayoutVersion:WORD_LAYOUT_VERSION}:{}),pdfLayoutVersion:PDF_LAYOUT_VERSION});
  await put('drafts',draft.id,draft);return draft;
}
export async function editDraft(draft:Draft,edits:BlockEdit[],revision:number){
  if((draft.revision??1)!==revision)throw new Error('This draft changed in another window. Reopen it before editing.');
  const source=await get<DraftFile>('draft-files',draft.id);
  if(!source||!['original-docx','original-pdf'].includes(draft.format??''))throw new Error('Create a new version using the original DOCX first.');
  const merged=new Map((draft.blocks??[]).map(b=>[b.id,{id:b.id,text:b.text}]));
  for(const edit of edits){if(!merged.has(edit.id))throw new Error('Only experience bullets and skills are editable.');merged.set(edit.id,edit);}
  const built=await buildDraft(Buffer.from(source.template,'base64'),[...merged.values()],source.templateFormat==='pdf');
  if(built.pages!==1)throw new Error('These edits exceed one page. Shorten the bullets and save again; the previous PDF is unchanged.');
  const next={...draft,text:built.text,blocks:built.blocks,revision:revision+1,googleUrl:null};
  const files={...source,docx:built.docx.toString('base64'),pdf:built.pdf.toString('base64'),pdfLayoutVersion:PDF_LAYOUT_VERSION,...(source.templateFormat==='pdf'?{wordLayoutVersion:WORD_LAYOUT_VERSION}:{})};
  const result=await(await database()).query(`WITH updated AS (
    UPDATE workspace_records SET data=$3::jsonb WHERE workspace_id=$5 AND kind='drafts' AND id=$1 AND COALESCE((data->>'revision')::integer,1)=$2 RETURNING id
  ) UPDATE workspace_records SET data=$4::jsonb WHERE workspace_id=$5 AND kind='draft-files' AND id IN (SELECT id FROM updated) RETURNING id`,[draft.id,revision,JSON.stringify(next),JSON.stringify(files),workspaceId()]);
  if(!result.rows.length)throw new Error('This draft changed in another window. Reopen it before editing.');return next;
}
const refreshingPdfs=new Map<string,Promise<Buffer>>();
export async function draftPdf(draft:Draft):Promise<Buffer>{
  const file=await get<DraftFile>('draft-files',draft.id);
  if(!file)return resumePdf(draft.text);
  if(file.templateFormat==='pdf'||file.pdfLayoutVersion===PDF_LAYOUT_VERSION)return Buffer.from(file.pdf,'base64');
  const key=`${workspaceId()}:${draft.id}`;const pending=refreshingPdfs.get(key);if(pending)return pending;
  const rendering=(async()=>{
    const rendered=await templatePdf(Buffer.from(file.docx,'base64'));
    if(rendered.pages!==1)throw new Error('This saved draft exceeds one page with the corrected layout. Shorten its bullets and save again.');
    // Never overwrite a newer bullet edit while refreshing an older cached PDF.
    const saved=await(await database()).query("UPDATE workspace_records SET data=data || $2::jsonb WHERE workspace_id=$4 AND kind='draft-files' AND id=$1 AND data->>'docx'=$3 RETURNING id",[draft.id,JSON.stringify({pdf:rendered.pdf.toString('base64'),pdfLayoutVersion:PDF_LAYOUT_VERSION}),file.docx,workspaceId()]);
    return saved.rows.length?rendered.pdf:draftPdf(draft);
  })();
  refreshingPdfs.set(key,rendering);
  try{return await rendering;}finally{refreshingPdfs.delete(key);}
}
export async function draftDocx(draft:Draft){
 const file=await get<DraftFile>('draft-files',draft.id);if(!file)throw new Error('Create a new version from the original resume first.');
 if(file.templateFormat==='pdf'&&file.wordLayoutVersion!==WORD_LAYOUT_VERSION){const docx=await pdfWordCompanion(Buffer.from(file.pdf,'base64'));await(await database()).query("UPDATE workspace_records SET data=data || $3::jsonb WHERE workspace_id=$1 AND kind='draft-files' AND id=$2 AND data->>'pdf'=$4",[workspaceId(),draft.id,JSON.stringify({docx:docx.toString('base64'),wordLayoutVersion:WORD_LAYOUT_VERSION}),file.pdf]);return docx;}
 return Buffer.from(file.docx,'base64');
}

export async function resumePdf(text: string): Promise<Buffer> {
  if (!text.trim()) throw new Error('The resume is empty.');
  if (text.length > 8000) throw new Error('Shorten the resume to fit one page.');
  const doc = new PDFDocument({ size: 'LETTER', margin: 40, bufferPages: true, info: { Title: 'Resume', Author: '' } });
  const chunks: Buffer[] = [];
  const done = new Promise<Buffer>((resolve, reject) => { doc.on('data', (chunk: Buffer) => chunks.push(chunk)); doc.on('end', () => resolve(Buffer.concat(chunks))); doc.on('error', reject); });
  const lines = text.replaceAll('\r', '').split('\n');
  let first = true;
  for (const line of lines) {
    if (!line.trim()) { doc.moveDown(.3); continue; }
    const heading = line.length < 60 && line === line.toUpperCase() && /[A-Z]/.test(line);
    doc.font(first || heading ? 'Helvetica-Bold' : 'Helvetica').fontSize(first ? 15 : heading ? 10.5 : 10);
    doc.text(line, { lineGap: 2, paragraphGap: first || heading ? 4 : 1 });
    first = false;
  }
  const pages = doc.bufferedPageRange().count;
  doc.end();
  const buffer = await done;
  if (pages !== 1) throw new Error('This draft exceeds one page. Shorten it before exporting.');
  return buffer;
}
export function googleDocumentTitle(resumeName:string,company:string){return `${resumeName.replace(/\.(?:docx|pdf|txt)$/i,'').trim()||'Resume'} — ${company.trim()||'Company'}`.slice(0,240);}
export async function exportGoogle(draft: Draft) {
  const auth=await googleAuth();const drive=google.drive({version:'v3',auth});
  try {
    const resume=await get<Resume>('resumes',draft.resumeId)??await get<Resume>('archived-resumes',draft.resumeId),job=await get<Job>('jobs',draft.jobId);
    if(!resume||!job)throw new Error('The resume or job is no longer available.');
    const name=googleDocumentTitle(resume.name,job.company);
    if(draft.googleUrl&&(draft.format!=='original-pdf'||draft.googleLayoutVersion===WORD_LAYOUT_VERSION)){const id=new URL(draft.googleUrl).pathname.match(/^\/document\/d\/([a-zA-Z0-9_-]+)(?:\/|$)/)?.[1];if(!id)throw new Error('Invalid saved Google document.');await drive.files.update({fileId:id,requestBody:{name}});return draft.googleUrl;}
    const created=await drive.files.create({requestBody:{name,mimeType:'application/vnd.google-apps.document'},media:{mimeType:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',body:Readable.from(await draftDocx(draft))},fields:'id,webViewLink'});
    if(!created.data.id)throw new Error('Google Docs did not return a document.');
    return created.data.webViewLink ?? `https://docs.google.com/document/d/${created.data.id}/edit`;
  } catch(error){
    const code=(error as {response?:{status?:number}}).response?.status;
    if(code===401)throw new Error('Your Google connection expired. Reconnect Google Docs and try again.');
    if(code===403)throw new Error('Google Drive access was denied. Enable the Drive API for your OAuth project and reconnect with file access.');
    throw new Error('Google Docs could not create the document. Check your Google connection and try again.');
  }
}

export async function originalResume(resume:Resume){const files=await get<ResumeFile>('resume-files',resume.id);if(files?.pdf)return{body:Buffer.from(files.pdf,'base64'),type:'application/pdf',name:resume.originalName??resume.name};if(files?.docx)return{body:Buffer.from(files.docx,'base64'),type:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',name:resume.originalName??resume.name};return{body:Buffer.from(resume.originalText??resume.text),type:'text/plain',name:resume.originalName??resume.name};}
export async function archiveResume(id:string){
 const db=await database();const result=await db.query(`WITH moved AS (
  DELETE FROM workspace_records WHERE workspace_id=$1 AND id=$2 AND kind IN ('resumes','resume-files') RETURNING *
 ), archived AS (
  INSERT INTO workspace_records(workspace_id,kind,id,data) SELECT workspace_id,CASE WHEN kind='resumes' THEN 'archived-resumes' ELSE 'archived-resume-files' END,id,data FROM moved
  ON CONFLICT(workspace_id,kind,id) DO UPDATE SET data=excluded.data RETURNING id
 ) UPDATE workspace_records SET data=jsonb_set(data,'{matchingResumeId}','null'::jsonb) WHERE workspace_id=$1 AND kind='settings' AND id='main' AND data->>'matchingResumeId'=$2 RETURNING id`,[workspaceId(),id]);return result;
}
