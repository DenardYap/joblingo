import { deduplicateJobs } from '../shared/job-deduplication.js';
import type { Job } from '../shared/workspace.js';
import { database, list } from './store.js';
import { workspaceId } from './workspace-context.js';

export async function groupedJob(id: string) {
  return deduplicateJobs(await list<Job>('jobs')).find(job => job.id === id || job.relatedJobIds?.includes(id)) ?? null;
}
export async function updateJobTracking(id: string, changes: Pick<Partial<Job>,'saved'|'status'|'notes'|'appliedAt'>) {
  const job = await groupedJob(id);
  if (!job) return null;
  const tracking = { saved: job.saved, status: job.status, notes: job.notes, appliedAt: job.appliedAt, ...changes, trackingUpdatedAt: new Date().toISOString() };
  // One workspace-scoped statement keeps every copy consistent, including undo
  // actions such as unbookmarking or returning an application to Not started.
  await (await database()).query("UPDATE workspace_records SET data=data || $3::jsonb WHERE workspace_id=$1 AND kind='jobs' AND id=ANY($2::text[])", [workspaceId(),job.relatedJobIds ?? [job.id],JSON.stringify(tracking)]);
  return { ...job, ...tracking };
}
