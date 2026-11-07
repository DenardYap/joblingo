import { Select } from '@radix-ui/themes';
import { useCallback, useEffect, useRef, useState, type FormEvent, type CSSProperties, type ReactNode } from 'react';
import { listingState, statuses, type Job, type Run, type Workspace } from '../../shared/workspace';
import { Icon } from './Icons';
import { api, ApiError, displayDate, post, timeAgo } from './lib/api';
import { Preferences } from './Preferences';
import { Resumes } from './Resumes';
import { CompanyLogo } from './CompanyLogo';
import { JobDialog } from './JobDialog';
import { JobToolbar } from './JobFilters';
import { defaultFilters, employeeCount, matchesFilters } from './lib/job-filters';
import { compareRecentJobs, withinPostingWindow } from '../../shared/job-recency';
import { runCounts, runExplanation, runExclusions, runNotice, runOutcome } from '../../shared/search-runs';

type View = 'jobs' | 'saved';
export function App() {
  const [data, setData] = useState<Workspace | null>(null);
  const [view, setView] = useState<View>('jobs');
  const [error, setError] = useState(''); const [notice, setNotice] = useState('');
  const [locked, setLocked] = useState(false); const [runPending, setRunPending] = useState(false);
  const [selected, setSelected] = useState<string | null>(null); const [panel, setPanel] = useState<'brief' | 'resumes' | 'activity' | null>(null);
  const resumeLeave = useRef<(() => Promise<boolean>) | null>(null);
  async function changePanel(next: typeof panel) { if (panel === 'resumes' && resumeLeave.current && !await resumeLeave.current()) return; setPanel(next); }
  const [filters, setFilters] = useState(defaultFilters);
  const [query, setQuery] = useState(''); const [sort, setSort] = useState('recommended'); const [limit, setLimit] = useState(100);
  const activeRun = data?.runs.find((run) => run.status === 'Running');
  const running = Boolean(activeRun);
  const refresh = useCallback(async () => { try { const value = await api<Workspace>('/workspace'); setData(value); setError(''); setLocked(false); } catch (error) { setError((error as Error).message); } }, []);
  useEffect(() => { const lock = () => {setLocked(true);setData(null);setNotice('');setPanel(null);setSelected(null);}; window.addEventListener('workspace-auth', lock); void refresh(); return () => window.removeEventListener('workspace-auth', lock); }, [refresh]);
  const researching = Object.values(data?.companyFacts ?? {}).some(fact => !['completed', 'failed', 'cancelled', 'unresolved'].includes(fact.researchStatus));
  useEffect(() => { if (!running && !researching) return; const timer = setInterval(() => void refresh(), running ? 3000 : 10000); return () => clearInterval(timer); }, [running, researching, refresh]);
  useEffect(() => setLimit(100), [filters, query, view, sort]);
  useEffect(()=>{const state=new URLSearchParams(window.location.search).get('google');if(!state)return;setNotice(state==='signed-in'?'Signed in.':state==='connected'?'Google Docs connected.':state==='wrong-account'?'Choose the Google account you signed in with.':state==='cancelled'?'Google sign-in cancelled.':'Google connection failed. Try signing in again.');const job=sessionStorage.getItem('resume-return-job');if(state==='connected'&&job){setSelected(job);sessionStorage.removeItem('resume-return-job');}else if(state!=='signed-in')setPanel('brief');window.history.replaceState(null,'',window.location.pathname);},[]);
  const wasRunning = useRef(false);
  useEffect(() => { if (wasRunning.current && !running && data) { const latest = data.runs[0]; setNotice(latest ? runNotice(latest) : 'Search finished.'); } wasRunning.current = running; }, [running, data]);
  async function update(id: string, changes: Partial<Job>) { const job = await api<Job>(`/jobs/${id}`, { method: 'PATCH', body: JSON.stringify(changes) }); setData((old) => old ? { ...old, jobs: old.jobs.map((item) => item.id === id ? job : item) } : old); }
  async function run() {
    const knownRuns = new Set(data?.runs.map(run => run.id));
    setRunPending(true); setNotice('');
    try {
      const started = await post<Run>('/runs');
      setData(old => old ? { ...old, runs: [started, ...old.runs.filter(run => run.id !== started.id)] } : old);
      await refresh();
    }
    catch (error) {
      if (error instanceof ApiError && error.retryable) {
        // A missing response is not proof that starting the search failed.
        // Recover its persisted status instead of submitting a second run.
        try {
          const latest = await api<Workspace>('/workspace'); setData(latest); setError('');
          const accepted = latest.runs.find(run => run.trigger === 'Manual' && !knownRuns.has(run.id));
          if (accepted) { setNotice(runNotice(accepted)); return; }
          setNotice('The search did not start. Please try Run search again.'); return;
        } catch { /* Keep the original connection error if recovery also fails. */ }
      }
      setNotice((error as Error).message);
    } finally { setRunPending(false); }
  }
  if (locked) return <Login notice={notice} onSuccess={refresh} />;
  if (!data) return <div className="initial-loading">{error ? <><p role="alert">{error}</p><button className="button secondary" onClick={() => void refresh()}>Retry</button></> : <><span className="spinner" /><p>Loading workspace…</p></>}</div>;
  const tz = data.preferences.timezone;
  const candidates = data.jobs.filter((job) => view !== 'saved' || job.saved);
  const filtered = candidates.filter(job => matchesFilters(job, data.companyFacts?.[job.id], filters, query, tz)).sort((a, b) => {
    if (sort === 'recommended') return compareRecentJobs(a,b,data.preferences.maxPostingAgeDays);
    if (sort === 'posted') return (Date.parse(b.postedAt ?? '') || 0) - (Date.parse(a.postedAt ?? '') || 0);
    if (sort === 'headcount') return (employeeCount(data.companyFacts?.[b.id]?.headcount)?.min ?? -1) - (employeeCount(data.companyFacts?.[a.id]?.headcount)?.min ?? -1);
    return sort === 'score' ? (b.matchCurrent === false ? -1 : b.score) - (a.matchCurrent === false ? -1 : a.score) : b.lastFoundAt.localeCompare(a.lastFoundAt);
  });
  const selectedJob = data.jobs.find((job) => job.id === selected);
  const exampleMode = data.jobs.length > 0 && data.jobs.every((job) => job.example);
  const outdatedScores = data.jobs.filter(job => !job.example && listingState(job) === 'Open' && job.matchCurrent === false && withinPostingWindow(job.postedAt,data.preferences.maxPostingAgeDays)).length;
  return <div className="app-shell"><a className="skip-link" href="#main">Skip to content</a>
    <div className="workspace"><header className="topbar"><h1>Jobs</h1><div className="header-actions"><span className="schedule-caption">{data.preferences.enabled ? `Daily at ${data.preferences.localTime}` : 'Daily search paused'}</span><button className="button primary" disabled={running || runPending} onClick={() => void run()}>{running || runPending ? <span className="spinner" /> : <Icon name="play" size={15} />}{running || runPending ? 'Searching…' : 'Run search'}</button><button className="icon-button" aria-label="Search history" title="Search history" onClick={() => setPanel('activity')}><Icon name="clock" /></button><button className="icon-button" aria-label="Settings" title="Settings" onClick={() => void changePanel('brief')}><Icon name="settings" /></button></div></header>
      <main id="main" tabIndex={-1}>
        {error && <p className="inline-error page-error" role="alert">{error}</p>}
        {(view === 'jobs' || view === 'saved') && <section className="jobs-page route-enter" key={view}>
          <JobToolbar jobs={data.jobs} filters={filters} onChange={setFilters} query={query} onQuery={setQuery} saved={view === 'saved'} onSaved={() => { setView(view === 'saved' ? 'jobs' : 'saved'); setFilters(current => ({ ...current, availability: view === 'saved' ? ['Open'] : [] })); }} sort={sort} onSort={setSort} count={filtered.length} timezone={tz} />
          {activeRun && <div className="running-line" role="status"><span className="spinner" /><span>{activeRun.phase === 'Preparing' ? 'Preparing search' : activeRun.phase === 'Searching' ? 'Finding more postings' : 'Checking postings'} · {runCounts(activeRun)}</span></div>}
          {!running && outdatedScores > 0 && <p className="library-note" role="status">Run search to refresh {outdatedScores} fit {outdatedScores === 1 ? 'score' : 'scores'} for your updated profile.</p>}
          {exampleMode && <p className="library-note">Sample jobs for preview. Run a search to replace these with real results.</p>}
          {!filtered.length ? <div className="empty-state"><Icon name="search" size={28} /><h2>{view === 'saved' && !candidates.length ? 'No saved jobs yet' : 'No jobs match these filters'}</h2><p>{view === 'saved' && !candidates.length ? 'Bookmark a role to keep it here.' : 'Try a wider range or clear a filter.'}</p><button className="button secondary" onClick={() => { setQuery(''); setFilters(defaultFilters()); setView('jobs'); }}>Reset filters</button></div> : <div className="table-scroll"><table className="jobs-table"><colgroup><col className="column-role" /><col className="column-score" /><col className="column-posted" /><col className="column-type" /><col className="column-headcount" /><col className="column-location" /><col className="column-salary" /><col className="column-visa" /><col className="column-status" /><col className="column-save" /></colgroup><thead><tr><th scope="col">Role</th><th scope="col" title="Fit to your criteria, not a hiring probability. Availability is checked separately.">Fit</th><th scope="col" title="Time since the employer posted the job">Posted</th><th scope="col">Company type</th><th scope="col">Headcount</th><th scope="col">Location</th><th scope="col">Salary / year</th><th scope="col">Sponsorship</th><th scope="col">Status</th><th scope="col"><span className="sr-only">Save</span></th></tr></thead><tbody>{filtered.slice(0, limit).map((job, index) => <tr key={job.id} className="job-row" aria-label={`${job.title} at ${job.company}`} onClick={(event) => {if (!(event.target as HTMLElement).closest('button,a,input,[role="combobox"],[role="option"],[data-row-control]')) setSelected(job.id);}} style={{ '--row-delay': `${Math.min(index, 8) * 20}ms` } as CSSProperties}>
            <td className="job-role"><div className="role-identity"><CompanyLogo job={job} /><div className="role-copy"><button onClick={() => setSelected(job.id)}>{job.title}</button><small>{job.company} · {job.source}</small><small className={`availability-text ${listingState(job).toLowerCase()}`} title={job.availabilityReason}>{job.example ? 'Example' : listingState(job) === 'Open' ? `Checked ${timeAgo(job.checkedAt).toLowerCase()}` : listingState(job) === 'Closed' ? 'Closed' : 'Availability unverified'}</small></div></div></td>
            <td className="job-score"><span className={`score ${job.score >= 90 && listingState(job) === 'Open' && job.matchCurrent !== false ? 'high' : ''}`} title={job.matchCurrent === false ? 'Run a search to match this job against your current resume and settings.' : 'Fit to your criteria'}>{listingState(job) === 'Open' && job.matchCurrent !== false ? job.score : '—'}</span></td>
            <td className="job-posted"><span title={job.postedAt ? displayDate(job.postedAt,tz) : 'The source did not provide a posting date.'}>{timeAgo(job.postedAt)}</span></td>
            <td className="job-company-type"><span className={job.companyListing?.status === 'Public' ? 'company-public' : ''}>{job.companyListing?.status ?? 'Unknown'}</span>{job.companyListing?.status === 'Public' && job.companyListing.ticker && <small>{job.companyListing.ticker}</small>}</td>
            <td className="job-headcount" title={data.companyFacts?.[job.id]?.headcount ?? 'No employee count has been confirmed.'}>{employeeCount(data.companyFacts?.[job.id]?.headcount)?.label ?? (data.companyFacts?.[job.id]?.headcount ? 'See details' : data.companyFacts?.[job.id] && !['completed', 'failed', 'cancelled', 'unresolved'].includes(data.companyFacts?.[job.id]?.researchStatus ?? 'completed') ? 'Researching…' : 'Unknown')}</td>
            <td className="job-location"><span className="cell-clamp" title={job.location ?? undefined}>{job.location ?? 'Not listed'}</span>{job.workplace !== 'Unknown' && <small className="cell-clamp" title={job.officeDays ?? undefined}>{job.workplace}{job.officeDays ? ` · ${job.officeDays}` : ''}</small>}</td>
            <td className="job-salary"><span className="cell-clamp" title={job.salary ?? undefined}>{job.salary ?? 'Not listed'}</span></td>
            <td className="job-visa"><span className={job.sponsorship === 'Unknown' ? 'muted' : ''}>{job.sponsorship}</span></td>
            <td className="job-status" data-row-control><Select.Root size="1" value={job.status} onValueChange={(value) => void update(job.id, { status: value as Job['status'] }).catch((error: Error) => setNotice(error.message))}><Select.Trigger variant="ghost" color="gray" aria-label={`Status for ${job.title} at ${job.company}`} /><Select.Content position="popper">{statuses.map((value) => <Select.Item key={value} value={value}>{value}</Select.Item>)}</Select.Content></Select.Root></td>
            <td className="job-save" data-row-control><button className={`icon-button ${job.saved ? 'saved' : ''}`} aria-label={`${job.saved ? 'Unsave' : 'Save'} ${job.title} at ${job.company}`} aria-pressed={job.saved} onClick={() => void update(job.id, { saved: !job.saved }).catch((error: Error) => setNotice(error.message))}><Icon name="bookmark" size={18} filled={job.saved} /></button></td>
          </tr>)}</tbody></table></div>}{filtered.length > limit && <button className="button secondary load-more" onClick={() => setLimit(limit + 100)}>Show more jobs</button>}
        </section>}
      </main>
    </div>
    <WorkspacePanel open={Boolean(panel)} title={panel === 'activity' ? 'Search history' : 'Settings'} onClose={() => void changePanel(null)}>
      {panel !== 'activity' && <div className="panel-tabs"><button className={panel === 'brief' ? 'active' : ''} onClick={() => void changePanel('brief')}>Search settings</button><button className={panel === 'resumes' ? 'active' : ''} onClick={() => void changePanel('resumes')}>Resumes <span>{data.resumes.length}</span></button></div>}
      <div hidden={panel !== 'brief'}><Preferences value={data.preferences} capabilities={data.capabilities} resumes={data.resumes} onSave={() => void refresh()} onResumes={() => setPanel('resumes')} /></div>
      {panel === 'resumes' && <Resumes onRemoved={id=>setData(old=>old ? {...old,resumes:old.resumes.filter(resume=>resume.id!==id),preferences:{...old.preferences,matchingResumeId:old.preferences.matchingResumeId===id ? null : old.preferences.matchingResumeId}} : old)} onRestored={resume=>setData(old=>old ? {...old,resumes:[...old.resumes.filter(item=>item.id!==resume.id),resume]} : old)} leaveRef={resumeLeave} resumes={data.resumes} refresh={() => void refresh()} />}
        {panel === 'activity' && <section className="activity-page route-enter"><p className="muted">Search history, including manual reruns and scheduled searches.</p>{data.runs.length ? data.runs.map((run) => <article key={run.id} className="run-row"><Icon name="clock" /><div><strong>{run.trigger} search</strong><small>{displayDate(run.startedAt, tz)}</small>{runExplanation(run) && <p className={run.error ? 'inline-error' : 'muted'}>{runExplanation(run)}</p>}{runExclusions(run) && <small>{runExclusions(run)}</small>}</div><span>{runOutcome(run)}</span><span className="muted">{runCounts(run)}</span></article>) : <div className="empty-state"><h2>No searches yet</h2><p>Your runs will appear here with their results and status.</p></div>}</section>}
      {panel !== 'activity' && <p className="account-caption">Signed in as {data.account.email}</p>}
      {panel !== 'activity' && <button className="button secondary sign-out" onClick={() => void (async () => { if (resumeLeave.current && !await resumeLeave.current()) return; await post('/logout'); setData(null);setPanel(null);setSelected(null);setLocked(true); })().catch((error: Error) => setNotice(error.message))}>Sign out</button>}
    </WorkspacePanel>
    {selectedJob && <JobDialog key={selectedJob.id} job={selectedJob} resumes={data.resumes} drafts={data.drafts} capabilities={data.capabilities} update={update} refresh={() => void refresh()} close={() => setSelected(null)} />}
    <div className={`notice ${notice ? 'visible' : ''}`} role="status" aria-live="polite">{notice && <><span>{notice}</span><button className="icon-button" aria-label="Dismiss message" onClick={() => setNotice('')}><Icon name="close" size={16} /></button></>}</div>
  </div>;
}
type AuthStatus={passwordAccepted:boolean;googleConfigured:boolean;account:{id:string;email:string;name:string}|null};
function Login({onSuccess,notice}:{onSuccess:()=>void;notice:string}){
  const [status,setStatus]=useState<AuthStatus|null>(null);
  const [password,setPassword]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false);
  useEffect(()=>{void api<AuthStatus>('/auth/status').then(value=>{setStatus(value);if(value.account)onSuccess();}).catch(e=>setError((e as Error).message));},[onSuccess]);
  async function submit(event:FormEvent){event.preventDefault();setBusy(true);setError('');try{await post('/login',{password});setPassword('');setStatus(await api<AuthStatus>('/auth/status'));}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
  async function signIn(){setBusy(true);setError('');try{const {url}=await post<{url:string}>('/auth/google');window.location.assign(url);}catch(e){setError((e as Error).message);setBusy(false);}}
  return <form className="login-form" onSubmit={submit}><h1>Open your workspace</h1><p className="login-hint">Your jobs and resumes stay private to your Google account.</p>
    {!status&&!error?<span className="spinner"/>:status?.passwordAccepted?<>{status.googleConfigured?<button type="button" className="button primary" disabled={busy} onClick={()=>void signIn()}>{busy?'Connecting…':'Continue with Google'}</button>:<p>Google sign-in needs to be configured on the server.</p>}<p className="small muted">Stay signed in on this device for 30 days.</p></>:<><label htmlFor="password">Site password</label><input id="password" type="password" autoComplete="current-password" autoFocus required value={password} onChange={e=>setPassword(e.target.value)}/><button className="button primary" disabled={busy}>{busy?'Checking…':'Continue'}</button></>}
    {(error||notice)&&<p role="alert">{error||notice}</p>}</form>;
}

function WorkspacePanel({ open, title, onClose, children }: { open: boolean; title: string; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { if (open && !ref.current?.open) ref.current?.showModal(); else if (!open && ref.current?.open) ref.current?.close(); }, [open]);
  return <dialog ref={ref} className="workspace-panel" aria-label={title} onCancel={(event) => { event.preventDefault(); onClose(); }}><div className="panel-heading"><h2>{title}</h2><button className="icon-button" aria-label="Close settings panel" onClick={onClose}><Icon name="close" /></button></div>{children}</dialog>;
}
