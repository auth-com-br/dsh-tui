import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { approvalLines, approvalOutcome } from '../src/ui.js';

/**
 * The approval prompt that takes the composer's place while the harness asks
 * whether an action may run. Without it, a session with approval policy
 * `ask` could never be allowed anything outside its workspace.
 */

describe('approvalLines', () => {
  test('says what is asked, the action, why, and the keys', () => {
    const lines = approvalLines(
      {
        toolName: 'bash',
        args: '{"command":"echo hi > /home/u/x"}',
        reason: 'writes outside the workspace',
      },
      80,
    );
    assert.match(lines[0], /approval needed · bash/, 'tend reads "approval needed" as waiting');
    assert.ok(
      lines.some(l => l.includes('/home/u/x')),
      'the action itself is shown',
    );
    assert.ok(
      lines.some(l => l.includes('writes outside the workspace')),
      'the reason is shown',
    );
    assert.match(lines.at(-1), /y allow once · n reject/);
  });

  test('a long action is cut to the width, on one line', () => {
    const lines = approvalLines(
      { toolName: 'bash', args: 'x'.repeat(500) + '\n' + 'y'.repeat(50) },
      60,
    );
    for (const line of lines) {
      assert.ok(line.length <= 60, `line fits: ${line.length}`);
      assert.ok(!line.includes('\n'));
    }
  });

  test('no arguments and no reason leave only the question and the keys', () => {
    assert.equal(approvalLines({ toolName: 'edit' }, 80).length, 2);
  });
});

describe('approvalOutcome', () => {
  test('y allows once, n and esc reject', () => {
    assert.equal(approvalOutcome('y', {}), 'allowed-once');
    assert.equal(approvalOutcome('Y', {}), 'allowed-once');
    assert.equal(approvalOutcome('n', {}), 'rejected');
    assert.equal(approvalOutcome('', { escape: true }), 'rejected');
  });

  test('any other key answers nothing, so nothing is allowed by accident', () => {
    for (const input of ['', 'a', ' ', 'yes', '\r']) {
      assert.equal(approvalOutcome(input, {}), null, `${JSON.stringify(input)} does not answer`);
    }
  });
});

describe('pickModel and helpText', async () => {
  const { pickModel, helpText } = await import('../src/ui.js');
  const models = [
    { provider: 'bonsai', model: 'Qwen' },
    { provider: 'a', model: 'same' },
    { provider: 'b', model: 'same' },
  ];

  test('provider/model names one model; a model id alone only when one route has it', () => {
    assert.deepEqual(pickModel(models, 'bonsai/Qwen'), models[0]);
    assert.deepEqual(pickModel(models, 'Qwen'), models[0]);
    assert.equal(pickModel(models, 'same'), undefined, 'two routes have it: ambiguous');
    assert.equal(pickModel(models, 'nothing'), undefined);
  });

  test('the help lists the harness commands with their input hints', () => {
    const text = helpText([
      { name: 'permission', description: 'switch', input: { hint: '<preset>' } },
    ]);
    assert.match(text, /harness commands:/);
    assert.match(text, /\/permission <preset>\s+switch/);
  });
});
