import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { newQuestions, questionKey, questionLines, answersOf } from '../src/questions.js';

/**
 * The questions the agent asks the user, answered in the composer's place.
 * If these regress, the agent's question gets no answer — or the wrong one,
 * which it then acts on.
 */

const press = (s, ...keys) =>
  keys.reduce(
    (st, k) => (typeof k === 'string' ? questionKey(st, k, {}) : questionKey(st, '', k)),
    s,
  );

const fruit = {
  id: 'q1',
  question: 'Which fruit?',
  options: [{ label: 'apple', description: 'red' }, { label: 'banana' }],
};

describe('questions', () => {
  test('enter picks the option under the cursor, the arrows move it', () => {
    const s = press(newQuestions([fruit]), { downArrow: true }, { return: true });
    assert.equal(s.done, true);
    assert.deepEqual(answersOf(s), { answers: [{ id: 'q1', selected: ['banana'] }] });
  });

  test('a number picks that option at once', () => {
    const s = press(newQuestions([fruit]), '1');
    assert.deepEqual(answersOf(s).answers, [{ id: 'q1', selected: ['apple'] }]);
  });

  test('the last row writes an answer of the user own, sent as custom', () => {
    let s = press(newQuestions([fruit]), '3');
    assert.equal(s.typing, true);
    s = press(s, 'k', 'i', 'w', 'i', { backspace: true }, 'i', { return: true });
    assert.deepEqual(answersOf(s).answers, [{ id: 'q1', selected: [], custom: 'kiwi' }]);
  });

  test('a question without options is typed straight away', () => {
    const s = press(newQuestions([{ id: 'n', question: 'Your name?' }]), 'A', 'n', 'a', {
      return: true,
    });
    assert.deepEqual(answersOf(s).answers, [{ id: 'n', selected: [], custom: 'Ana' }]);
  });

  test('multi-select marks with space or numbers and confirms with enter', () => {
    const q = { ...fruit, multiSelect: true };
    const s = press(newQuestions([q]), ' ', '2', { return: true });
    assert.deepEqual(answersOf(s).answers, [{ id: 'q1', selected: ['apple', 'banana'] }]);
  });

  test('esc skips a question and the batch goes on to the next', () => {
    const s = press(newQuestions([fruit, { ...fruit, id: 'q2' }]), { escape: true }, '2');
    assert.equal(s.done, true);
    assert.deepEqual(answersOf(s).answers, [
      { id: 'q1', selected: [] },
      { id: 'q2', selected: ['banana'] },
    ]);
  });

  test('an empty written answer is not sent', () => {
    const s = press(newQuestions([{ id: 'n', question: 'x?' }]), { return: true });
    assert.equal(s.done, undefined);
  });

  test('the lines show the question, the options, the own-answer row and the keys', () => {
    const lines = questionLines(newQuestions([fruit, fruit]), 80).map(l => l.text);
    assert.match(lines[0], /question \(1\/2\)/);
    assert.ok(lines.some(l => l.includes('Which fruit?')));
    assert.ok(lines.some(l => l.includes('1. apple — red')));
    assert.ok(lines.some(l => l.includes('write my own answer')));
    assert.match(lines.at(-1), /enter confirm/);
  });
});

describe('secret and menu questions', () => {
  test('a secret answer is typed unseen and answered as typed', () => {
    let s = newQuestions([{ id: 'key', question: 'API key', secret: true }]);
    for (const ch of 'sk-123') {
      s = questionKey(s, ch, {});
    }
    const input = questionLines(s, 80).find(l => l.style === 'input');
    assert.equal(input.text, '  ✎ ••••••█');
    s = questionKey(s, '', { return: true });
    assert.deepEqual(answersOf(s), { answers: [{ id: 'key', selected: [], custom: 'sk-123' }] });
  });

  test('a menu offers only its options', () => {
    const s = newQuestions([
      { id: 'm', question: 'Pick', custom: false, options: [{ label: 'a' }, { label: 'b' }] },
    ]);
    const rows = questionLines(s, 80).filter(l => l.style === 'row' || l.style === 'selected');
    assert.deepEqual(rows.map(r => r.text.trim()).slice(1), ['› 1. a', '2. b']);
    assert.equal(
      questionKey(questionKey(s, '', { upArrow: true }), '', { return: true }).answers[0]
        .selected[0],
      'b',
    );
  });
});
