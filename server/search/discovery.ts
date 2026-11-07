import type { Preferences, Run } from '../../shared/workspace.js';

export type Candidate = { title: string; url: string; publishedDate?: string | null };
export type SearchQuery = { query: string; days: number; agent?: boolean };
export type DiscoveryProgress = { reviewed: number; discovered: number; duplicates: number; searches: number; matched: number; phase: 'Searching' | 'Reviewing' };
export type DiscoveryStop = NonNullable<Run['stopReason']>;

export function canonicalJobUrl(value: string) {
  const url = new URL(value);
  for (const key of [...url.searchParams.keys()]) if (/^(utm_|ref|source|trk)/i.test(key)) url.searchParams.delete(key);
  url.hash = '';
  return url.href.replace(/\/$/, '');
}

export function discoveryPlan(config: Preferences, skills: string[]): SearchQuery[] {
  const context = `${config.softRequirements} Sources: ${config.sources.join(', ')}.`;
  const broad = `${config.prompt} ${context}`;
  const recent = `Posted in the past ${config.maxPostingAgeDays} days.`;
  const roles = config.prompt.replace(/^(?:find|search for|look for)\s+/i, '').split(/[.;\n]/)[0]!
    .split(/,|\s+(?:or|and)\s+/i).map(value => value.trim())
    .filter(value => value.length >= 3 && value.length <= 120 && !/^(?:closely|anything|related|adjacent)/i.test(value)).slice(0, 8);
  const plan: SearchQuery[] = [
    {query:'Build a distinct job list across sources',days:config.maxPostingAgeDays,agent:true},
    { query: `Posted in the past 24 hours. ${broad} ${skills.length ? `Relevant skills: ${skills.join(', ')}.` : ''}`, days: 1 },
    ...(config.preferPublicCompanies ? [{ query: `Publicly traded employers, posted in the past 24 hours. ${broad}`, days: 1 }] : []),
    ...(config.maxPostingAgeDays > 1 ? [{ query: `${recent} ${broad}`, days: config.maxPostingAgeDays }] : []),
    ...(config.preferPublicCompanies && config.maxPostingAgeDays > 1 ? [{ query: `${recent} Publicly traded employers. ${broad}`, days: config.maxPostingAgeDays }] : []),
    ...roles.map(role => ({ query: `${recent} ${role} job openings. ${context}`, days: config.maxPostingAgeDays })),
    ...config.sources.map(source => ({ query: `${recent} ${source} job postings. ${config.prompt} ${config.softRequirements}`, days: config.maxPostingAgeDays })),
  ];
  return [...new Map(plan.map(item => [item.query, item])).values()];
}

/** Continue discovery after a sparse first response; never count duplicates or rejected jobs toward the target. */
export async function discoverUntilTarget<T>(options: {
  target: number; maxReviewed: number; plan: SearchQuery[]; initial?: Candidate[]; retained?: {candidate:Candidate;match:T}[];
  key: (candidate: Candidate) => string | null;
  search: (query: SearchQuery, count: number) => Promise<Candidate[]>;
  review: (candidate: Candidate) => Promise<T | null>;
  sameMatch?: (a:T,b:T) => boolean;
  mergeMatches?: (copies:T[]) => T;
  progress: (progress: DiscoveryProgress, matches: readonly T[]) => Promise<void>;
}) {
  const matches: T[] = [];
  const queue: Candidate[] = [];
  const seen = new Set<string>();
  const stats: DiscoveryProgress = { reviewed: 0, discovered: 0, duplicates: 0, searches: 0, matched: 0, phase: 'Searching' };
  const accept = (match:T) => {
    const duplicate = options.sameMatch ? matches.findIndex(existing => options.sameMatch!(existing,match)) : -1;
    if (duplicate < 0) matches.push(match);
    else { stats.duplicates++; if(options.mergeMatches)matches[duplicate]=options.mergeMatches([matches[duplicate]!,match]); }
    stats.matched=Math.min(options.target,matches.length);
  };
  for(const item of options.retained ?? []) {
    const key=options.key(item.candidate);
    if(!key || seen.has(key)) continue;
    seen.add(key);accept(item.match);stats.reviewed++;stats.discovered++;
  }
  const add = (candidates: Candidate[]) => {
    for (const candidate of candidates) {
      const key = options.key(candidate);
      if (!key) continue;
      if (seen.has(key)) { stats.duplicates++; continue; }
      seen.add(key); queue.push(candidate); stats.discovered++;
    }
  };
  let fallbackAdded = false;
  let nextQuery = 0;
  let stopReason: DiscoveryStop = 'searches_exhausted';
  let error: unknown;
  while (true) {
    if (matches.length >= options.target) { stopReason = 'target_reached'; break; }
    if (stats.reviewed >= options.maxReviewed) { stopReason = 'review_limit'; break; }
    if (!queue.length) {
      if (nextQuery >= options.plan.length) {
        if (!fallbackAdded) { fallbackAdded=true; add(options.initial ?? []); if(queue.length)continue; }
        break;
      }
      stats.phase = 'Searching'; stats.searches++;
      await options.progress({ ...stats },matches);
      try { add(await options.search(options.plan[nextQuery++]!, Math.min(60, Math.max(30, (options.target - matches.length) * 3)))); }
      catch (cause) { error = cause; stopReason = 'provider_error'; break; }
      continue;
    }
    stats.phase = 'Reviewing';
    await options.progress({ ...stats },matches);
    const batch = queue.splice(0, Math.min(3, options.maxReviewed - stats.reviewed));
    const results = await Promise.allSettled(batch.map(options.review));
    for (const result of results) {
      if (result.status === 'fulfilled') {
        stats.reviewed++;
        if (result.value !== null) accept(result.value);
      } else { error ??= result.reason; }
    }
    stats.matched = Math.min(options.target, matches.length);
    await options.progress({ ...stats },matches);
    if (error) { stopReason = 'provider_error'; break; }
  }
  return { matches, stats, stopReason, error };
}
