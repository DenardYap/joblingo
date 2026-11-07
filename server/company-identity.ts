import { hasNamedEmployer, unidentifiedEmployerNotice, unidentifiedListing } from '../shared/company-identity.js';
import { preferenceScore, type Job } from '../shared/workspace.js';
import { get, list, patch, preferences, put, putIfMissing } from './store.js';
import type { Research } from './research.js';

// Repair earlier guesses without touching bookmarks, application status, notes,
// resumes, or the source job. Preserve rejected research separately for audit.
export async function repairUnidentifiedEmployers(): Promise<void> {
  const jobs = (await list<Job>('jobs')).filter(job => !job.example && !hasNamedEmployer(job.company));
  if (!jobs.length) return;
  const config = await preferences();
  for (const job of jobs) {
    const record = await get<Research>('research', job.id);
    const cleanListing = job.companyListing?.status === 'Unknown' && !job.companyListing.ticker && !job.companyListing.exchange && !job.companyListing.sourceUrl;
    if (record?.status === 'unresolved' && !record.data && cleanListing && !job.publicCompanyBonus && !job.companyLogoUrl && !job.companyWebsite) continue;
    if (record?.data || record?.listing?.status === 'Public') await putIfMissing('research-identity-review', job.id, record);
    const listing = unidentifiedListing();
    const base = job.baseScore ?? Math.max(0, job.score - (job.publicCompanyBonus ?? 0));
    await patch('jobs', job.id, {
      companyListing: listing, companyLogoUrl: null, companyWebsite: null,
      ...preferenceScore(base, config.preferPublicCompanies, listing), baseScore: base,
      strengths: job.strengths.filter(value => !/^Publicly traded employer:/i.test(value)),
    });
    await put('research', job.id, {
      id: '', jobId: job.id, status: 'unresolved', createdAt: record?.createdAt ?? listing.checkedAt,
      listing, identityNotice: unidentifiedEmployerNotice,
    } satisfies Research);
  }
}
