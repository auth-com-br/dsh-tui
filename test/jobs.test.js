import { test } from 'node:test';
import assert from 'node:assert/strict';
import { jobsBadge, jobsText } from '../src/jobs.js';

/**
 * Background jobs. If these regress, a job left running is not shown, or
 * /jobs lists them in an order where the running one is lost.
 */

const job = (id, status, startedAt, extra = {}) => ({
  id,
  label: `${id} work`,
  status,
  startedAt,
  ...extra,
});

test('the footer counts the jobs still going', () => {
  assert.equal(jobsBadge([]), '');
  assert.equal(jobsBadge([job('bash-1', 'completed', 0)]), '');
  assert.equal(
    jobsBadge([job('bash-1', 'running', 0), job('bash-2', 'stopping', 0)]),
    'jobs: 2 running',
  );
});

test('/jobs lists the running first, with how long and the detail', () => {
  const text = jobsText(
    [
      job('bash-1', 'completed', 0, { finishedAt: 5000, detail: 'exit code: 0' }),
      job('bash-2', 'running', 1000),
    ],
    91000,
  );
  const lines = text.split('\n');
  assert.match(lines[1], /● bash-2\s+running\s+1m30s\s+bash-2 work/);
  assert.match(lines[2], /✓ bash-1\s+completed\s+5s\s+bash-1 work \(exit code: 0\)/);
  assert.equal(jobsText([], 0), 'this session has no background jobs.');
});
