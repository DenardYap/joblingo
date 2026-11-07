import { z } from 'zod';

export const authorizationRestrictionSchema = z.object({
  kind: z.enum(['Citizenship', 'Export control', 'Security clearance']),
  evidence: z.string().min(5).max(2000),
});
export type AuthorizationRestriction = z.infer<typeof authorizationRestrictionSchema>;
const normalize = (text: string) => text.toLowerCase().replace(/\s+/g, ' ').trim();
const country = '(?:U\\.?\\s*S\\.?|United States)';
const status = `${country}[ -]*(?:citizen(?:ship|s)?|nationals?|persons?|(?:lawful[, ]*)?permanent residents?)|green[ -]card holders?`;
const patterns = [
  new RegExp(`\\b(?:must|shall|need to)\\s+(?:be|have|hold|possess)\\b.{0,110}?(?:${status})\\b`, 'gi'),
  new RegExp(`\\b(?:requires?|requiring|restricted to|limited to|only)\\s+(?:an?\\s+)?(?:${status})\\b`, 'gi'),
  new RegExp(`\\b(?:${status})\\b.{0,50}?\\b(?:required|mandatory|only)\\b`, 'gi'),
  /\b(?:must|shall|required to|ability to)\s+(?:be able to\s+)?(?:obtain|maintain|hold|possess|have)\b.{0,80}?\b(?:security clearance|(?:secret|top secret|TS\/SCI) clearance)\b/gi,
  /\b(?:active|current|required)\s+(?:(?:secret|top secret|TS\/SCI)\s+)?security clearance\b|\bsecurity clearance\s+(?:is\s+)?required\b/gi,
];

/** Detect explicit posting conditions, never infer the applicant's citizenship. */
export function detectAuthorizationRestrictions(raw: string): AuthorizationRestriction[] {
  const text = raw.replace(/\s+/g, ' ').trim();
  const restrictions: AuthorizationRestriction[] = [];
  for (const pattern of patterns) for (const match of text.matchAll(pattern)) {
    if (/\b(?:not required|not mandatory|no requirement|without regard)\b/i.test(match[0])) continue;
    if (/[.!?]\s+/.test(match[0].replace(/\bU\.S\./gi,'US'))) continue;
    const index = match.index!;
    const before = text.slice(Math.max(0, index - 180), index);
    if (/\b(?:not|never)\s*$/i.test(before) || /\bno\s+(?:longer\s+)?$/i.test(before)) continue;
    // Preserve the full alternatives/exception clause, including export authorization.
    const tail = text.slice(index + match[0].length, index + 1100);
    const boundary=[...tail.matchAll(/[.!?](?:\s+(?=[A-Z][a-z]{2,}\b)|$)/g)].find(item=>!/(?:\bU\.S|\bU\.S\.C|\be\.g|\bi\.e)$/i.test(tail.slice(0,item.index)));
    const end = boundary?.index ?? -1;
    const evidence = text.slice(index, index + match[0].length + (end < 0 ? Math.min(tail.length, 600) : end + 1));
    const context = before + evidence;
    const kind = /\b(?:ITAR|EAR|export[- ]control|export regulations|Department of State)\b/i.test(context) ? 'Export control' : /clearance/i.test(match[0]) ? 'Security clearance' : 'Citizenship';
    if (!restrictions.some(item => item.kind === kind)) restrictions.push({ kind, evidence });
  }
  return restrictions;
}

export function groundedAuthorizationRestrictions(text: string, extracted: AuthorizationRestriction[] = []) {
  return [...new Map([...extracted.filter(item => normalize(text).includes(normalize(item.evidence))), ...detectAuthorizationRestrictions(text)].map(item => [item.kind, item])).values()];
}

type EligibilityJob = { eligible: boolean; sponsorship: string; description: string; authorizationRestrictions?: AuthorizationRestriction[] };
export const jobAuthorizationRestrictions = (job: Pick<EligibilityJob, 'description' | 'authorizationRestrictions'>) => job.authorizationRestrictions ?? detectAuthorizationRestrictions(job.description);
export function eligibilityState(job: EligibilityJob): 'Qualified' | 'Needs review' | 'Excluded' {
  if (!job.eligible || job.sponsorship === 'No') return 'Excluded';
  return jobAuthorizationRestrictions(job).length ? 'Needs review' : 'Qualified';
}
