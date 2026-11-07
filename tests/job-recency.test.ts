import assert from 'node:assert/strict';
import test from 'node:test';
import { compareRecentJobs, withinPostingWindow } from '../shared/job-recency';

const now = Date.parse('2026-11-07T12:00:00Z');
const day = 86_400_000;
const posted = (daysAgo: number) => new Date(now - daysAgo * day).toISOString();

test('the seven-day window includes its boundary, not older, unknown, or future dates', () => {
  assert.equal(withinPostingWindow(posted(7), 7, now), true);
  for (const value of [posted(7.001), null, 'not a date', posted(-1)]) {
    assert.equal(withinPostingWindow(value, 7, now), false);
  }
});

test('a qualifying new-day job outranks a higher-fit week-old job and old history', () => {
  const jobs = [
    { postedAt: posted(60), score: 100 },
    { postedAt: posted(5), score: 95 },
    { postedAt: posted(0.5), score: 70 },
    { postedAt: null, score: 100 },
  ];
  assert.deepEqual([...jobs].sort((a,b) => compareRecentJobs(a,b,7,now)), [jobs[2],jobs[1],jobs[0],jobs[3]]);
});

test('fit retains its priority within the same age group, with posting time breaking a tie', () => {
  const jobs = [
    { postedAt: posted(2), score: 80 },
    { postedAt: posted(5), score: 85 },
    { postedAt: posted(3), score: 85 },
  ];
  assert.deepEqual([...jobs].sort((a,b) => compareRecentJobs(a,b,7,now)), [jobs[2],jobs[1],jobs[0]]);
});

test('outdated fit scores do not beat current assessments in their age group', () => {
  const old = { postedAt: posted(0.2), score: 100, matchCurrent: false };
  const current = { postedAt: posted(0.3), score: 70, matchCurrent: true };
  assert.ok(compareRecentJobs(current,old,7,now) < 0);
});
