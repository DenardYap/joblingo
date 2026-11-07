import { z } from 'zod';
import type { Resume } from './workspace';

export const resumeEditSchema = z.object({
  name: z.string().trim().min(1).max(160),
  text: z.string().trim().min(50, 'Keep at least 50 characters of resume content.').max(50000),
  revision: z.number().int().positive(),
}).strict();

export function reviseResume(resume: Resume, input: z.infer<typeof resumeEditSchema>, now = new Date().toISOString()): Resume {
  const edit = resumeEditSchema.parse(input);
  if (edit.revision !== (resume.revision ?? 1)) throw new Error('This resume changed in another window. Reopen it before editing again.');
  return { ...resume, name: edit.name, text: edit.text, originalText: resume.originalText ?? resume.text,
    originalName: resume.originalName ?? resume.name, revision: edit.revision + 1, updatedAt: now };
}

const normalize = (value: string) => value.toLowerCase().replace(/\s+/g, ' ').trim();
export function candidateSources(resume: Resume | null, background: string) {
  return [resume?.text ?? '', background.trim()].filter(Boolean);
}
export function verifiedEvidence(quotes: string[], sources: string[]) {
  return quotes.filter((quote) => normalize(quote).length >= 5 && sources.some((source) => normalize(source).includes(normalize(quote))));
}
export function verifiedSearchTerms(terms: string[], sources: string[]) {
  return [...new Set(terms)].filter((term) => term.length >= 2 && term.length <= 60 && sources.some((source) => normalize(source).includes(normalize(term))) && !/@|https?:|www\.|\+?\d[\d\s().-]{6,}/i.test(term)).slice(0, 6);
}
