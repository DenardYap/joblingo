import { createHash, randomUUID } from 'node:crypto';
import { preferenceScore, type Job, type Run } from '../../shared/workspace.js';
import { claim, finishRun, get, list, patch, preferences, put, release, renew } from '../store.js';
import { aiReady, safeUrl, searchWeb } from '../ai.js';
import { safeError } from '../errors.js';
import { checkListing, verifyJob } from '../availability.js';
import { LOGO_VERSION } from '../company-logo.js';
import { companyListing } from '../company-listing.js';
import { hasNamedEmployer } from '../../shared/company-identity.js';
import { compareRecentJobs, withinPostingWindow } from '../../shared/job-recency.js';
import { assessJob, calculateScore, matchingFingerprint, matchingResume, resumeSearchTerms } from './matching.js';
import { canonicalJobUrl, discoveryPlan, discoverUntilTarget } from './discovery.js';
import { deduplicateJobs, mergeJobCopies, sameJob } from '../../shared/job-deduplication.js';
import { discoverWithAgent } from './agent-discovery.js';

export function searchReady() { return aiReady() && Boolean(process.env.EXA_API_KEY); }
export function localClock(date: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(date);
  const p = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return { day: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}` };
}
function source(value: string) { const host = new URL(value).hostname; return host.includes('linkedin.') ? 'LinkedIn' : host.includes('indeed.') ? 'Indeed' : host.includes('glassdoor.') ? 'Glassdoor' : 'Company sites'; }
export async function startRun(trigger: Run['trigger'], background = true): Promise<Run | null> {
  if (!searchReady()) throw new Error('Live search needs EXA_API_KEY, OPENAI_API_KEY, and OPENAI_MODEL on the server.');
  const config = await preferences();
  const clock = localClock(new Date(), config.timezone);
  if (trigger === 'Scheduled' && (!config.enabled || clock.time < config.localTime)) return null;
  const id = randomUUID();
  if (!await claim(id)) throw new Error('A search is already running.');
  const heartbeat = setInterval(() => { void renew(id).catch(() => {}); }, 30000);
  try {
    const runs = await list<Run>('runs');
    const previous = runs.filter((r) => r.scheduledKey === clock.day).sort((a, b) => b.startedAt.localeCompare(a.startedAt))[0];
    if (trigger === 'Scheduled' && previous && (previous.status === 'Completed' || previous.attempt >= 3)) { clearInterval(heartbeat); await release(id); return null; }
    for (const run of runs.filter((r) => r.status === 'Running')) await patch('runs', run.id, { status: 'Failed', completedAt: new Date().toISOString(), error: 'Search was interrupted. Run again to retry.' });
    const run: Run = { id, trigger, startedAt: new Date().toISOString(), completedAt: null, status: 'Running', found: 0, reviewed: 0, excluded: 0, error: null, scheduledKey: trigger === 'Scheduled' ? clock.day : null, attempt: trigger === 'Scheduled' ? (previous?.attempt ?? 0) + 1 : 1,
      target: config.topCount, postingWindowDays: config.maxPostingAgeDays, discovered: 0, duplicates: 0, searches: 0, phase: 'Preparing' };
    await put('runs', id, run);
    const execute = async () => {
      try {
        const resume = await matchingResume(config);
        const searchTerms = await resumeSearchTerms(resume,config.prompt,config.candidateBackground);
        // Recheck previous results too: omission from a new search is not evidence
        // that an old role is still open. Closed jobs retain their tracking history.
        const previousJobs = (await list<Job>('jobs')).filter((job) => !job.example && job.availability !== 'Closed').sort((a,b) => b.lastFoundAt.localeCompare(a.lastFoundAt)).slice(0,50);
        for (let offset=0; offset<previousJobs.length; offset+=3) {
          const verified = await Promise.all(previousJobs.slice(offset,offset+3).map(verifyJob));
          previousJobs.splice(offset, verified.length, ...verified);
        }
        const searchTime = Date.now();
        const publicationWindow = (days: number) => ({ startPublishedDate: new Date(searchTime - days * 86400000).toISOString(), endPublishedDate: new Date(searchTime).toISOString() });
        const publicPreference=config.preferPublicCompanies ? 'Prioritize publicly traded employers as a soft preference; private companies remain eligible.' : '';
        const objective=`Find distinct candidate postings toward ${config.topCount} qualifying job matches. Prefer the past 24 hours; the past ${config.maxPostingAgeDays} days is the maximum window. ${publicPreference} Prioritize direct employer postings and individual listings from ${config.sources.join(', ')}. Exclude aggregate pages, closed roles and older postings. Use original posting dates, never crawl or update dates. Requirements: ${config.hardRequirements}`;
        // Refresh older saved matches only after fresh discovery has had its turn,
        // so a changed resume cannot fill the whole quota with existing history.
        const fingerprint = matchingFingerprint(config, resume);
        const stale = previousJobs.filter((job) => job.url && withinPostingWindow(job.postedAt,config.maxPostingAgeDays,searchTime) && job.matchContext?.profileFingerprint !== fingerprint)
          .map((job) => ({title:job.title,url:job.url!}));
        const latest=[...runs].sort((a,b)=>b.startedAt.localeCompare(a.startedAt))[0];
        const sameDayAttempt=latest && latest.status!=='Running' && latest.found>0 && localClock(new Date(latest.startedAt),config.timezone).day===clock.day;
        const retained=sameDayAttempt ? deduplicateJobs(previousJobs.filter(job=>job.url && config.sources.includes(source(job.url) as typeof config.sources[number]) && job.availability==='Open' && job.eligible && job.sponsorship!=='No' && withinPostingWindow(job.postedAt,config.maxPostingAgeDays,searchTime) && job.matchContext?.profileFingerprint===fingerprint)
          .map(job=>({...job,...preferenceScore(job.baseScore??job.score,config.preferPublicCompanies,job.companyListing)})).filter(job=>job.score>=config.minScore)).sort((a,b)=>compareRecentJobs(a,b,config.maxPostingAgeDays,searchTime)).slice(0,config.topCount-1) : [];
        await patch('runs',id,{retained:retained.length});
        const assessed: Job[] = [];
        const exclusions: NonNullable<Run['exclusions']> = { unavailable: 0, postingAge: 0, unknownDate: 0, requirements: 0, belowScore: 0, unreadable: 0 };
        const excludedCount = () => Object.values(exclusions).reduce((total,count) => total + count, 0);
        const discovery = await discoverUntilTarget<Job>({
          target: config.topCount, maxReviewed: Math.min(600,Math.max(150,config.topCount*12)),
          sameMatch: sameJob, mergeMatches: mergeJobCopies,
          initial: stale, retained:retained.map(job=>({candidate:{title:job.title,url:job.url!},match:job})), plan: discoveryPlan(config,searchTerms),
          key: candidate => safeUrl(candidate.url) && config.sources.includes(source(candidate.url) as typeof config.sources[number]) ? canonicalJobUrl(candidate.url) : null,
          search: async (query,count) => {
            if(!query.agent)return searchWeb(query.query,count,objective.slice(0,4096),publicationWindow(query.days));
            try { return await discoverWithAgent(id,config,retained); }
            catch(error) { await patch('discovery-agents',id,{error:safeError(error)});return []; }
          },
          progress: async ({matched:_matched,...stats},matches) => {
            if (!await renew(id)) throw new Error('Search was interrupted. Run again to retry.');
            const shortlist=[...matches].sort((a,b)=>compareRecentJobs(a,b,config.maxPostingAgeDays,searchTime)).slice(0,config.topCount);
            await finishRun(id,shortlist,{...stats,status:'Running',found:shortlist.length,excluded:excludedCount(),exclusions});
          },
          review: async candidate => {
            const check = await checkListing(candidate.url, candidate.title || undefined);
            if (check.availability !== 'Open') { exclusions.unavailable++; return null; }
            // The employer's date is authoritative; Exa index/crawl dates alone
            // cannot qualify an old or undated listing for a recent shortlist.
            if (!check.postedAt) { exclusions.unknownDate++; return null; }
            if (!withinPostingWindow(check.postedAt,config.maxPostingAgeDays,searchTime)) { exclusions.postingAge++; return null; }
            if (!check.text.trim()) { exclusions.unreadable++; return null; }
            const assessment = await assessJob(config,resume,{...candidate,text:check.text});
            const {components:_components,...parsed}=assessment;
            const normalize = (text: string) => text.toLowerCase().replace(/\s+/g, ' ').trim();
            const evidenceVerified = parsed.sponsorshipEvidence && normalize(check.text).includes(normalize(parsed.sponsorshipEvidence));
            if (!evidenceVerified && parsed.sponsorship === 'Yes') { parsed.sponsorship = 'Unknown'; parsed.sponsorshipEvidence = null; parsed.gaps.push('Confirm visa sponsorship with the recruiter.'); }
            if (!parsed.isJob || !parsed.open || !parsed.eligible || parsed.sponsorship === 'No') { exclusions.requirements++; return null; }
            const url = canonicalJobUrl(candidate.url);
            const jobId = createHash('sha256').update(url).digest('hex').slice(0, 24);
            const existing = await get<Job>('jobs', jobId);
            const now = new Date().toISOString();
            const {text:_text,...verification}=check;
            const companyLogoUrl=hasNamedEmployer(parsed.company) && existing?.companyLogoVersion===LOGO_VERSION && existing.company===parsed.company ? existing.companyLogoUrl ?? null : null;
            const listing=await companyListing(parsed.company,url);
            const scoring=calculateScore(assessment,config,resume,listing);
            if(scoring.publicCompanyBonus) parsed.strengths.push(`Publicly traded employer: ${listing.exchange}: ${listing.ticker}.`);
            const job: Job = { ...parsed, ...verification, companyLogoUrl, companyLogoVersion:LOGO_VERSION, companyListing:listing, ...scoring, id: jobId, url, source: source(url), foundAt: existing?.foundAt ?? now, lastFoundAt: now, foundOn: [...(existing?.foundOn ?? []), now].slice(-366), example: false, saved: false, status: 'Not started', notes: '', appliedAt: null };
            assessed.push(job);
            if (job.score < config.minScore) { exclusions.belowScore++; return null; }
            return job;
          },
        });
        const selected = discovery.matches.sort((a, b) => compareRecentJobs(a,b,config.maxPostingAgeDays,searchTime)).slice(0, config.topCount);
        // Keep fresh assessments for previously saved results even if they fall
        // outside today's shortlist. Their discovery dates and tracking survive.
        const selectedIds = new Set(selected.map(job => job.id));
        const previousIds = new Set(previousJobs.map(job => job.id));
        const refreshed = assessed.filter(job => previousIds.has(job.id) && !selectedIds.has(job.id));
        const {matched:_matched,...stats} = discovery.stats;
        await finishRun(id, selected, { ...stats, status: discovery.error ? 'Failed' : 'Completed', completedAt: new Date().toISOString(), found: selected.length,
          excluded: excludedCount() + discovery.matches.length - selected.length, exclusions, stopReason: discovery.stopReason, error: discovery.error ? safeError(discovery.error) : null }, refreshed);
      } catch (error) {
        await patch('runs', id, { status: 'Failed', completedAt: new Date().toISOString(), error: safeError(error) });
      } finally { clearInterval(heartbeat); await release(id); }
    };
    if (background) void execute().catch(() => console.error('Could not persist search completion.'));
    else await execute();
    return background ? run : await get<Run>('runs', id);
  } catch (error) { clearInterval(heartbeat); await release(id); throw error; }
}
