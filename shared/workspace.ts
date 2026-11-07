import { z } from 'zod';
import { searchBriefSchema } from './contracts';

export const statuses = ['Not started', 'Applied', 'Pending', 'Interviewing', 'Offer', 'Rejected', 'Withdrawn'] as const;
export const preferencesSchema = searchBriefSchema.extend({
  hardRequirements: z.string().max(4000), softRequirements: z.string().max(4000),
  minScore: z.number().int().min(0).max(100), enabled: z.boolean(),
  preferPublicCompanies: z.boolean().default(true),
  maxPostingAgeDays: z.union([z.literal(1), z.literal(7), z.literal(30)]).default(7),
  matchingResumeId: z.string().nullable().default(null),
  candidateBackground: z.string().max(12000).default(''),
  sources: z.array(z.enum(['LinkedIn', 'Indeed', 'Glassdoor', 'Company sites'])).min(1),
});
export type Preferences = z.infer<typeof preferencesSchema>;
export const defaultPreferences: Preferences = {
  prompt: 'Find Senior Revenue Accountant, Senior Accountant, Accountant, Revenue Accountant, Technical Accountant, and closely related accounting roles.',
  hardRequirements: 'Exclude a role if the posting explicitly says the employer does not sponsor visas. Unknown sponsorship is acceptable, but flag it for follow-up.',
  softRequirements: 'Prefer 3–5 years of experience. Prefer San Francisco, then the Bay Area from San Francisco to San Jose. Prioritize technology companies in hardware or software.',
  topCount: 30, minScore: 65, localTime: '08:00', timezone: 'America/Los_Angeles', enabled: false,
  preferPublicCompanies: true,
  maxPostingAgeDays: 7,
  matchingResumeId: null,
  candidateBackground: '',
  sources: ['LinkedIn', 'Indeed', 'Glassdoor', 'Company sites'],
};
export const extractionSchema = z.object({
  isJob: z.boolean(), open: z.boolean(), title: z.string(), company: z.string(),
  location: z.string().nullable(), workplace: z.enum(['Remote', 'Hybrid', 'On-site', 'Unknown']),
  salary: z.string().nullable(), officeDays: z.string().nullable(), experience: z.string().nullable(),
  sponsorship: z.enum(['Yes', 'No', 'Unknown']), sponsorshipEvidence: z.string().nullable(),
  score: z.number().min(0).max(100), eligible: z.boolean(), reason: z.string(),
  strengths: z.array(z.string()), gaps: z.array(z.string()),
  requirements: z.array(z.object({ requirement: z.string(), result: z.enum(['Met', 'Not met', 'Unknown']), evidence: z.string() })),
  description: z.string(), postedAt: z.string().nullable(),
});
export type ExtractedJob = z.infer<typeof extractionSchema>;
export type CompanyListing = {status:'Public'|'Private'|'Unknown';exchange:string|null;ticker:string|null;evidence:string|null;sourceUrl:string|null;checkedAt:string};
export type Job = ExtractedJob & {
  id: string; source: string; url: string | null; foundAt: string; lastFoundAt: string; foundOn: string[];
  saved: boolean; status: typeof statuses[number]; notes: string; appliedAt: string | null; example: boolean;
  trackingUpdatedAt?: string; relatedJobIds?: string[]; listings?: {id:string;url:string;source:string}[];
  applicationIdentity?: {board:string;id:string};
  availability?: 'Open' | 'Closed' | 'Unverified'; availabilityReason?: string; checkedAt?: string;
  companyLogoUrl?: string | null; companyLogoVersion?: string; companyWebsite?: string | null; postedAtSource?: string | null;
  companyListing?: CompanyListing; publicCompanyBonus?: number; baseScore?: number; publicPreferenceApplied?: boolean;
  scoreBreakdown?: { key: string; label: string; points: number; maxPoints: number; reason: string }[];
  matchCurrent?: boolean;
  matchContext?: { resumeId: string | null; resumeName: string | null; assessedAt: string; version: number; resumeRevision?: number | null; backgroundUsed?: boolean; profileFingerprint?: string };
};
export function preferenceScore(baseScore:number, preferPublic:boolean, listing?:CompanyListing) {
  const base=Math.max(0,Math.min(100,baseScore));
  const verified=listing?.status==='Public' && Boolean(listing.sourceUrl && listing.exchange && listing.ticker) && Date.now()-Date.parse(listing.checkedAt)<7*86400000;
  const bonus=preferPublic && verified ? 5 : 0;
  return {score:Math.round(base*(preferPublic ? 0.95 : 1))+bonus,publicCompanyBonus:bonus,publicPreferenceApplied:preferPublic};
}
export function listingState(job: Job): 'Open' | 'Closed' | 'Unverified' {
  if (job.example) return 'Open';
  if (job.availability === 'Closed') return 'Closed';
  return job.availability === 'Open' && job.checkedAt && Date.now() - Date.parse(job.checkedAt) < 86400000 ? 'Open' : 'Unverified';
}
export type Run = { id: string; startedAt: string; completedAt: string | null; status: 'Running' | 'Completed' | 'Failed'; trigger: 'Manual' | 'Scheduled'; found: number; reviewed: number; excluded: number; error: string | null; scheduledKey: string | null; attempt: number;
  target?: number; postingWindowDays?: number; discovered?: number; duplicates?: number; searches?: number; retained?: number;
  matchedJobIds?: string[];
  phase?: 'Preparing' | 'Searching' | 'Reviewing'; stopReason?: 'target_reached' | 'searches_exhausted' | 'review_limit' | 'provider_error' | 'deduplicated';
  exclusions?: { unavailable: number; postingAge: number; unknownDate: number; requirements: number; belowScore: number; unreadable: number };
};
export type Resume = { id: string; name: string; text: string; createdAt: string; originalText?: string; originalName?: string; templateAvailable?: boolean; revision?: number; updatedAt?: string };
export type Draft = { format?: 'original-docx'|'original-pdf'; blocks?: {id:string;label:string;text:string}[]; revision?: number; id: string; jobId: string; resumeId: string; text: string; changes: string[]; warnings: string[]; createdAt: string; googleUrl?: string | null; googleLayoutVersion?:number; resumeRevision?: number; backgroundUsed?: boolean };
export type Person = { title: string; url: string; excerpt: string };
export type Company = { summary: string; industry: string | null; headcount: string | null; revenue: string | null; funding: string | null; sources: { title: string; url: string }[]; checkedAt: string };
export type Capabilities = { search: boolean; ai: boolean; missing: string[]; googleConfigured: boolean; googleConnected: boolean; storage: string };
export type CompanyFacts = { headcount: string | null; researchStatus: string };
export type Workspace = { account:{id:string;email:string;name:string}; preferences: Preferences; jobs: Job[]; companyFacts: Record<string, CompanyFacts>; resumes: Resume[]; runs: Run[]; drafts: Draft[]; capabilities: Capabilities };
export const jobPatchSchema = z.object({ saved: z.boolean().optional(), status: z.enum(statuses).optional(), notes: z.string().max(10000).optional(), appliedAt: z.string().nullable().optional() }).strict();
