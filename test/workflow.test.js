import { test } from 'node:test';
import assert from 'node:assert/strict';
import { foldWorkflow, workflowText } from '../src/workflow.js';

/**
 * Workflow runs. If these regress, a workflow's agents and their outcomes
 * are not shown while it runs, or a finished run still reads as running.
 */

const ev = (type, data) => ({ type, data: { runId: 'r1', ...data } });

test('a run follows its members by phase until it ends', () => {
  const runs = new Map();
  foldWorkflow(runs, ev('tool-workflow/run-start', { name: 'review' }));
  foldWorkflow(runs, ev('tool-workflow/agent-start', { seq: 1, label: 'scan', phase: 'find' }));
  foldWorkflow(runs, ev('tool-workflow/agent-start', { seq: 2, label: 'check', phase: 'verify' }));
  let run = foldWorkflow(runs, ev('tool-workflow/agent-end', { seq: 1, outcome: 'completed' }));
  assert.equal(
    workflowText(run),
    [
      '● workflow review · running · 1/2 agents done',
      '  find',
      '    ✓ scan · completed',
      '  verify',
      '    ● check · running',
    ].join('\n'),
  );
  foldWorkflow(runs, ev('tool-workflow/agent-end', { seq: 2, outcome: 'failed' }));
  run = foldWorkflow(runs, ev('tool-workflow/run-end', { stopReason: 'error' }));
  assert.match(workflowText(run), /^✗ workflow review · error · 1\/2 agents done/);
  assert.match(workflowText(run), /✗ check · failed/);
});

test('events of other kinds, or of a run never started, change nothing', () => {
  const runs = new Map();
  assert.equal(foldWorkflow(runs, { type: 'turn/start' }), undefined);
  assert.equal(
    foldWorkflow(runs, ev('tool-workflow/agent-start', { seq: 1, label: 'x' })),
    undefined,
  );
  assert.equal(runs.size, 0);
});
