import { Avatar } from '@radix-ui/themes';
import { hasNamedEmployer } from '../../shared/company-identity';
import type { Job } from '../../shared/workspace';

export function CompanyLogo({job,size='2'}:{job:Job;size?:'2'|'3'}) {
  const initials=job.company.split(/\s+/).slice(0,2).map((word)=>word[0]).join('').toUpperCase();
  return <Avatar className="company-logo" size={size} radius="medium" color="gray" src={!job.example && hasNamedEmployer(job.company) ? `/api/jobs/${job.id}/logo?v=employer-v4` : undefined} fallback={initials} alt={`${job.company} logo`} />;
}
