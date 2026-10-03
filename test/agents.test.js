import { test } from 'node:test';
import assert from 'node:assert/strict';
import { agentRows } from '../src/agents.js';

/**
 * /agents. If these regress, the subagent picker loses the tree's shape,
 * offers two rows the answer cannot tell apart, or a broken entry opens.
 */

test('rows are indented by depth and say mode and activity', () => {
  const rows = agentRows([
    {
      kind: 'child',
      id: 'a',
      depth: 1,
      mode: 'continuable',
      label: 'review the parser',
      activity: 'running',
    },
    { kind: 'child', id: 'b', depth: 2, mode: 'one-shot', activity: 'inactive' },
    { kind: 'diagnostic', id: 'c', depth: 1 },
  ]);
  assert.deepEqual(rows, [
    {
      id: 'a',
      label: 'review the parser',
      mode: 'continuable',
      description: 'continuable · running',
    },
    { id: 'b', label: '  b', mode: 'one-shot', description: 'one-shot · done' },
    { label: 'c', description: 'cannot be read' },
  ]);
});

test('two subagents with the same label can be told apart', () => {
  const rows = agentRows([
    { kind: 'child', id: 'a', depth: 1, mode: 'one-shot', label: 'search', activity: 'inactive' },
    { kind: 'child', id: 'b', depth: 1, mode: 'one-shot', label: 'search', activity: 'inactive' },
  ]);
  assert.deepEqual(
    rows.map(r => r.label),
    ['search', 'search (2)'],
  );
});
