import { hasNamedEmployer, normalizedEmployerName } from './company-identity.js';
import type { Job } from './workspace.js';

const words = (value: string) => value.toLowerCase().normalize('NFKC').replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ');
function role(job: Job) {
  return words(job.title.replace(/\bSr\.?\s/gi, 'Senior ').replace(/\bJr\.?\s/gi, 'Junior ')
    .replace(/\(([^)]*)\)/g, (whole,content:string) => words(content).split(' ').every(token => ['us','usa','united','states','remote','hybrid','on','site'].includes(token)) ? '' : whole)
    .replace(/\s*[-–|,]\s*(?:(?:usa?|united states)\s*[-–,]?\s*)?(?:remote|hybrid|on[ -]site)\s*$/i, ''));
}
function location(job: Job) {
  if (!job.location?.trim()) return '';
  const places = job.location.toLowerCase().replace(/united states(?: of america)?|\bu\.?s\.?a?\.?\b/g, 'us')
    .replace(/california/g, 'ca').replace(/\bremote\b/g, '').split(/;|\s+\/\s+/)
    .map(place => words(place).replace(/\s+us$/, '').trim())
    .map(place => job.workplace === 'Remote' && /^san francisco(?: bay area)?(?: ca)?$/.test(place) ? 'san francisco bay area ca' : place)
    .filter(Boolean);
  return [...new Set(places)].sort().join('|');
}
// Recognize the original ATS requisition, including a job board's redirect URL.
export function applicationIdentity(value: string | null | undefined): {board:string;id:string} | null {
  if (!value) return null;
  try {
    let url = new URL(value);
    for(let depth=0;depth<2;depth++) {
      const destination=['to','url','redirect','redirect_url'].map(key=>url.searchParams.get(key)).find(item=>item?.startsWith('https://'));
      if(!destination)break;url=new URL(destination);
    }
    if(url.protocol!=='https:')return null;
    const host=url.hostname;const tenant=url.pathname.split('/').filter(Boolean)[0] ?? '';
    const match = /(?:^|\.)greenhouse\.io$/.test(host) ? url.pathname.match(/\/(?:jobs|job)\/(\d+)/) :
      /(?:^|\.)(?:lever\.co|ashbyhq\.com)$/.test(host) ? url.pathname.match(/^\/[^/]+\/([a-f0-9-]{36})/) :
      /(?:^|\.)myworkdayjobs\.com$/.test(host) ? url.pathname.match(/_((?:JR|R)[\w-]+)(?:\/apply)?$/i) :
      /(?:^|\.)smartrecruiters\.com$/.test(host) ? url.pathname.match(/^\/[^/]+\/(\d+)-/) : null;
    return match ? {board:`${host.replace(/^boards\./,'job-boards.')}/${/myworkdayjobs\.com$/.test(host)?'':tenant.toLowerCase()}`,id:match[1]!.toLowerCase()} : null;
  } catch { return null; }
}
export function sameJob(a: Job, b: Job): boolean {
  if (a.id === b.id || (a.url && a.url === b.url)) return true;
  const first = a.applicationIdentity ?? applicationIdentity(a.url), second = b.applicationIdentity ?? applicationIdentity(b.url);
  if(first && second && first.board===second.board)return first.id===second.id;
  if (a.example || b.example || !hasNamedEmployer(a.company) || !hasNamedEmployer(b.company)) return false;
  if (normalizedEmployerName(a.company) !== normalizedEmployerName(b.company) || role(a) !== role(b)) return false;
  const place = location(a);
  if (!place || place !== location(b)) return false;
  if (a.workplace !== 'Unknown' && b.workplace !== 'Unknown' && a.workplace !== b.workplace) return false;
  // Do not fold a later hiring cycle into a months-old role with the same title.
  const dates = [Date.parse(a.postedAt ?? ''), Date.parse(b.postedAt ?? '')];
  return !dates.every(Number.isFinite) || Math.abs(dates[0]! - dates[1]!) <= 45 * 86400000;
}
function sourcePriority(job: Job) {
  if (!job.url) return 0;
  let host:string; try { host=new URL(job.url).hostname; } catch { return 0; }
  if (/(?:^|\.)(?:greenhouse\.io|lever\.co|ashbyhq\.com|myworkdayjobs\.com|smartrecruiters\.com)$/.test(host)) return 3;
  try { if (job.companyWebsite && host.replace(/^www\./, '') === new URL(job.companyWebsite).hostname.replace(/^www\./, '')) return 3; } catch { /* No verified website. */ }
  return /^(?:careers|jobs)\./.test(host) ? 2 : job.source === 'Company sites' ? 0 : 1;
}
export function mergeJobCopies(copies: Job[]): Job {
  const ordered = [...copies].sort((a,b) => Number(b.availability === 'Open') - Number(a.availability === 'Open') || sourcePriority(b) - sourcePriority(a) || Number(a.matchCurrent === false) - Number(b.matchCurrent === false) || (b.matchContext?.assessedAt ?? '').localeCompare(a.matchContext?.assessedAt ?? '') || a.foundAt.localeCompare(b.foundAt) || a.id.localeCompare(b.id));
  const primary = ordered[0]!;
  const logo = primary.companyLogoVersion ? ordered.find(job => normalizedEmployerName(job.company) === normalizedEmployerName(primary.company) && job.companyLogoVersion === primary.companyLogoVersion && job.companyLogoUrl) : undefined;
  const tracked = [...copies].filter(job => job.trackingUpdatedAt).sort((a,b) => b.trackingUpdatedAt!.localeCompare(a.trackingUpdatedAt!))[0];
  const statusOrder: Job['status'][] = ['Not started', 'Applied', 'Pending', 'Interviewing', 'Withdrawn', 'Rejected', 'Offer'];
  const status = tracked?.status ?? [...copies].sort((a,b) => statusOrder.indexOf(b.status) - statusOrder.indexOf(a.status))[0]!.status;
  const relatedJobIds = [...new Set(copies.flatMap(job => [job.id, ...(job.relatedJobIds ?? [])]))].sort();
  const listings = [...new Map(copies.flatMap(job => [...(job.listings ?? []), ...(job.url ? [{id:job.id,url:job.url,source:job.source}] : [])]).map(item => [item.url,item])).values()];
  const posted = copies.map(job => job.postedAt).filter((value): value is string => Boolean(value && Number.isFinite(Date.parse(value)))).sort();
  return { ...primary, applicationIdentity: primary.applicationIdentity ?? applicationIdentity(primary.url) ?? ordered.find(job=>job.applicationIdentity)?.applicationIdentity, companyLogoUrl: logo?.companyLogoUrl ?? primary.companyLogoUrl, relatedJobIds, listings, status,
    saved: tracked?.saved ?? copies.some(job => job.saved),
    notes: tracked?.notes ?? [...new Set(copies.map(job => job.notes.trim()).filter(Boolean))].join('\n\n'),
    appliedAt: copies.map(job => job.appliedAt).filter((value): value is string => Boolean(value)).sort()[0] ?? null,
    trackingUpdatedAt: tracked?.trackingUpdatedAt,
    foundAt: copies.map(job => job.foundAt).sort()[0]!,
    lastFoundAt: copies.map(job => job.lastFoundAt).sort().at(-1)!,
    foundOn: [...new Set(copies.flatMap(job => job.foundOn))].sort(),
    // Reposts must not make the same opening look newly posted.
    postedAt: posted[0] ?? primary.postedAt,
  };
}
/** A non-destructive view: raw listings, research and draft references stay intact. */
export function deduplicateJobs(jobs: Job[]): Job[] {
  const groups: Job[][] = [];
  for (const job of [...jobs].sort((a,b) => a.foundAt.localeCompare(b.foundAt) || a.id.localeCompare(b.id))) {
    const group = groups.find(copies => copies.every(copy => sameJob(copy,job)));
    if (group) group.push(job); else groups.push([job]);
  }
  return groups.map(mergeJobCopies);
}
