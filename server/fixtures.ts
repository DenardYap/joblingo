import type { Job } from '../shared/workspace.js';

export function examples(): Job[] {
  const today = new Date();
  const yesterday = new Date(today.getTime() - 86400000);
  return [
    { title: 'Senior Revenue Accountant', company: 'Forma Systems', score: 94, salary: '$120,000 – $145,000', officeDays: '3 days / week', workplace: 'Hybrid', location: 'San Francisco, CA', sponsorship: 'Unknown', experience: '3–5 years', source: 'Company sites', day: today },
    { title: 'Senior Accountant', company: 'Northstar Software', score: 89, salary: '$110,000 – $135,000', officeDays: null, workplace: 'Remote', location: 'San Francisco, CA', sponsorship: 'Yes', experience: '4+ years', source: 'LinkedIn', day: today },
    { title: 'Revenue Accountant', company: 'Fieldwork Robotics', score: 86, salary: '$100,000 – $125,000', officeDays: '2 days / week', workplace: 'Hybrid', location: 'San Jose, CA', sponsorship: 'Unknown', experience: '3+ years', source: 'Indeed', day: today },
    { title: 'Technical Accountant', company: 'Parallel Hardware', score: 82, salary: null, officeDays: '3 days / week', workplace: 'Hybrid', location: 'Redwood City, CA', sponsorship: 'Unknown', experience: '3–5 years', source: 'Glassdoor', day: yesterday },
    { title: 'Accountant', company: 'Common Ground', score: 76, salary: '$90,000 – $115,000', officeDays: null, workplace: 'Remote', location: 'United States', sponsorship: 'Unknown', experience: '2–4 years', source: 'Company sites', day: yesterday },
  ].map((item, index) => ({
    ...item, workplace: item.workplace as Job['workplace'], sponsorship: item.sponsorship as Job['sponsorship'],
    id: `example-${index + 1}`, isJob: true, open: true, eligible: true, example: true,
    sponsorshipEvidence: item.sponsorship === 'Yes' ? 'Illustrative example: sponsorship is available for this role.' : null,
    url: null, postedAt: null, foundAt: item.day.toISOString(), lastFoundAt: item.day.toISOString(), foundOn: [item.day.toISOString()],
    saved: false, status: 'Not started', notes: '', appliedAt: null,
    reason: 'Example match: accounting scope, technology industry, and Bay Area location align with the search brief.',
    strengths: ['Relevant accounting role', 'Technology company', 'Bay Area location'], gaps: item.sponsorship === 'Unknown' ? ['Confirm visa sponsorship with the recruiter.'] : [],
    requirements: [{ requirement: 'No explicit refusal of sponsorship', result: 'Met', evidence: 'Illustrative only. This is not a verified opening.' }],
    description: 'This is a fictional example for reviewing the interface.\n\nOwn revenue accounting and month-end close. Work with finance and business partners on reconciliations, financial reporting, and accounting policy.\n\nRelevant experience includes revenue recognition, technical accounting, and improving financial processes. No application link is provided for example jobs.',
  }));
}
