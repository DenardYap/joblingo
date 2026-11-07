import assert from 'node:assert/strict';
import test from 'node:test';
import {providerError,providerRetryDelay} from '../server/errors.js';

test('temporary limits honor Retry-After and stop at a bounded retry count',()=>{
 const error={status:429,code:'rate_limit_exceeded',headers:new Headers({'retry-after':'90'})};
 assert.ok(providerRetryDelay(error,0)!>=90000);
 assert.equal(providerRetryDelay(error,3),null);
 assert.equal(providerRetryDelay({status:429,headers:new Headers({'retry-after':'600'})},0),null);
});
test('billing limits and invalid requests are not retried as transient throttles',()=>{
 for(const code of ['insufficient_quota','credit_balance_exhausted','project_spend_limit_exceeded','organization_usage_limit_exceeded']) {
  assert.equal(providerRetryDelay({status:429,code},0),null);
 }
 assert.equal(providerRetryDelay({status:429,type:'insufficient_quota'},0),null);
 assert.equal(providerRetryDelay({status:400},0),null);
 assert.match(providerError('OpenAI',{status:429,code:'credit_balance_exhausted'}).message,/credits are exhausted/);
});
