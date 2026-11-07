const DAY = 86_400_000;

type DatedJob = { postedAt?: string | null; score: number; matchCurrent?: boolean };

function postedAge(postedAt: string | null | undefined, now: number): number | null {
  const time = Date.parse(postedAt ?? '');
  return Number.isFinite(time) && time <= now ? now - time : null;
}

export function withinPostingWindow(postedAt: string | null | undefined, days: number, now = Date.now()): boolean {
  const age = postedAge(postedAt, now);
  return age !== null && age <= days * DAY;
}

export function compareRecentJobs(a: DatedJob, b: DatedJob, windowDays = 7, now = Date.now()): number {
  const tier = (job: DatedJob) => {
    const age = postedAge(job.postedAt, now);
    return age === null ? 3 : age <= DAY ? 0 : age <= windowDays * DAY ? 1 : 2;
  };
  const fit = (job: DatedJob) => job.matchCurrent === false ? -1 : job.score;
  return tier(a) - tier(b) || fit(b) - fit(a)
    || (Date.parse(b.postedAt ?? '') || 0) - (Date.parse(a.postedAt ?? '') || 0);
}
