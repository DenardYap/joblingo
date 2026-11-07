import { listingState, type Job, type CompanyFacts } from '../../../shared/workspace';
import { localDate } from './api';

export type DateRange = { from: string; to: string };
export type JobFilters = {
  availability: string[]; locations: string[]; companyTypes: string[]; sizes: string[];
  sponsorship: string[]; sources: string[]; statuses: string[]; workplaces: string[];
  score: { min: string; max: string }; posted: DateRange; found: DateRange;
};
export const defaultFilters = (): JobFilters => ({
  availability: ['Open'], locations: [], companyTypes: [], sizes: [], sponsorship: [],
  sources: [], statuses: [], workplaces: [], score: { min: '', max: '' },
  posted: { from: '', to: '' }, found: { from: '', to: '' },
});
export const sizeBands = [
  { value: '1-50', min: 1, max: 50, label: '1–50' },
  { value: '51-200', min: 51, max: 200, label: '51–200' },
  { value: '201-500', min: 201, max: 500, label: '201–500' },
  { value: '501-1000', min: 501, max: 1000, label: '501–1,000' },
  { value: '1001-5000', min: 1001, max: 5000, label: '1,001–5,000' },
  { value: '5001-10000', min: 5001, max: 10000, label: '5,001–10,000' },
  { value: '10001+', min: 10001, max: Infinity, label: '10,001+' },
];

// Only interpret employee numbers. Dates, valuations and follower counts are not headcount.
// Keep the original research text available in the table tooltip and Company tab.
export function employeeCount(raw: string | null | undefined): { min: number; max: number; label: string } | null {
  if (!raw) return null;
  const text = raw.replace(/\u00a0/g, ' ').replace(/(\d[\d,.]*\s+)(?:[A-Z][\w&.-]*\s+){1,3}(?=(?:full[- ]time\s+)?employees?\b)/g, '$1');
  const number = '(\\d[\\d,]*(?:\\.\\d+)?\\s*[kK]?)';
  const range = text.match(new RegExp(`${number}\\s*(?:–|—|-|to)\\s*${number}\\s*(?:full[- ]time\\s+)?(?:employees?|people|staff|workers?)\\b`, 'i'))
    ?? text.match(new RegExp(`^(?:approximately |about |estimated |~)?${number}\\s*(?:–|—|-|to)\\s*${number}(?:\\s*\\(|\\s*$)`, 'i'));
  const parse = (value = '') => Number(value.replace(/[kK,\s]/g, '')) * (/[kK]/.test(value) ? 1000 : 1);
  const format = (value: number) => value.toLocaleString('en-US');
  if (range) {
    const min = parse(range[1]); const max = parse(range[2]);
    return min > 0 && max >= min ? { min, max, label: `${format(min)}–${format(max)}` } : null;
  }
  const count = text.match(new RegExp(`(?:(over|more than|at least|well over|approximately|about|around|roughly|nearly|under|fewer than|up to|~)\\s*)?${number}\\s*(\\+)?\\s*(?:full[- ]time\\s+)?(?:employees?|people|staff|workers?)\\b`, 'i'))
    ?? text.match(new RegExp(`^(?:(approximately|about|~)\\s*)?${number}\\s*(\\+)?\\s*$`, 'i'));
  if (!count) return null;
  const value = parse(count[2]); if (!(value > 0)) return null;
  const qualifier = count[1]?.toLowerCase() ?? '';
  if (count[3] || /over|more than|at least/.test(qualifier)) return { min: value, max: Infinity, label: `${format(value)}+` };
  if (/under|fewer than|up to/.test(qualifier)) return { min: 1, max: value, label: `${qualifier === 'up to' ? '≤' : '<'}${format(value)}` };
  return { min: value, max: value, label: `${qualifier ? '~' : ''}${format(value)}` };
}

// Group common city aliases without implying that remote means any location.
export function locationKeys(job: Job): string[] {
  if (!job.location?.trim()) return ['Not listed'];
  return [...new Set(job.location.split(/;|\s+\/\s+/).map(place => {
    const city = place.split(',')[0]?.trim() || 'Not listed';
    return /^san francisco$/i.test(city) ? 'San Francisco' : /^san jose$/i.test(city) ? 'San Jose' : /^san mateo$/i.test(city) ? 'San Mateo' : city;
  }))];
}
const includes = (values: string[], value: string) => !values.length || values.includes(value);
export const rangeActive = (range: DateRange) => Boolean(range.from || range.to);
export const scoreActive = (filters: JobFilters) => Boolean(filters.score.min || filters.score.max);
export function activeFilterCount(filters: JobFilters): number {
  return ['availability', 'locations', 'companyTypes', 'sizes', 'sponsorship', 'sources', 'statuses', 'workplaces']
    .reduce((count, key) => count + Number((filters[key as keyof JobFilters] as string[]).length > 0), 0)
    + Number(scoreActive(filters)) + Number(rangeActive(filters.posted)) + Number(rangeActive(filters.found));
}
function dateMatches(value: string | null | undefined, range: DateRange, timezone: string): boolean {
  if (!rangeActive(range)) return true;
  if (!value || !Number.isFinite(Date.parse(value))) return false;
  const date = localDate(value, timezone);
  return (!range.from || date >= range.from) && (!range.to || date <= range.to);
}
export function matchesFilters(job: Job, facts: CompanyFacts | undefined, filters: JobFilters, query: string, timezone: string): boolean {
  const count = employeeCount(facts?.headcount);
  const sizeMatches = !filters.sizes.length || filters.sizes.some(value => {
    if (value === 'Unknown') return !count;
    const band = sizeBands.find(band => band.value === value);
    // A reported employee range can overlap more than one selected band.
    return Boolean(count && band && count.min <= band.max && count.max >= band.min);
  });
  return `${job.title} ${job.company} ${job.location ?? ''}`.toLowerCase().includes(query.trim().toLowerCase())
    && includes(filters.availability, listingState(job))
    && (!filters.locations.length || locationKeys(job).some(location => filters.locations.includes(location)))
    && includes(filters.companyTypes, job.companyListing?.status ?? 'Unknown')
    && includes(filters.sponsorship, job.sponsorship)
    && includes(filters.sources, job.source)
    && includes(filters.statuses, job.status)
    && includes(filters.workplaces, job.workplace)
    && (!scoreActive(filters) || job.matchCurrent !== false)
    && sizeMatches && job.score >= Number(filters.score.min || 0) && job.score <= Number(filters.score.max || 100)
    && dateMatches(job.postedAt, filters.posted, timezone)
    && (!rangeActive(filters.found) || job.foundOn.some(date => dateMatches(date, filters.found, timezone)));
}
