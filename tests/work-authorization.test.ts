import test from 'node:test';
import assert from 'node:assert/strict';
import { detectAuthorizationRestrictions, eligibilityState, groundedAuthorizationRestrictions } from '../shared/work-authorization.js';
import { defaultFilters, matchesFilters } from '../web/src/lib/job-filters.js';
import { examples } from '../server/fixtures.js';
import { mergeJobCopies } from '../shared/job-deduplication.js';

const itar = 'ITAR REQUIREMENTS: To conform to U.S. Government export regulations, applicant must be a (i) U.S. citizen or national, (ii) U.S. lawful, permanent resident (aka green card holder), (iii) Refugee under 8 U.S.C. § 1157, or (iv) Asylee under 8 U.S.C. § 1158, or be eligible to obtain the required authorizations from the U.S. Department of State. Learn more about ITAR here.';

test('the SpaceX clause is a separate export-control restriction even when sponsorship is unknown', () => {
  const restrictions=detectAuthorizationRestrictions(itar);
  assert.equal(restrictions.length,1);
  assert.equal(restrictions[0]!.kind,'Export control');
  for(const alternative of ['citizen or national','permanent resident','Refugee','Asylee','eligible to obtain the required authorizations']) assert.ok(restrictions[0]!.evidence.includes(alternative));
  assert.ok(itar.includes(restrictions[0]!.evidence));
  const job={...examples()[0]!,description:itar,sponsorship:'Unknown' as const,eligible:true};
  assert.equal(eligibilityState(job),'Needs review');
  assert.equal(matchesFilters(job,undefined,defaultFilters(),'','America/Los_Angeles'),false);
  assert.equal(matchesFilters(job,undefined,{...defaultFilters(),eligibility:['Needs review']},'','America/Los_Angeles'),true);
});

test('explicit citizenship, residency and clearance conditions need review', () => {
  for(const text of ['Applicants must be U.S. citizens.','U.S. citizenship is required for this position.','US citizens only.','Applicants must be United States permanent residents.','Must be able to obtain and maintain a Secret security clearance.','An active security clearance is required.']) {
    assert.ok(detectAuthorizationRestrictions(text).length,text);
  }
});

test('ordinary work authorization, EEO, questions, negations and optional experience are not restrictions', () => {
  for(const text of ['Applicants must be authorized to work in the United States.','We are an equal opportunity employer regardless of citizenship or national origin.','Are you a U.S. citizen?','U.S. citizenship is not required.','We do not require U.S. citizenship.','Security clearance is not required.','Experience with ITAR compliance is preferred.','You must be detail-oriented. We welcome U.S. citizens and visa holders.']) {
    assert.deepEqual(detectAuthorizationRestrictions(text),[],text);
  }
});

test('unverified model restrictions are discarded and real clauses retain their full exceptions', () => {
  assert.deepEqual(groundedAuthorizationRestrictions('General accounting role.',[{kind:'Citizenship',evidence:'U.S. citizenship required.'}]),[]);
  const restrictions=groundedAuthorizationRestrictions(itar,[{kind:'Export control',evidence:'U.S. citizen or national'}]);
  assert.ok(restrictions[0]!.evidence.includes('Department of State'));
});

test('duplicate source consolidation cannot hide a restriction or lose application tracking', () => {
  const base={...examples()[0]!,example:false,description:'An accounting role.',checkedAt:new Date().toISOString(),availability:'Open' as const};
  const restricted={...base,id:'restricted',description:itar,authorizationRestrictions:detectAuthorizationRestrictions(itar),saved:true,status:'Applied' as const};
  const merged=mergeJobCopies([base,restricted]);
  assert.equal(eligibilityState(merged),'Needs review');
  assert.equal(merged.saved,true);assert.equal(merged.status,'Applied');
  assert.equal(matchesFilters(merged,undefined,defaultFilters(),'','America/Los_Angeles'),false);
});
