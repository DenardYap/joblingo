import { workspaceId } from './workspace-context.js';
import { load } from 'cheerio';
import { z } from 'zod';
import { exaClient, safeUrl, structured } from './ai.js';
import { publicGet } from './public-web.js';
import { patch } from './store.js';
import { LOGO_VERSION } from './company-logo.js';
import type { Job } from '../shared/workspace.js';
import { applicationIdentity } from '../shared/job-deduplication.js';
import { groundedAuthorizationRestrictions, jobAuthorizationRestrictions } from '../shared/work-authorization.js';

type RecordData = Record<string, any>;
export type ListingCheck = { availability: 'Open' | 'Closed' | 'Unverified'; availabilityReason: string; checkedAt: string; postedAt: string | null; postedAtSource: string | null; companyLogoUrl: string | null; companyWebsite: string | null; text: string; applicationIdentity?: Job['applicationIdentity'] };
const CLOSED = /(?:this (?:job|position|role|listing) (?:has expired|is closed|has been (?:closed|filled)|is no longer available)|(?:no longer|not currently) accepting (?:new )?applications|(?:job|position|role) (?:has been filled|is no longer (?:open|available))|applications (?:are|have been) closed)/i;
const normalized = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
function matchesTitle(actual: string, expected?: string) { return Boolean(normalized(actual)) && (!expected || normalized(actual).includes(normalized(expected)) || normalized(expected).includes(normalized(actual))); }
function absolute(value: unknown, base: string): string | null { if (typeof value !== 'string') return null; try { const url = new URL(value, base).href; return safeUrl(url) ? url : null; } catch { return null; } }
export function postingDate(value: unknown, now = new Date()): string | null {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}(?:T.*)?$/.test(value)) return null;
  const time = Date.parse(value); return Number.isFinite(time) && time <= now.getTime() + 86400000 ? new Date(time).toISOString() : null;
}
function objects(value: unknown): RecordData[] {
  if (Array.isArray(value)) return value.flatMap(objects);
  if (!value || typeof value !== 'object') return [];
  const item = value as RecordData; return [item, ...objects(item['@graph'])];
}
function pageMetadata(html: string, url: string, title?: string) {
  const $ = load(html); const data: RecordData[] = [];
  $('script[type="application/ld+json"]').each((_,el) => { try { data.push(...objects(JSON.parse($(el).text()))); } catch {} });
  const postings = data.filter((item) => [item['@type']].flat().includes('JobPosting'));
  const job = postings.find((item) => typeof item.title === 'string' && matchesTitle(item.title,title));
  let org = job?.hiringOrganization;
  if (org?.['@id']) org = data.find((item) => item['@id'] === org['@id']) ?? org;
  const companyWebsite = absolute(org?.sameAs ?? org?.url,url);
  const companyLogoUrl = null; // Never use a job publisher's logo as the employer's.
  const links = $('a[href]').toArray().filter((el) => /apply/i.test($(el).text())).map((el) => absolute($(el).attr('href'),url)).filter((v): v is string => Boolean(v));
  const hasForm = $('form').toArray().some((el) => /application|apply/i.test($(el).attr('id') ?? '') && $(el).find('input,button').length > 0);
  const titleFound = $('h1,h2').toArray().some((el) => title && matchesTitle($(el).text(),title));
  $('script,style,noscript').remove();
  const text = $('body').text().replace(/\s+/g,' ').trim();
  return { job, text, links, hasForm, titleFound, companyLogoUrl, companyWebsite, date: postingDate(job?.datePosted), expires: typeof job?.validThrough === 'string' ? Date.parse(job.validThrough) : NaN };
}

export async function checkListing(url: string, title?: string): Promise<ListingCheck> {
  const checkedAt = new Date().toISOString();
  const result: ListingCheck = { availability:'Unverified', availabilityReason:'The live listing could not be confirmed.', checkedAt, postedAt:null, postedAtSource:null, companyLogoUrl:null, companyWebsite:null, text:'' };
  const closed = (reason: string) => ({...result,availability:'Closed' as const,availabilityReason:reason});
  const open = (reason: string) => ({...result,availability:'Open' as const,availabilityReason:reason});
  let page: Awaited<ReturnType<typeof publicGet>> | null = null;
  try { page = await publicGet(url); } catch {}
  if (page) {
    if ([404,410].includes(page.status)) return closed(`The source returned ${page.status}; this listing is no longer available.`);
    if (/expired_jd_redirect|job.?expired/i.test(page.url)) return closed('The source redirects this expired listing to other jobs.');
    if (page.status >= 200 && page.status < 300) {
      const meta = pageMetadata(page.body.toString('utf8'),page.url,title);
      Object.assign(result,{text:meta.text,postedAt:meta.date,postedAtSource:meta.date ? url : null,companyLogoUrl:meta.companyLogoUrl,companyWebsite:meta.companyWebsite});
      const identities=[...new Map(meta.links.map(applicationIdentity).filter(item=>item!==null).map(item=>[`${item.board}/${item.id}`,item])).values()];
      result.applicationIdentity=applicationIdentity(page.url) ?? (meta.job && identities.length===1 ? identities[0] : undefined);
      const notice = meta.text.match(CLOSED)?.[0];
      if (notice) return closed(`The live page says: “${notice}”.`);
      if (Number.isFinite(meta.expires) && meta.expires < Date.now()) return closed('The employer’s listing expiration date has passed.');
      const parsedUrl = new URL(page.url);
      if (['job-boards.greenhouse.io','boards.greenhouse.io'].includes(parsedUrl.hostname)) {
        const [board,section,id]=parsedUrl.pathname.split('/').filter(Boolean);
        if(board && section==='jobs' && id && /^\d+$/.test(id)) {
          try {
            const response=await publicGet(`https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(board)}/jobs/${id}`);
            if([404,410].includes(response.status))return closed('The employer’s Greenhouse job feed no longer contains this posting.');
            if(response.status===200) {
              const listing=JSON.parse(response.body.toString('utf8'));
              if(typeof listing.title==='string' && matchesTitle(listing.title,title)) {
                if (typeof listing.content === 'string') {
                  const decoded=load(listing.content).text();
                  const description=load(decoded).text().replace(/\s+/g,' ').trim();
                  if(description) result.text=description;
                }
                if(typeof listing.application_deadline==='string' && Date.parse(listing.application_deadline)<Date.now()) return closed('The employer’s application deadline has passed.');
                result.postedAt=postingDate(listing.first_published) ?? meta.date;
                result.postedAtSource=result.postedAt ? url:null;
                return open('Confirmed in the employer’s current Greenhouse job feed.');
              }
            }
          } catch {}
        }
      }
      if (parsedUrl.hostname === 'jobs.ashbyhq.com') {
        const [board,id] = parsedUrl.pathname.split('/').filter(Boolean);
        if (board && id) {
          try {
            const response = await publicGet(`https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(board)}`);
            if (response.status === 200) {
              const payload = JSON.parse(response.body.toString('utf8'));
              if (Array.isArray(payload.jobs)) {
                const listing = payload.jobs.find((j: RecordData) => typeof j.jobUrl === 'string' && new URL(j.jobUrl).pathname.split('/').filter(Boolean)[1] === id);
                if (listing && matchesTitle(listing.title,title)) { result.postedAt=postingDate(listing.publishedAt) ?? meta.date; result.postedAtSource=result.postedAt ? url:null; return open('Confirmed in the employer’s current Ashby job feed.'); }
                // Unlisted Ashby postings may remain accessible. Require a live JobPosting in that case.
                if (!meta.job) return closed('This posting is absent from the employer’s current job board.');
              }
            }
          } catch {}
          if (meta.job) return open('The employer’s live Ashby page contains this job posting.');
        }
      }
      if (meta.titleFound && meta.hasForm) return open('The live job page has a matching title and an application form.');
      if (meta.job && meta.links.some((link) => link !== page!.url && !link.endsWith('#'))) return open('The live job posting has a current application link.');
    }
  }
  // An inaccessible source is unknown, never implicitly open. Force a new crawl;
  // do not use search snippets or cached text as availability evidence.
  try {
    const response = await exaClient().getContents([url],{text:true,maxAgeHours:0,livecrawlTimeout:20000});
    const status = response.statuses?.find((s) => s.id === url);
    if (!status || status.status !== 'success') return {...result,availabilityReason:'The source blocked or timed out during the live check. Availability is unverified.'};
    const content = response.results.find((r) => r.url === url || r.id === url);
    if (!content?.text?.trim()) return result;
    result.text=content.text;
    const notice=content.text.match(CLOSED)?.[0];
    if (notice) return closed(`The live page says: “${notice}”.`);
    const verdict = await structured(z.object({status:z.enum(['Open','Closed','Unverified']),evidence:z.string().nullable(),reason:z.string()}), 'The server has just fetched the supplied URL live with maxAgeHours=0. Your task is to assess this returned page, not browse or fetch it yourself. Check the CURRENT availability of the specific requested job from that freshly fetched text. Open requires this exact job identity plus an active application invitation or application form. A job description alone, a generic Apply button without the matching role, search results, login walls or related jobs are insufficient: return Unverified. Expired, closed, filled, or no-longer-accepting notices override everything. Quote an exact continuous excerpt supporting the verdict. Do not use guesses, job fit, crawl dates, or general company hiring to infer availability.', {url,title,page:content.text});
    if (!verdict.evidence || normalized(verdict.evidence).length < 5 || !normalized(content.text).includes(normalized(verdict.evidence))) return result;
    return {...result,availability:verdict.status,availabilityReason:verdict.reason};
  } catch(error) { if(error instanceof Error && 'code' in error && error.code==='EXA_BUDGET_EXCEEDED')throw error;return result; }
}

const inFlight = new Map<string,Promise<Job>>();
export function verifyJob(job: Job): Promise<Job> {
  const key=`${workspaceId()}:${job.id}`;const old = inFlight.get(key); if (old) return old;
  const promise = (async () => {
    if (!job.url || job.example) return job;
    const check = await checkListing(job.url,job.title);
    const {text: _text,...fields}=check;
    fields.postedAt=check.postedAt ?? (job.postedAtSource ? job.postedAt : null);
    fields.postedAtSource=check.postedAtSource ?? job.postedAtSource ?? null;
    fields.companyWebsite=check.companyWebsite ?? job.companyWebsite ?? null;
    if (job.availability === 'Closed' && check.availability === 'Unverified') { fields.availability='Closed'; fields.availabilityReason=job.availabilityReason ?? 'Previously confirmed closed.'; }
    const logo = job.companyLogoVersion === LOGO_VERSION ? job.companyLogoUrl : null;
    const authorizationRestrictions=check.text.trim() ? groundedAuthorizationRestrictions(check.text,job.authorizationRestrictions) : jobAuthorizationRestrictions(job);
    return (await patch<Job>('jobs',job.id,{...fields,authorizationRestrictions,companyLogoUrl:logo,companyLogoVersion:LOGO_VERSION,open:fields.availability==='Open'}))!;
  })().finally(()=>inFlight.delete(key));
  inFlight.set(key,promise); return promise;
}
