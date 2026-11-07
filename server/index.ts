import 'dotenv/config';
import express from 'express';
import helmet from 'helmet';
import multer from 'multer';
import { resolve } from 'node:path';
import { z } from 'zod';
import { jobPatchSchema, preferencesSchema, preferenceScore, type Job, type Resume, type Run, type Draft } from '../shared/workspace.js';
import { aiReady } from './ai.js';
import { closeDatabase, get, list, patch, preferences, put, reconcileRuns, forEachWorkspace } from './store.js';
import { safeError } from './errors.js';
import { examples } from './fixtures.js';
import { searchReady, startRun } from './search/runner.js';
import { archiveResume, originalResume, attachTemplate, draftDocx, draftPdf, editDraft, exportGoogle, readResume, storeResumeTemplate, tailor } from './resumes.js';
import { bootstrapLegacyOwner, googleSignIn, googleCallback, googleConfigured, googleConnected, googleStart, googleDisconnect, redirectUri } from './google.js';
import { processResearch, readResearch, startResearch, type Research } from './research.js';
import { authStatus, requireGate, login, logout, protect, sameOrigin, validateProduction } from './auth.js';
import { findCompanyLogo, LOGO_VERSION } from './company-logo.js';
import { verifyJob } from './availability.js';
import { publicGet } from './public-web.js';
import { resumeEditSchema, reviseResume } from '../shared/resumes.js';
import { repairUnidentifiedEmployers } from './company-identity.js';
import { database } from './store.js';
import { WORD_LAYOUT_VERSION } from './pdf-template.js';
import { workspaceId } from './workspace-context.js';
import { matchingFingerprint, matchingResume } from './search/matching.js';
import { deduplicateJobs } from '../shared/job-deduplication.js';
import { groupedJob, updateJobTracking } from './job-groups.js';
import { distinctRun } from '../shared/search-runs.js';
import { normalizedEmployerName } from '../shared/company-identity.js';

validateProduction();
const app = express();
app.disable('x-powered-by'); app.use(helmet()); app.use(express.json({ limit: '128kb' })); app.use(sameOrigin);
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024, files: 1 } });
const jobById = async (id: string) => await get<Job>('jobs', id) ?? examples().find((job) => job.id === id);
const scoredJob = async (job:Job):Promise<Job> => {
  if(job.example) return job;
  const config=await preferences();
  return {...job,baseScore:job.baseScore ?? job.score,...preferenceScore(job.baseScore ?? job.score,config.preferPublicCompanies,job.companyListing),matchCurrent:job.matchContext?.profileFingerprint === matchingFingerprint(config,await matchingResume(config))};
};
app.get('/api/health', (_req, res) => res.json({ status: 'ok' }));
app.post('/api/login', login);
app.get('/api/auth/status',authStatus);
app.post('/api/auth/google',requireGate,googleSignIn);
app.post('/api/logout', logout);
app.get('/api/google/callback', googleCallback);
app.use('/api', protect);
app.get('/api/google/status', async (_req,res)=>res.json({configured:googleConfigured(),connected:await googleConnected(),redirectUri:redirectUri()}));
app.post('/api/google/connect',googleStart);
app.post('/api/google/disconnect',googleDisconnect);
app.get('/api/workspace', async (_req, res) => {
  await reconcileRuns();
  const stored = await list<Job>('jobs');
  const real = deduplicateJobs(await Promise.all(stored.filter((job) => !job.example).map(scoredJob)));
  const runs = (await list<Run>('runs')).map(run=>distinctRun(run,real)).sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  const jobs = real.length || runs.some((run) => run.status === 'Completed') ? real : examples().map((job) => stored.find((item) => item.id === job.id) ?? job);
  const companyFacts = Object.fromEntries((await list<Research>('research')).map(record => [record.jobId, { headcount: record.data?.company.headcount ?? null, researchStatus: record.status }]));
  for (const job of jobs) {
    const available = [job.id,...(job.relatedJobIds ?? [])].filter(id=>normalizedEmployerName(stored.find(item=>item.id===id)?.company ?? '')===normalizedEmployerName(job.company)).map(id => companyFacts[id]).filter(Boolean);
    companyFacts[job.id] = available.find(fact => fact?.headcount) ?? available[0] ?? {headcount:null,researchStatus:'unresolved'};
  }
  res.json({ account:{id:res.locals.account.id,email:res.locals.account.email,name:res.locals.account.name}, preferences: await preferences(), jobs, companyFacts, runs, resumes: await list<Resume>('resumes'), drafts: await list<Draft>('drafts'), capabilities: { search: searchReady(), ai: aiReady(), missing: ['EXA_API_KEY', 'OPENAI_API_KEY', 'OPENAI_MODEL'].filter((key) => !process.env[key]), googleConfigured: googleConfigured(), googleConnected: await googleConnected(), storage: process.env.DATABASE_URL ? 'PostgreSQL' : 'Local PostgreSQL' } });
});
app.put('/api/preferences', async (req, res) => { const value = preferencesSchema.parse(req.body); if (value.enabled && !searchReady()) throw new Error('Connect the search providers before enabling daily searches.'); if(value.matchingResumeId && !await get('resumes',value.matchingResumeId)) throw new Error('Choose an available matching resume.'); await put('settings', 'main', value); res.json(value); });
app.post('/api/runs', async (_req, res) => { const run = await startRun('Manual'); res.status(202).json(run); });
app.post('/api/jobs/:id/verify', async (req,res) => { const job=await jobById(req.params.id); if(!job) { res.status(404).json({error:'Job not found.'});return; } const checked=await verifyJob(job); res.json(await scoredJob(await groupedJob(job.id) ?? checked)); });
app.post('/api/jobs/:id/report-closed', async (req,res) => { const job=await get<Job>('jobs',req.params.id); if(!job) {res.status(404).json({error:'Job not found.'});return;} res.json(await scoredJob((await patch<Job>('jobs',job.id,{availability:'Closed',availabilityReason:'Marked closed after reviewing the source listing.',checkedAt:new Date().toISOString(),open:false}))!)); });
const logoCache=new Map<string,{body:Buffer;type:string;expires:number}>();
app.get('/api/jobs/:id/logo',async(req,res)=>{
  const job=await jobById(req.params.id); if(!job || job.example){res.sendStatus(404);return;}
  const group=await groupedJob(job.id) ?? job;
  const logoUrl=group.companyLogoVersion===LOGO_VERSION && group.companyLogoUrl ? group.companyLogoUrl : await findCompanyLogo(job.company,job);
  if(job.companyLogoVersion!==LOGO_VERSION || job.companyLogoUrl!==logoUrl) await patch('jobs',job.id,{companyLogoUrl:logoUrl,companyLogoVersion:LOGO_VERSION});
  if(!logoUrl){res.set('Cache-Control','private, max-age=300').sendStatus(404);return;}
  try {
    let logo=logoCache.get(logoUrl);
    if(!logo || logo.expires<Date.now()) {
      const response=await publicGet(logoUrl,512_000);
      if(response.status!==200 || !/^image\/(?:png|jpeg|webp|gif|svg\+xml|x-icon|vnd.microsoft.icon)(?:;|$)/i.test(response.type)){res.sendStatus(404);return;}
      logo={body:response.body,type:response.type,expires:Date.now()+86400000};
      if(logoCache.size>=100)logoCache.delete(logoCache.keys().next().value!);logoCache.set(logoUrl,logo);
    }
    res.set('Content-Type',logo.type).set('Content-Security-Policy',"default-src 'none'; sandbox").set('Cache-Control','private, max-age=86400').send(logo.body);
  } catch {res.sendStatus(404);}
});
app.patch('/api/jobs/:id', async (req, res) => { const changes = jobPatchSchema.parse(req.body); const job = await jobById(req.params.id); if (!job) { res.status(404).json({ error: 'Job not found.' }); return; } if (!await get('jobs', job.id)) await put('jobs', job.id, job); res.json(await scoredJob((await updateJobTracking(job.id,changes))!)); });
app.post('/api/resumes', upload.single('resume'), async (req, res) => { if (!req.file) throw new Error('Choose a resume file.'); const resume = await readResume(req.file); await put('resumes', resume.id, resume); await storeResumeTemplate(resume,req.file); res.status(201).json(await get('resumes',resume.id)); });
app.get('/api/resumes/:id/original',async(req,res)=>{const resume=await get<Resume>('resumes',req.params.id);if(!resume){res.sendStatus(404);return;}const file=await originalResume(resume);res.type(file.type).set('Content-Disposition',`inline; filename*=UTF-8''${encodeURIComponent(file.name)}`).send(file.body);});
app.post('/api/resumes/:id/restore',async(req,res)=>{
  const id=req.params.id;
  if(await get('archived-resumes',id)) await(await database()).query(`WITH moved AS (DELETE FROM workspace_records WHERE workspace_id=$1 AND id=$2 AND kind IN ('archived-resumes','archived-resume-files') RETURNING *) INSERT INTO workspace_records(workspace_id,kind,id,data) SELECT workspace_id,CASE WHEN kind='archived-resumes' THEN 'resumes' ELSE 'resume-files' END,id,data FROM moved ON CONFLICT(workspace_id,kind,id) DO NOTHING`,[workspaceId(),id]);
  const resume=await get<Resume>('resumes',id);
  if(!resume){res.status(404).json({error:'This resume is no longer available to restore.'});return;}
  res.json(resume);
});
app.delete('/api/resumes/:id',async(req,res)=>{
  // DELETE is idempotent: a response lost after archiving must not make the next
  // removal fail with a bare 404 while the client still shows the old row.
  const id=req.params.id;
  if(await get('resumes',id)) await archiveResume(id);
  res.json({ok:true,canRestore:Boolean(await get('archived-resumes',id))});
});
app.put('/api/resumes/:id/template',upload.single('resume'),async(req,res)=>{const resume=await get<Resume>('resumes',String(req.params.id));if(!resume||!req.file)throw new Error('Choose an existing resume and its original DOCX.');await attachTemplate(resume,req.file);res.json(await get('resumes',resume.id));});
app.patch('/api/resumes/:id', async (req, res) => {
  const input = resumeEditSchema.parse(req.body);
  const resume = await get<Resume>('resumes', req.params.id);
  if (!resume) { res.status(404).json({ error: 'Resume not found.' }); return; }
  const conflict = () => res.status(409).json({ error: 'This resume changed in another window. Reopen it before editing again.' });
  if ((resume.revision ?? 1) !== input.revision) { conflict(); return; }
  const updated = reviseResume(resume, input);
  const result = await (await database()).query("UPDATE workspace_records SET data=$3::jsonb WHERE kind='resumes' AND id=$1 AND workspace_id=$4 AND COALESCE((data->>'revision')::integer,1)=$2 RETURNING id", [resume.id, input.revision, JSON.stringify(updated),workspaceId()]);
  if (!result.rows.length) { conflict(); return; }
  res.json(updated);
});
app.post('/api/jobs/:id/drafts', async (req, res) => { const input = z.object({ resumeId: z.string() }).parse(req.body); const job = await jobById(req.params.id); const resume = await get<Resume>('resumes', input.resumeId); if (!job || !resume) throw new Error('Choose a job and a base resume first.'); if (job.example) throw new Error('Resume tailoring is available for real job listings.'); res.status(201).json(await tailor(job, resume, (await preferences()).candidateBackground)); });
app.patch('/api/drafts/:id', async (req, res) => { const input=z.object({edits:z.array(z.object({id:z.string(),text:z.string().min(1,'Each bullet and skills field needs text.').max(2000,'Keep each bullet under 2,000 characters.')})).max(100),revision:z.number().int().positive()}).strict().parse(req.body);const draft=await get<Draft>('drafts',req.params.id);if(!draft){res.status(404).json({error:'Draft not found.'});return;}res.json(await editDraft(draft,input.edits,input.revision)); });
app.get('/api/drafts/:id/pdf', async (req, res) => { const draft=await get<Draft>('drafts',req.params.id);if(!draft){res.sendStatus(404);return;}res.set('Content-Type','application/pdf').set('Content-Disposition',`${req.query.inline==='1'?'inline':'attachment'}; filename="resume.pdf"`).send(await draftPdf(draft)); });
app.get('/api/drafts/:id/docx',async(req,res)=>{const draft=await get<Draft>('drafts',req.params.id);if(!draft){res.sendStatus(404);return;}res.set('Content-Type','application/vnd.openxmlformats-officedocument.wordprocessingml.document').set('Content-Disposition','attachment; filename="resume.docx"').send(await draftDocx(draft));});
app.post('/api/drafts/:id/google', async (req, res) => { const draft = await get<Draft>('drafts', req.params.id); if (!draft) throw new Error('Draft not found.'); const url = await exportGoogle(draft); const saved=await(await database()).query("UPDATE workspace_records SET data=data || $3::jsonb WHERE workspace_id=$1 AND kind='drafts' AND id=$2 AND COALESCE((data->>'revision')::integer,1)=$4 RETURNING id",[workspaceId(),draft.id,JSON.stringify({googleUrl:url,googleLayoutVersion:WORD_LAYOUT_VERSION}),draft.revision??1]);if(!saved.rows.length)throw new Error('The draft changed while Google Docs was opening. Reopen the latest version.');res.json({url}); });
app.post('/api/jobs/:id/research', async (req, res) => { const job = await jobById(req.params.id); if (!job) throw new Error('Job not found.'); res.status(202).json(await startResearch(job)); });
app.get('/api/jobs/:id/research', async (req, res) => {
  const job=await groupedJob(req.params.id);
  const records=await Promise.all([req.params.id,...(job?.relatedJobIds ?? [])].map(id=>get<Research>('research',id)));
  const completed=records.find(record=>record?.status==='completed' && record.data?.employerName && job && normalizedEmployerName(record.data.employerName)===normalizedEmployerName(job.company));
  res.json(await readResearch(completed?.jobId ?? job?.id ?? req.params.id));
});
app.use('/api', (_req, res) => res.status(404).json({ error: 'Endpoint not found.' }));
app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  const message = error instanceof z.ZodError ? error.issues[0]?.message : safeError(error);
  res.status(400).json({ error: message });
});
if (process.env.NODE_ENV === 'production') { const root = resolve('dist/web'); app.use(express.static(root)); app.get('/{*path}', (_req, res) => res.sendFile(resolve(root, 'index.html'))); }
await bootstrapLegacyOwner();
await forEachWorkspace(repairUnidentifiedEmployers);
const port = Number(process.env.PORT ?? 3001);
const server = app.listen(port, process.env.NODE_ENV === 'production' ? '0.0.0.0' : '127.0.0.1', () => console.log(`Job workspace API: http://localhost:${port}`));
// Research persists and progresses independently of searches and open modals.
const researchTick = () => forEachWorkspace(processResearch).catch((error) => console.error('Background research:', safeError(error)));
void researchTick();
const researchTimer = setInterval(() => { void researchTick(); }, 10000);
// Local scheduling uses the same dispatcher as Render cron. The persisted lease
// prevents overlap with manual runs; production dispatch runs in a separate cron.
let timer: ReturnType<typeof setInterval> | undefined;
if (process.env.NODE_ENV !== 'production') timer = setInterval(() => { if (searchReady()) void forEachWorkspace(()=>startRun('Scheduled')).catch(() => {}); }, 60000);
for (const signal of ['SIGTERM', 'SIGINT'] as const) process.on(signal, () => { if (timer) clearInterval(timer); clearInterval(researchTimer); server.close(() => { void closeDatabase().finally(() => process.exit(0)); }); setTimeout(() => process.exit(1), 10000).unref(); });
