import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { settingsText, parseSettingsArgs } from '../src/settingsview.js';

/**
 * /settings. If these regress, a field the user set is not told from the
 * profile's, a value is stored as the wrong type, or /settings writes into
 * the namespaces /models owns.
 */

const described = [
  {
    ns: 'shell',
    value: { timeoutMs: 120000, graceMs: 3000 },
    user: { timeoutMs: 120000 },
    applies: 'live',
  },
  { ns: 'llm-pi-ai', value: { providers: {} } },
  { ns: 'permission', value: { defaultPreset: 'workspace-write' }, applies: 'restart' },
];
const names = described.map(d => d.ns);

describe('settingsText', () => {
  test('lists every field, marks the ones the user set, and leaves /models out', () => {
    const text = settingsText(described);
    assert.match(text, /^shell\n {2}\* timeoutMs\s+120000\n {4}graceMs\s+3000/);
    assert.match(text, /permission {2}\(applies restart\)/);
    assert.doesNotMatch(text, /llm-pi-ai/);
  });
});

describe('parseSettingsArgs', () => {
  test('a value is JSON when it parses, a string when not', () => {
    assert.deepEqual(parseSettingsArgs('shell.timeoutMs 90000', names), {
      op: 'set',
      ns: 'shell',
      path: ['timeoutMs'],
      value: 90000,
    });
    assert.deepEqual(parseSettingsArgs('permission.defaultPreset read-only', names), {
      op: 'set',
      ns: 'permission',
      path: ['defaultPreset'],
      value: 'read-only',
    });
    assert.deepEqual(parseSettingsArgs('reset shell.timeoutMs', names), {
      op: 'unset',
      ns: 'shell',
      path: ['timeoutMs'],
    });
    assert.deepEqual(parseSettingsArgs('', names), { op: 'show' });
  });

  test('an unknown namespace, a /models one, or no value is refused', () => {
    assert.match(parseSettingsArgs('nope.x 1', names).error, /no namespace/);
    assert.match(parseSettingsArgs('llm-pi-ai.providers {}', names).error, /\/models/);
    assert.match(parseSettingsArgs('shell.timeoutMs', names).error, /usage/);
  });
});
