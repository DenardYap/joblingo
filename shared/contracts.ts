import { z } from 'zod';

export const MAX_JOBS_PER_RUN = 50;

export const searchBriefSchema = z.object({
  prompt: z.string().trim().min(20, 'Add a little more detail (at least 20 characters).').max(4000),
  topCount: z.number().int().min(1).max(MAX_JOBS_PER_RUN),
  localTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  timezone: z.string().refine((value) => {
    try { new Intl.DateTimeFormat('en', { timeZone: value }); return true; }
    catch { return false; }
  }, 'Choose a valid time zone.'),
});

export type SearchBrief = z.infer<typeof searchBriefSchema>;
