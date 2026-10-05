import { test } from 'node:test';
import assert from 'node:assert/strict';
import { themeBackground, loadTheme, saveTheme, prefsPath } from '../src/theme.js';

/**
 * /theme. If these regress, a light terminal the TUI could not ask gets
 * dark-theme backgrounds with no way to say otherwise, or saving the theme
 * loses the TUI's other preferences.
 */

test('light and dark are fixed; auto is what the terminal said, dark when it said nothing', () => {
  assert.equal(themeBackground('light', '#1e1e1e'), '#ffffff');
  assert.equal(themeBackground('dark', '#fafafa'), '#000000');
  assert.equal(themeBackground('auto', '#fafafa'), '#fafafa');
  assert.equal(themeBackground('auto', null), '#000000');
});

test('the theme is kept in $DSH_HOME/tui.json beside the rest', () => {
  assert.equal(prefsPath({ DSH_HOME: '/h/.dsh2', HOME: '/h' }), '/h/.dsh2/tui.json');
  assert.equal(prefsPath({ HOME: '/h' }), '/h/.dsh/tui.json');
  const files = { '/p': '{"other": 1}' };
  const fs = { read: p => files[p], write: (p, t) => (files[p] = t) };
  saveTheme('light', fs, '/p');
  assert.deepEqual(JSON.parse(files['/p']), { other: 1, theme: 'light' });
  assert.equal(loadTheme(fs.read, '/p'), 'light');
  assert.equal(
    loadTheme(() => 'not json', '/p'),
    'auto',
  );
  assert.equal(
    loadTheme(() => '{"theme": "neon"}', '/p'),
    'auto',
  );
});
