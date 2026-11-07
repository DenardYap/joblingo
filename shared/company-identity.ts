import type { CompanyListing } from './workspace.js';

export const unidentifiedEmployerNotice = 'This recruiter listing does not identify the employer. Confirm the company with the recruiter before relying on company details or contacts.';
export function hasNamedEmployer(company: string): boolean {
  const name = company.trim();
  return Boolean(name) && !/\b(undisclosed|unnamed|anonymous|unidentified|unconfirmed)\b|\bnot (?:disclosed|identified|specified|listed)\b|^(?:unknown|confidential|stealth)(?:\s+(?:company|client|employer|startup))?$|^(?:our |a |an )?(?:confidential |private |public |technology |tech |software |hardware |ai |cloud |infrastructure |high-growth |leading )*(?:company|employer|client|startup)$/i.test(name);
}
export function normalizedEmployerName(name: string): string {
  return name.toLowerCase().replace(/\b(?:incorporated|corporation|inc|corp|llc|ltd|limited|plc|n\.v\.|nv)\b\.?/g, '').replace(/[^a-z0-9]/g, '');
}
export function unidentifiedListing(checkedAt = new Date().toISOString()): CompanyListing {
  return { status: 'Unknown', exchange: null, ticker: null, sourceUrl: null, evidence: unidentifiedEmployerNotice, checkedAt };
}
