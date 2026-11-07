import type { Research } from '../../server/research';
import type { Job } from '../../shared/workspace';

export function CompanyMetadata({research,job,pending}:{research:Research|null;job:Job;pending:boolean}) {
  const company=research?.data?.company;
  const listing=research?.listing ?? job.companyListing;
  const headcountSources=[...new Map((research?.grounding ?? []).filter(entry=>entry.field.endsWith('company.headcount')).flatMap(entry=>entry.citations).map(source=>[source.url,source])).values()];
  const missing=pending ? 'Researching…' : 'Not publicly confirmed';
  return <>
    <dl className="job-facts company-key-facts">
      <div><dt>Employee headcount</dt><dd>{company?.headcount ?? missing}
        {headcountSources.length>0 && <span className="fact-sources">{headcountSources.map((source,index)=><a key={source.url} href={source.url} target="_blank" rel="noreferrer" title={source.title ?? source.url}>{headcountSources.length>1 ? `Source ${index+1}` : 'Source'} ↗</a>)}</span>}
      </dd></div>
      <div><dt>Company type</dt><dd>{listing?.status==='Public' ? 'Publicly traded' : listing?.status==='Private' ? 'Privately held' : listing ? 'Not publicly confirmed' : job.example ? 'Example company' : 'Checking…'}
        {listing?.status==='Public' && <span className="fact-detail">{listing.exchange}: {listing.ticker}</span>}
        {listing?.sourceUrl && <span className="fact-sources"><a href={listing.sourceUrl} target="_blank" rel="noreferrer" title={listing.evidence ?? undefined}>Source ↗</a></span>}
      </dd></div>
    </dl>
    {company && <><p className="research-summary">{company.summary}</p><dl className="job-facts"><div><dt>Industry</dt><dd>{company.industry ?? 'Not publicly confirmed'}</dd></div><div><dt>ARR / revenue</dt><dd>{company.revenue ?? 'Not publicly confirmed'}</dd></div><div><dt>Funding</dt><dd>{company.funding ?? 'Not publicly confirmed'}</dd></div></dl></>}
  </>;
}
