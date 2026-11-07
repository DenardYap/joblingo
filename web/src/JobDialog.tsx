import { Select, Tabs } from '@radix-ui/themes';
import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { listingState, statuses, type Draft, type Job, type Resume, type Capabilities } from '../../shared/workspace';
import type { Research } from '../../server/research';
import { api, displayDate, post, timeAgo } from './lib/api';
import { CompanyLogo } from './CompanyLogo';
import { CompanyMetadata } from './CompanyMetadata';
import { hasNamedEmployer } from '../../shared/company-identity';
import { Icon } from './Icons';

const PdfPreview=lazy(()=>import('./PdfPreview').then(module=>({default:module.PdfPreview})));
type Tab = 'Role' | 'Company' | 'People' | 'Resume';
export function JobDialog({ job: initialJob, resumes, drafts, capabilities, update, refresh, close }: { job: Job; resumes: Resume[]; drafts: Draft[]; capabilities: Capabilities; update: (id: string, patch: Partial<Job>) => Promise<void>; refresh: () => void; close: () => void }) {
  const [job, setJob] = useState(initialJob);
  useEffect(() => setJob(initialJob), [initialJob]);
  const ref = useRef<HTMLDialogElement>(null);
  const [tab, setTab] = useState<Tab>('Role');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [research, setResearch] = useState<Research | null>(null);
  const [baseId, setBaseId] = useState(drafts.filter(d=>d.jobId===job.id&&resumes.some(r=>r.id===d.resumeId)).sort((a,b)=>b.createdAt.localeCompare(a.createdAt))[0]?.resumeId ?? (resumes.some(r=>r.id===job.matchContext?.resumeId)?job.matchContext?.resumeId:null) ?? [...resumes].sort((a,b)=>b.createdAt.localeCompare(a.createdAt))[0]?.id ?? '');
  const [draft, setDraft] = useState<Draft | null>(() => drafts.filter((d) => d.jobId === job.id&&resumes.some(r=>r.id===d.resumeId)).sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0] ?? null);
  const [blocks, setBlocks] = useState(draft?.blocks ?? []);
  const [editing, setEditing] = useState(false);
  const [notes, setNotes] = useState(job.notes);
  const [googleUrl, setGoogleUrl] = useState(draft?.googleUrl ?? '');
  useEffect(() => { ref.current?.showModal(); return () => ref.current?.close(); }, []);
  useEffect(() => {
    let disposed = false;
    let timer: ReturnType<typeof setTimeout>;
    const read = async () => { try { const value = await api<Research | null>(`/jobs/${job.id}/research`); if (disposed) return; setResearch(value); if (!job.example && (!value || !['completed', 'failed', 'cancelled', 'unresolved'].includes(value.status) || (value.status === 'completed' && !value.listing))) timer = setTimeout(() => void read(), 4000); } catch (error) { if (!disposed) { setError((error as Error).message); timer = setTimeout(() => void read(), 10000); } } };
    void read(); return () => { disposed = true; clearTimeout(timer); };
  }, [job.id, busy]);
  async function task(label: string, action: () => Promise<void>) { setBusy(label); setError(''); try { await action(); } catch (error) { setError((error as Error).message); } finally { setBusy(''); } }
  async function saveDraft() { if (!draft || JSON.stringify(blocks) === JSON.stringify(draft.blocks ?? [])) return; const saved = await api<Draft>(`/drafts/${draft.id}`, { method: 'PATCH', body: JSON.stringify({ edits: blocks.map(({id,text})=>({id,text})), revision: draft.revision ?? 1 }) }); setDraft(saved); setBlocks(saved.blocks ?? []); setEditing(false); setGoogleUrl(''); refresh(); }
  async function dismiss() { if(busy)return; await task('Saving', async () => { await saveDraft(); if (notes !== job.notes) await update(job.id, { notes }); close(); }); }
  async function recheck() { const checked = await post<Job>(`/jobs/${job.id}/verify`); setJob(checked); refresh(); return checked; }
  function openApplication() {
    if (!job.url) return;
    const popup=window.open('about:blank','_blank');
    if(!popup) {setError('Allow a new tab to open the application.');return;}
    popup.opener=null;
    void task('Checking listing', async () => {
      try {
        const checked=await recheck();
        if(listingState(checked)!=='Open' || !checked.url) throw new Error(checked.availabilityReason ?? 'This listing is not confirmed open.');
        popup.location.replace(checked.url);
        if(checked.status==='Not started') await update(job.id,{status:'Applied',appliedAt:new Date().toISOString()});
      } catch(error) {popup.close();throw error;}
    });
  }
  function openGoogleDoc() {
    // Reserve the tab during the click: opening it after the API call is blocked
    // by browsers once the user activation has expired.
    const popup=capabilities.googleConnected?window.open('about:blank','_blank'):null;
    if(capabilities.googleConnected&&!popup){setError('Allow a new tab to open Google Docs.');return;}
    if(popup)popup.opener=null;
    void task(capabilities.googleConnected?'Creating Google Doc':'Connecting Google',async()=>{
      try{
        await saveDraft();
        if(!capabilities.googleConnected){
          const status=await api<{configured:boolean}>('/google/status');
          if(!status.configured)throw new Error('Open Settings → Google Docs to set up the connection.');
          const {url}=await post<{url:string}>('/google/connect');
          sessionStorage.setItem('resume-return-job',job.id);window.location.assign(url);return;
        }
        const result=await post<{url:string}>(`/drafts/${draft!.id}/google`);
        setGoogleUrl(result.url);popup!.location.replace(result.url);refresh();
      }catch(error){popup?.close();throw error;}
    });
  }
  const researchPending = !job.example && (!research || !['completed', 'failed', 'cancelled', 'unresolved'].includes(research.status));
  const researchFailed = research && (['failed', 'cancelled'].includes(research.status) || (research.status === 'unresolved' && hasNamedEmployer(job.company)));
  return <dialog ref={ref} className="job-dialog" aria-labelledby="job-title" onCancel={(event) => { event.preventDefault(); void dismiss(); }}>
    <div className="dialog-heading">
      <div className="dialog-company"><CompanyLogo job={job} /><span>{job.company}{job.example ? ' · Example' : ''}</span></div>
      <span className="match-value" title="Fit to your search criteria; not a hiring probability.">{listingState(job) === 'Open' && job.matchCurrent !== false ? job.score : '—'}<small>/100 fit</small></span>
      <button className="icon-button dialog-close" aria-label="Close job details" disabled={Boolean(busy)} onClick={() => void dismiss()}><Icon name="close" /></button>
      <div className="dialog-title-copy"><h2 id="job-title">{job.title}</h2><p className="dialog-subtitle">{job.location ?? 'Location not listed'}{job.workplace !== 'Unknown' && <> · {job.workplace}</>}</p></div>
    </div>
    <div className="dialog-actions"><button className="button primary" disabled={!job.url || Boolean(busy) || listingState(job) !== 'Open'} onClick={openApplication}>{busy === 'Checking listing' ? 'Checking…' : 'Open application'}<Icon name="external" size={15} /></button><button className={`icon-button ${job.saved ? 'saved' : ''}`} aria-label={job.saved ? 'Unsave job' : 'Save job'} aria-pressed={job.saved} onClick={() => void task('Saving', () => update(job.id, { saved: !job.saved }))}><Icon name="bookmark" size={19} filled={job.saved} /></button><label className="status-control"><span className="sr-only">Application status</span><Select.Root value={job.status} disabled={Boolean(busy)} onValueChange={(value) => void task('Updating status', () => update(job.id, { status: value as Job['status'] }))}><Select.Trigger variant="soft" color="gray" aria-label="Application status" /><Select.Content container={ref.current} position="popper">{statuses.map((status) => <Select.Item key={status} value={status}>{status}</Select.Item>)}</Select.Content></Select.Root></label></div>
    <Tabs.Root className="job-tabs-root" value={tab} onValueChange={(value) => { setTab(value as Tab); setError(''); }}>
    <Tabs.List className="dialog-tabs" aria-label="Job details">{(['Role', 'Company', 'People', 'Resume'] as Tab[]).map((name) => <Tabs.Trigger key={name} value={name}>{name}</Tabs.Trigger>)}</Tabs.List>
    <Tabs.Content className="dialog-body" value={tab} key={tab} tabIndex={0}>
      {error && <p className="inline-error" role="alert">{error}</p>}
      {tab === 'Role' && <><div className={`availability-notice ${listingState(job).toLowerCase()}`}><div><strong>{job.example ? 'Example listing' : listingState(job) === 'Open' ? 'Open' : listingState(job) === 'Closed' ? 'This listing is closed' : 'Availability needs checking'}</strong>{listingState(job) !== 'Open' && <p>{job.availabilityReason ?? 'Run a live check before applying.'}</p>}{job.checkedAt && <small>Checked {timeAgo(job.checkedAt).toLowerCase()}</small>}</div><button className="button secondary" disabled={Boolean(busy) || job.example} onClick={() => void task('Checking listing', async()=>{await recheck();})}>{busy === 'Checking listing' ? 'Checking…' : 'Recheck'}</button></div><dl className="job-facts"><div><dt>Salary</dt><dd>{job.salary ?? 'Not listed'}</dd></div><div><dt>Sponsorship</dt><dd>{job.sponsorship === 'Unknown' ? 'Unknown · confirm with recruiter' : job.sponsorship}</dd></div><div><dt>Office attendance</dt><dd>{job.officeDays ?? (job.workplace === 'Remote' ? 'Remote' : 'Not listed')}</dd></div><div><dt>Experience</dt><dd>{job.experience ?? 'Not listed'}</dd></div><div><dt>Source</dt><dd>{job.url ? <a href={job.url} target="_blank" rel="noreferrer">{job.source} ↗</a> : job.source}</dd></div><div><dt>Posted</dt><dd>{timeAgo(job.postedAt)}{job.postedAt && <small className="muted"> · {displayDate(job.postedAt)}</small>}</dd></div><div><dt>First found</dt><dd>{displayDate(job.foundAt)}</dd></div><div><dt>Last found</dt><dd>{displayDate(job.lastFoundAt)}</dd></div></dl>
        {job.sponsorshipEvidence && <blockquote>{job.sponsorshipEvidence}</blockquote>}
        <section className="detail-section"><h3>Why it matches</h3>{job.matchCurrent === false && <p className="match-refresh-note">Your resume or search criteria have changed. Run a search to refresh this assessment.</p>}<p>{job.reason}</p>{job.publicPreferenceApplied && <p className="small muted">Base fit {job.baseScore ?? job.score} × 95% + {job.publicCompanyBonus ?? 0}/5 public-company points.</p>}<p className="small muted">{job.matchContext?.resumeId ? `Matched against ${job.matchContext.resumeName}.` : job.matchContext?.backgroundUsed ? 'Matched using candidate background.' : 'Scored from search settings without a resume.'} {job.matchContext?.backgroundUsed && job.matchContext.resumeId ? ' Additional experience included.' : ''} {job.matchContext?.resumeRevision ? ` Resume version ${job.matchContext.resumeRevision}.` : ''} {job.matchContext ? `Assessed ${displayDate(job.matchContext.assessedAt)}.` : 'Run a new search for a component breakdown.'}</p>{job.scoreBreakdown && <dl className="score-breakdown">{job.scoreBreakdown.map((item)=><div key={item.key}><dt>{item.label}<small>{item.reason}</small></dt><dd>{item.points}/{item.maxPoints}</dd></div>)}</dl>}<div className="fit-columns"><div><h4>Strengths</h4><ul>{job.strengths.map((s) => <li key={s}>{s}</li>)}</ul></div><div><h4>Check before applying</h4><ul>{job.gaps.length ? job.gaps.map((s) => <li key={s}>{s}</li>) : <li>No additional gaps identified.</li>}</ul></div></div>{job.requirements.map((r, i) => <details className="requirement-check" key={i}><summary>{r.result} · {r.requirement}</summary><p>{r.evidence}</p></details>)}</section>
        <section className="detail-section"><h3>Job description</h3><p className="pre-wrap">{job.description}</p></section><section className="detail-section"><label htmlFor="job-notes">Your notes</label><textarea id="job-notes" rows={3} maxLength={10000} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Recruiter questions and follow-up notes…" /><button className="button secondary" disabled={Boolean(busy)} onClick={() => void task('Saving notes', () => update(job.id, { notes }))}>Save notes</button>{!job.example && listingState(job) !== 'Closed' && <button className="button secondary report-closed" disabled={Boolean(busy)} onClick={() => void task('Marking closed',async()=>{setJob(await post<Job>(`/jobs/${job.id}/report-closed`));refresh();})}>Mark listing closed</button>}</section></>}
      {(tab === 'Company' || tab === 'People') && <>
        <div className="research-toolbar">{researchFailed && <button className="button secondary" disabled={job.example || Boolean(busy) || Boolean(researchPending)} onClick={() => void task('Retrying research', async () => { setResearch(await post<Research>(`/jobs/${job.id}/research`)); })}>{busy === 'Retrying research' ? 'Retrying…' : 'Retry research'}</button>}</div>
        {researchPending && <div className="working-state"><span className="spinner" />{research?.id ? 'Researching company and contacts…' : 'Research queued…'}</div>}
        {research?.identityNotice && <p className="identity-notice">{research.identityNotice}</p>}
        {research?.error && <p className="inline-error">{research.error}</p>}
        {tab === 'Company' && <CompanyMetadata research={research} job={job} pending={researchPending} />}
        {research?.data ? <>{research.stopReason && research.stopReason !== 'schema_satisfied' && <p className="muted small">Research ended: {research.stopReason.replaceAll('_', ' ')}. Results may be partial.</p>}{tab === 'Company' ? null : <div className="people-list">{research.data.people.length ? research.data.people.map((person) => <article key={person.url}><Icon name="people" /><div><a href={person.url} target="_blank" rel="noreferrer">{person.name} ↗</a><span>{person.title}</span><p>{person.reason}</p></div></article>) : <p className="muted">No verified contacts were found.</p>}</div>}<div className="research-sources"><h4>Sources</h4>{research.data.sources.map((source) => <a key={source.url} href={source.url} target="_blank" rel="noreferrer">{source.title} ↗</a>)}</div></> : !researchPending && !research?.identityNotice && <p className="muted research-summary">{job.example ? 'Open a real job to research its company and contacts.' : 'Research could not complete. Retry to fill the Company and People tabs.'}</p>}
      </>}
      {tab === 'Resume' && <><h3>Tailor a one-page resume</h3><div className="tailor-controls"><label><span className="sr-only">Base resume</span><Select.Root value={baseId || undefined} onValueChange={setBaseId} disabled={!resumes.length}><Select.Trigger variant="soft" color="gray" className="full-width" placeholder="Choose a base resume" aria-label="Base resume" /><Select.Content container={ref.current} position="popper">{resumes.map((r) => <Select.Item key={r.id} value={r.id}>{r.name}</Select.Item>)}</Select.Content></Select.Root></label><button className="button primary" disabled={!baseId || job.example || Boolean(busy) || !capabilities.ai} onClick={() => void task('Tailoring resume', async () => { const value = await post<Draft>(`/jobs/${job.id}/drafts`, { resumeId: baseId }); setDraft(value); setBlocks(value.blocks ?? []); setEditing(false); setGoogleUrl(''); refresh(); })}>{busy === 'Tailoring resume' ? 'Tailoring…' : draft ? 'Create new version' : 'Craft resume'}</button></div>
        {!resumes.length && <p className="muted small">Upload a base resume in the Resumes section first.</p>}{busy === 'Tailoring resume' && <div className="working-state"><span className="spinner" />Tailoring from your existing experience and checking the one-page layout.</div>}
        {draft && <>
          {['original-docx','original-pdf'].includes(draft.format??'') ? <>
            <Suspense fallback={<div className="resume-pdf pdf-preview"><p className="pdf-loading">Loading PDF…</p></div>}><PdfPreview url={`/api/drafts/${draft.id}/pdf?inline=1&revision=${draft.revision??1}`} text={draft.text}/></Suspense>
            <div className="draft-actions">
              <a className="button secondary" href={`/api/drafts/${draft.id}/pdf`} download="resume.pdf"><Icon name="download" size={16} />PDF</a>
              <a className="button secondary" href={`/api/drafts/${draft.id}/docx`} download="resume.docx">Word</a>
              <button className="button secondary" disabled={Boolean(busy)} onClick={()=>setEditing(!editing)}>{editing?'Hide bullet editor':'Edit bullets'}</button>
              <button className="button primary" disabled={Boolean(busy)} onClick={openGoogleDoc}>{busy==='Creating Google Doc'?'Opening…':capabilities.googleConnected?googleUrl?'Open Google Doc':'Create Google Doc':'Connect Google Docs'}</button>
            </div>
            {googleUrl&&<a className="google-link" href={googleUrl} target="_blank" rel="noreferrer">Open editable Google Doc ↗</a>}
            {editing&&<div className="bullet-editor">{blocks.map((block,index)=><label key={block.id}>{block.label}<textarea rows={3} maxLength={2000} value={block.text} onChange={e=>setBlocks(old=>old.map((b,i)=>i===index?{...b,text:e.target.value}:b))} /></label>)}<button className="button secondary" disabled={Boolean(busy)} onClick={()=>void task('Saving draft',saveDraft)}>{busy==='Saving draft'?'Checking layout…':'Save and update PDF'}</button><button className="button secondary" disabled={Boolean(busy)} onClick={()=>{setBlocks(draft.blocks??[]);setEditing(false);setError('');}}>Cancel</button></div>}
            <p className="muted small">{draft.format==='original-pdf'?'Original PDF layout':'Original Word layout'} · one-page PDF · based on resume version {draft.resumeRevision??1}. Google Docs may reflow the document after import.</p>
          </> : <p className="muted">Create a new version to use the original Word layout and PDF preview.</p>}
          <div className="draft-review"><h4>Changes to review</h4><ul>{draft.changes.map(change=><li key={change}>{change}</li>)}</ul>{draft.warnings.length>0&&<><h4>Review carefully</h4><ul>{draft.warnings.filter(w=>!/exact line fit cannot|without the referenced PDF|rendered DOCX/i.test(w)).map(warning=><li key={warning}>{warning}</li>)}</ul></>}</div>
        </>}

      </>}
    </Tabs.Content></Tabs.Root>
  </dialog>;
}
