import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { approvalLines, approvalKey, approvalChoiceAtRow, APPROVAL_CHOICES } from '../src/ui.js';

/**
 * The approval prompt that takes the composer's place while the harness asks
 * whether an action may run. Without it, a session with approval policy
 * `ask` could never be allowed anything outside its workspace; and with only
 * a line of keys under it, the owner did not see how to answer at all.
 */

const texts = lines => lines.map(l => l.text);

describe('approvalLines', () => {
  test('says what is asked, the action, why, the answers as a menu, and the keys', () => {
    const lines = approvalLines(
      {
        toolName: 'bash',
        args: '{"command":"echo hi > /home/u/x"}',
        reason: 'writes outside the workspace',
      },
      80,
    );
    assert.match(
      lines[0].text,
      /approval needed · bash/,
      'tend reads "approval needed" as waiting',
    );
    assert.ok(
      texts(lines).some(l => l.includes('/home/u/x')),
      'the action itself is shown',
    );
    assert.ok(
      texts(lines).some(l => l.includes('writes outside the workspace')),
      'the reason is shown',
    );
    const choices = lines.filter(l => l.choice !== undefined);
    assert.deepEqual(
      choices.map(l => l.text.trim()),
      ['› 1. Allow once  (y)', '2. Reject  (n)'],
    );
    assert.equal(choices[0].style, 'selected', 'the cursor starts on the first answer');
    assert.match(lines.at(-1).text, /↑↓ · enter or click · y allow · n\/esc reject/);
  });

  test('the cursor is drawn on the answer it is on', () => {
    const lines = approvalLines({ toolName: 'edit' }, 80, 1);
    const choices = lines.filter(l => l.choice !== undefined);
    assert.equal(choices[0].style, 'row');
    assert.equal(choices[1].style, 'selected');
    assert.match(choices[1].text, /› 2\. Reject/);
  });

  test('a long action is cut to the width, on one line', () => {
    const lines = approvalLines(
      { toolName: 'bash', args: 'x'.repeat(500) + '\n' + 'y'.repeat(50) },
      60,
    );
    for (const { text } of lines) {
      assert.ok(text.length <= 60, `line fits: ${text.length}`);
      assert.ok(!text.includes('\n'));
    }
  });

  test('no arguments and no reason leave the question, the answers and the keys', () => {
    assert.equal(approvalLines({ toolName: 'edit' }, 80).length, 2 + APPROVAL_CHOICES.length);
  });
});

describe('approvalKey', () => {
  test('y allows once, n and esc reject, wherever the cursor is', () => {
    assert.equal(approvalKey(1, 'y', {}).outcome, 'allowed-once');
    assert.equal(approvalKey(1, 'Y', {}).outcome, 'allowed-once');
    assert.equal(approvalKey(0, 'n', {}).outcome, 'rejected');
    assert.equal(approvalKey(0, '', { escape: true }).outcome, 'rejected');
  });

  test('the arrows move the cursor, round the ends, and answer nothing', () => {
    assert.deepEqual(approvalKey(0, '', { downArrow: true }), { cursor: 1 });
    assert.deepEqual(approvalKey(1, '', { downArrow: true }), { cursor: 0 });
    assert.deepEqual(approvalKey(0, '', { upArrow: true }), { cursor: 1 });
  });

  test('enter takes the answer under the cursor, a digit the one it numbers', () => {
    assert.equal(approvalKey(0, '\r', { return: true }).outcome, 'allowed-once');
    assert.equal(approvalKey(1, '\r', { return: true }).outcome, 'rejected');
    assert.equal(approvalKey(1, '1', {}).outcome, 'allowed-once');
    assert.equal(approvalKey(0, '2', {}).outcome, 'rejected');
  });

  test('enter and digits typed as the prompt appeared answer nothing', () => {
    assert.equal(approvalKey(0, '\r', { return: true }, false).outcome, undefined);
    assert.equal(approvalKey(0, '1', {}, false).outcome, undefined);
  });

  test('any other key answers nothing, so nothing is allowed by accident', () => {
    for (const input of ['', 'a', ' ', 'yes', '9']) {
      assert.equal(
        approvalKey(0, input, {}).outcome,
        undefined,
        `${JSON.stringify(input)} does not answer`,
      );
    }
  });
});

describe('approvalChoiceAtRow', () => {
  test('a click on an answer gives it; elsewhere, nothing', () => {
    // 30 rows: the footer is row 30, the prompt's lines end on row 29.
    const lines = approvalLines({ toolName: 'bash', args: 'ls' }, 80);
    const first = 30 - lines.length; // the title's row
    assert.equal(approvalChoiceAtRow(lines, 30, first), undefined, 'the title');
    assert.equal(approvalChoiceAtRow(lines, 30, first + 2), 0, 'Allow once');
    assert.equal(approvalChoiceAtRow(lines, 30, first + 3), 1, 'Reject');
    assert.equal(approvalChoiceAtRow(lines, 30, 30), undefined, 'the footer');
    assert.equal(approvalChoiceAtRow(lines, 30, 3), undefined, 'the transcript');
  });
});
