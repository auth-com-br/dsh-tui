import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { NO_STANDING, foldStanding, standingLines } from '../src/status.js';

/**
 * Plan mode and the goal over the composer. If these regress, a session in
 * plan mode or working toward a goal looks like any other, or a cleared
 * goal stays on screen.
 */

const goal = (operation, phase, extra = {}) => ({
  type: 'goal/change',
  data: {
    kind: 'goal/change',
    version: 1,
    operation,
    goal: {
      id: 'g',
      revision: 1,
      objective: 'ship the release',
      phase,
      maxGoalRounds: 256,
      ...extra,
    },
    roundsStarted: 2,
    createdAt: 1,
    updatedAt: 2,
  },
});

describe('foldStanding', () => {
  test('plan mode follows plan/mode', () => {
    let s = foldStanding(NO_STANDING, { type: 'plan/mode', data: { active: true } });
    assert.equal(s.plan, true);
    s = foldStanding(s, { type: 'plan/mode', data: { active: false } });
    assert.equal(s.plan, false);
  });

  test('a goal is set, counts its rounds, and goes when cleared', () => {
    let s = foldStanding(NO_STANDING, goal('create', 'active'));
    assert.deepEqual(s.goal, {
      objective: 'ship the release',
      phase: 'active',
      rounds: 2,
      max: 256,
    });
    s = foldStanding(s, { type: 'user/message', data: { source: { kind: 'goal' } } });
    assert.equal(s.goal.rounds, 3);
    s = foldStanding(s, { type: 'user/message', data: { source: { kind: 'user' } } });
    assert.equal(s.goal.rounds, 3);
    s = foldStanding(s, { type: 'goal/change', data: { operation: 'clear' } });
    assert.equal(s.goal, null);
  });

  test('other and malformed events leave the state as it was', () => {
    assert.equal(foldStanding(NO_STANDING, { type: 'turn/start' }), NO_STANDING);
    assert.equal(foldStanding(NO_STANDING, { type: 'goal/change', data: {} }), NO_STANDING);
    assert.equal(foldStanding(NO_STANDING, { type: 'plan/mode', data: {} }), NO_STANDING);
  });
});

describe('standingLines', () => {
  test('nothing standing, nothing shown', () => {
    assert.deepEqual(standingLines(NO_STANDING, 80), []);
  });

  test('plan mode and the goal each get a line, with the commands that apply', () => {
    const s = foldStanding(
      foldStanding(NO_STANDING, { type: 'plan/mode', data: { active: true } }),
      goal('pause', 'paused'),
    );
    const lines = standingLines(s, 120);
    assert.equal(lines.length, 2);
    assert.match(lines[0].text, /plan mode.*\/plan off/);
    assert.match(lines[1].text, /goal · paused · round 2\/256 · ship the release.*\/goal resume/);
  });

  test('a blocked goal says why', () => {
    const s = foldStanding(
      NO_STANDING,
      goal('block', 'blocked', {
        blockedReason: { code: 'needs-input', message: 'which database?' },
      }),
    );
    const lines = standingLines(s, 120);
    assert.equal(lines[1].style, 'blocked');
    assert.match(lines[1].text, /which database\?/);
  });

  test('a long objective is cut so the commands still show', () => {
    const s = foldStanding(NO_STANDING, goal('create', 'active'));
    s.goal.objective = 'x'.repeat(300);
    const [line] = standingLines(s, 80);
    assert.ok(line.text.length <= 76);
    assert.match(line.text, /…/);
  });
});
