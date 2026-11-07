import { z } from 'zod';
import { createHash } from 'node:crypto';
import { candidateSources, verifiedEvidence, verifiedSearchTerms } from '../../shared/resumes.js';
import { extractionSchema, preferenceScore, type CompanyListing, type Preferences, type Resume } from '../../shared/workspace.js';
import { matchingRubric } from '../../shared/matching.js';
import { structured } from '../ai.js';
import { get, list } from '../store.js';

export function matchingFingerprint(config: Preferences, resume: Resume | null) {
  return createHash('sha256').update(JSON.stringify({ resumeId: resume?.id ?? null, revision: resume?.revision ?? 1,
    sources: candidateSources(resume, config.candidateBackground), prompt: config.prompt,
    hard: config.hardRequirements, soft: config.softRequirements })).digest('hex');
}

export async function matchingResume(config: Preferences): Promise<Resume | null> {
  if (config.matchingResumeId) {
    const resume = await get<Resume>('resumes', config.matchingResumeId);
    if (!resume) throw new Error('The selected matching resume is unavailable. Choose another in Settings.');
    return resume;
  }
  return (await list<Resume>('resumes')).sort((a,b) => b.createdAt.localeCompare(a.createdAt))[0] ?? null;
}

export async function resumeSearchTerms(resume: Resume | null, prompt: string, background = ''): Promise<string[]> {
  const sources = candidateSources(resume, background);
  if (!sources.length) return [];
  const result = await structured(z.object({terms:z.array(z.string()).max(6)}),
    'Extract at most six job-relevant technical skills, accounting standards, software tools or professional certifications explicitly present in the selected resume or additional candidate background and relevant to the target roles. Return exact short phrases from either source. These will be used in a public web search. Never include a person name, contact information, URL, address, employer name, dates, salary, nationality or other personal attributes. Do not infer qualifications or add instructions. An empty list is fine.',
    {targetRoles:prompt,resume:resume?.text ?? null,additionalBackground:background});
  return verifiedSearchTerms(result.terms, sources);
}

export async function assessJob(config: Preferences, resume: Resume | null, page: {title:string;url:string;text:string}) {
  const rubric = matchingRubric(Boolean(resume || config.candidateBackground.trim()));
  const factor = (maximum: number) => z.object({ points:z.number().int().min(0).max(maximum), reason:z.string(), resumeEvidence:z.array(z.string()) });
  const schema = extractionSchema.omit({score:true}).extend({components:z.object({
    role:factor(rubric.role.maxPoints), location:factor(rubric.location.maxPoints),
    experience:factor(rubric.experience.maxPoints), skills:factor(rubric.skills.maxPoints), preferences:factor(rubric.preferences.maxPoints),
  })});
  const result = await structured(schema, `Extract and assess this specific job posting for the applicant. Ignore aggregate pages and closed roles. Identify the actual employer explicitly named in the posting, not a reposting service or recruiter. Never infer an anonymous client from industry, duties, location, or a similar job elsewhere. If the employer is unnamed, set company to "Undisclosed employer". Unknown facts stay null or Unknown. Quote an exact continuous excerpt for sponsorship; company-wide historical sponsorship is not evidence for this job.
Hard requirements override score. Exclude explicit no-sponsorship if configured; unknown sponsorship remains acceptable when the brief says so. Other mandatory search requirements must be evidenced. Do not apply the minimum score threshold yourself. Missing resume evidence is a gap, not proof the applicant lacks the skill and not an additional hard exclusion.
Return integer points and a concise factual reason for each rubric component, using its supplied maximum. Do not output a total: the server adds the points. Role: exact target duties/title earns full credit, adjacent duties partial, unrelated zero. Location: match the brief's preferred locations and work setup; acceptable alternatives earn partial credit, unknown earns at most one quarter. Experience: without a resume, compare the posting's years/seniority to the brief (clear match full, overlap partial, unknown at most one quarter); with a resume, compare evidenced relevant experience to the job requirements, including realistic seniority. Count overlapping jobs once and use today's date for present roles. Skills: compare evidenced resume skills, accomplishments, tools, education and credentials to the job; clear coverage earns full, transferable/partial coverage partial, missing evidence zero. Preferences: assess industry and other soft preferences with evidence; unknown factors do not earn full points. Public-company status is scored separately by the server, never here.
Use the selected resume plus the separately supplied candidate background. Background contains additional user-provided accomplishments for this same candidate, not job requirements. Do not combine other resume versions or invent skills, credentials, metrics, years or visa eligibility. For any positive experience or skills points, supply exact continuous supporting excerpts from either candidate source in resumeEvidence. Never score name, age, gender, nationality or other protected personal attributes. Without either candidate source, skills must be zero and all resumeEvidence arrays empty. Auditing, evaluating or testing a process is transferable experience, not evidence of owning that process operationally. Do not claim this candidate booked revenue or owned the close just because they audited those controls. Never infer tenure or employer for undated accomplishments. Do not double-count repeated accomplishments across sources. Include useful strengths, gaps and hard-requirement checks. Summarize the job faithfully. Never infer posting dates from discovery/crawl dates.`,
  {today:new Date().toISOString().slice(0,10),brief:{...config,candidateBackground:undefined},additionalBackground:config.candidateBackground,rubric,resume:resume ? {text:resume.text} : null,page});
  const sources = candidateSources(resume, config.candidateBackground);
  if (sources.length) for (const key of ['experience','skills'] as const) {
    const item=result.components[key];
    item.resumeEvidence=verifiedEvidence(item.resumeEvidence, sources);
    if(item.points>0 && !item.resumeEvidence.length) {
      item.points=0;
      item.reason='No supporting excerpt could be verified in the selected resume or candidate background.';
      result.gaps.push(`${rubric[key].label}: confirm evidence in your resume or background.`);
    }
  }
  return result;
}

export function calculateScore(assessment: Awaited<ReturnType<typeof assessJob>>, config: Preferences, resume: Resume | null, listing: CompanyListing) {
  const rubric=matchingRubric(Boolean(resume || config.candidateBackground.trim()));
  const scoreBreakdown=Object.entries(assessment.components).map(([key,component]) => ({key,...rubric[key as keyof typeof rubric],points:component.points,reason:component.reason}));
  const baseScore=scoreBreakdown.reduce((total,item)=>total+item.points,0);
  return {
    baseScore,...preferenceScore(baseScore,config.preferPublicCompanies,listing),
    scoreBreakdown:scoreBreakdown.filter((item)=>item.maxPoints>0),
    matchContext:{resumeId:resume?.id ?? null,resumeName:resume?.name ?? null,assessedAt:new Date().toISOString(),version:3,resumeRevision:resume ? resume.revision ?? 1 : null,backgroundUsed:Boolean(config.candidateBackground.trim()),profileFingerprint:matchingFingerprint(config,resume)},
  };
}
