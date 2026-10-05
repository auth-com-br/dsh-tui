import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inventory, pluginsText } from '../src/plugins.js';

/**
 * /plugins. If these regress, a plugin that failed to load is lost among
 * the active ones, or a group is listed as a plugin.
 */

const entries = [
  { id: 'include', options: { name: 'cordis:include', group: true }, fiber: { state: 2 } },
  { id: 'llm', options: { name: '@deepseek-ai/dsh-llm' }, fiber: { state: 2 } },
  { id: 'hmr', options: { name: '@deepseek-ai/cordis-plugin-hmr' }, disabled: true },
  { id: 'mcp-web', options: { name: '@deepseek-ai/dsh-mcp-client' }, fiber: { state: 3 } },
];

test('groups are left out and each plugin has its phase', () => {
  assert.deepEqual(inventory(entries), [
    { id: 'llm', module: '@deepseek-ai/dsh-llm', enabled: true, phase: 'active' },
    { id: 'hmr', module: '@deepseek-ai/cordis-plugin-hmr', enabled: false, phase: null },
    { id: 'mcp-web', module: '@deepseek-ai/dsh-mcp-client', enabled: true, phase: 'failed' },
  ]);
});

test('the summary counts them and puts the failures first', () => {
  const text = pluginsText(inventory(entries), '', 80);
  const lines = text.split('\n');
  assert.equal(lines[0], 'plugins: 1 active · 1 off · 1 failed');
  assert.equal(lines[1], '  ✗ mcp-web (@deepseek-ai/dsh-mcp-client) failed to load');
  assert.match(text, /○ off: hmr/);
  assert.match(text, /● active: llm/);
});

test('a filter shows the matching plugins with their modules', () => {
  assert.match(
    pluginsText(inventory(entries), 'mcp', 80),
    /^ {2}✗ mcp-web\s+failed\s+@deepseek-ai\/dsh-mcp-client$/,
  );
  assert.match(pluginsText(inventory(entries), 'nothing', 80), /no plugin matches/);
});

test("the root group's include: prefix is not shown", () => {
  const rows = inventory([{ id: 'include:llm', options: { name: 'x' }, fiber: { state: 2 } }]);
  assert.match(pluginsText(rows, '', 80), /● active: llm$/m);
  assert.match(pluginsText(rows, 'include:llm', 80), /● llm/);
});
