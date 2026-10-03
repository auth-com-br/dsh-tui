import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  fuzzyFilter,
  menuQuery,
  menuRows,
  pickRow,
  menuLines,
  leadingName,
} from '../src/slashmenu.js';

/**
 * The `/` menu. If these regress, typing `/` offers the wrong commands or
 * none, enter runs a command other than the one typed, or picking a skill
 * sends it before its request is written.
 */

const cmd = (name, extra = {}) => ({ name, description: `${name} it`, kind: 'command', ...extra });
const skill = name => ({ name, description: `${name} skill`, kind: 'skill' });

describe('menuQuery', () => {
  test('the menu is open for a single /word, and closed once an argument starts', () => {
    assert.equal(menuQuery('/'), '');
    assert.equal(menuQuery('/mo'), 'mo');
    assert.equal(menuQuery('/model '), undefined);
    assert.equal(menuQuery('hello /x'), undefined);
    assert.equal(menuQuery(''), undefined);
  });
});

describe('fuzzyFilter', () => {
  test('names match by ordered subsequence, prefixes first', () => {
    const names = fuzzyFilter(
      [cmd('compact'), cmd('permission'), cmd('plan'), cmd('model')],
      'p',
    ).map(c => c.name);
    assert.deepEqual(names.slice(0, 2).sort(), ['permission', 'plan']);
    assert.ok(names.includes('compact'), 'a p inside the name still matches');
    assert.ok(!names.includes('model'));
  });

  test('matching ignores case and an empty query keeps every entry in order', () => {
    assert.deepEqual(
      fuzzyFilter([cmd('Goal')], 'GO').map(c => c.name),
      ['Goal'],
    );
    assert.deepEqual(
      fuzzyFilter([cmd('b'), cmd('a')], '').map(c => c.name),
      ['b', 'a'],
    );
  });

  test('a subsequence out of order is not a match', () => {
    assert.deepEqual(fuzzyFilter([cmd('plan')], 'np'), []);
  });
});

describe('menuRows', () => {
  test('commands come before skills, skills by prefix only, one row per name', () => {
    const rows = menuRows(
      {
        commands: [cmd('help'), cmd('help'), cmd('model')],
        skills: [skill('frontend-design'), skill('find-skills'), skill('help')],
      },
      'f',
    );
    assert.deepEqual(
      rows.map(r => r.name),
      ['frontend-design', 'find-skills'],
    );
    const all = menuRows({ commands: [cmd('help'), cmd('help')], skills: [skill('help')] }, '');
    assert.deepEqual(
      all.map(r => `${r.kind}:${r.name}`),
      ['command:help'],
    );
  });

  test('a name typed whole comes first, ahead of longer names it begins', () => {
    const rows = menuRows({ commands: [cmd('plan-mode'), cmd('plan')], skills: [] }, 'plan');
    assert.equal(rows[0].name, 'plan');
  });
});

describe('pickRow', () => {
  test('a bare command runs; one taking an argument, or a skill, is completed', () => {
    assert.deepEqual(pickRow(cmd('clear')), { run: '/clear' });
    assert.deepEqual(pickRow(cmd('goal', { takesInput: true })), { insert: '/goal ' });
    assert.deepEqual(pickRow(skill('frontend-design')), { insert: '/frontend-design ' });
  });
});

describe('menuLines', () => {
  test('marks the row under the cursor and ends with the keys', () => {
    const lines = menuLines([cmd('help'), cmd('goal', { hint: '<text>' })], 1, 80);
    assert.equal(lines.length, 3);
    assert.ok(lines[1].selected);
    assert.match(lines[1].text, /^› \/goal <text>/);
    assert.match(lines[2].text, /tab complete/);
  });

  test('a long list shows a window around the cursor and counts the rest', () => {
    const rows = Array.from({ length: 20 }, (_, i) => cmd(`c${i}`));
    const lines = menuLines(rows, 15, 80);
    assert.equal(lines.length, 9);
    assert.ok(lines.some(l => l.selected && l.text.includes('/c15')));
    assert.match(lines.at(-1).text, /12 more/);
  });

  test('no rows, no menu', () => {
    assert.deepEqual(menuLines([], 0, 80), []);
  });
});

describe('leadingName', () => {
  test('is the word after the slash, which decides command or skill', () => {
    assert.equal(leadingName('/find-skills what can you do'), 'find-skills');
    assert.equal(leadingName('  /clear  '), 'clear');
  });
});
