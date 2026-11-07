import type { Run } from './workspace.js';

export const runCounts = (run: Run) => `${run.found}${run.target ? ` of ${run.target}` : ''} matches · ${run.reviewed} reviewed`;
export function runOutcome(run: Run) {
  if (run.status === 'Failed') return 'Interrupted';
  if (run.status === 'Running') return run.phase ?? 'Searching';
  return run.target && run.found < run.target ? 'Partial results' : 'Completed';
}
export function runExplanation(run: Run) {
  if (run.error) return run.error;
  if (run.status === 'Failed') return 'Search interrupted. Verified matches have been saved.';
  if (run.status !== 'Completed' || !run.target || run.found >= run.target) return '';
  if (run.stopReason === 'review_limit') return 'The review limit was reached before enough jobs qualified.';
  return `Finished ${run.searches ?? 0} searches without enough qualifying postings${run.postingWindowDays ? ` in the ${run.postingWindowDays}-day window` : ''}.`;
}
export function runNotice(run: Run) {
  return `${runCounts(run)}. ${runExplanation(run) || (run.status === 'Completed' ? 'Search complete.' : 'Search is running.')}`;
}
export function runExclusions(run: Run) {
  if (!run.exclusions) return '';
  const labels: Record<keyof NonNullable<Run['exclusions']>, string> = {
    unavailable: 'closed or unverified', postingAge: 'outside posting window', unknownDate: 'no verified posting date',
    requirements: 'did not meet requirements', belowScore: 'below minimum fit', unreadable: 'unreadable',
  };
  return Object.entries(run.exclusions).filter(([,count]) => count > 0)
    .map(([key,count]) => `${count} ${labels[key as keyof typeof labels]}`).join(' · ');
}
