/**
 * The session's standing state, shown over the composer: plan mode and the
 * goal. The web app shows them as a "Plan ×" chip (dsh-client-ui-plan) and
 * a goal strip with edit/pause/resume/clear (dsh-client-ui-goal); here they
 * are a line each, read from the session's own events — `plan/mode`
 * (dsh-plan-mode) and `goal/change` (dsh-goal) — and changed by the same
 * commands a user types, `/plan off` and `/goal …`, which the `/` menu
 * completes.
 */

/** @typedef {{objective: string, phase: string, rounds: number, max: number, blocked?: string}} Goal */
/** @typedef {{plan: boolean, goal: Goal | null}} Standing */

/** @type {Standing} */
export const NO_STANDING = { plan: false, goal: null };

/**
 * Fold one session event into the standing state. Events of other kinds,
 * and malformed ones, leave it as it was.
 * @param {Standing} state
 * @param {{type?: string, data?: any}} event
 * @returns {Standing}
 */
export function foldStanding(state, event) {
  const data = event?.data;
  switch (event?.type) {
    case 'plan/mode':
      return typeof data?.active === 'boolean' ? { ...state, plan: data.active } : state;
    case 'goal/change': {
      if (data?.operation === 'clear') {
        return { ...state, goal: null };
      }
      const g = data?.goal;
      if (typeof g?.objective !== 'string' || typeof g?.phase !== 'string') {
        return state;
      }
      return {
        ...state,
        goal: {
          objective: g.objective,
          phase: g.phase,
          rounds: Number.isInteger(data.roundsStarted) ? data.roundsStarted : 0,
          max: Number.isInteger(g.maxGoalRounds) ? g.maxGoalRounds : 0,
          ...(g.blockedReason?.message ? { blocked: g.blockedReason.message } : {}),
        },
      };
    }
    case 'user/message':
      // A goal round is a message the goal driver sends.
      if (data?.source?.kind === 'goal' && state.goal !== null) {
        return { ...state, goal: { ...state.goal, rounds: state.goal.rounds + 1 } };
      }
      return state;
    default:
      return state;
  }
}

/** The /goal commands that apply in a phase, as dsh-command-goal lists them. */
function goalCommands(phase) {
  switch (phase) {
    case 'active':
      return '/goal pause · /goal edit … · /goal clear';
    case 'paused':
    case 'blocked':
      return '/goal resume · /goal edit … · /goal clear';
    case 'complete':
      return '/goal clear';
    default:
      return '/goal';
  }
}

/**
 * The lines shown over the composer, each with a style hint: 'plan',
 * 'goal' or 'blocked'.
 * @param {Standing} state
 * @param {number} width
 * @returns {Array<{text: string, style: string}>}
 */
export function standingLines(state, width) {
  const w = Math.max(20, width - 4);
  const cut = t => (t.length > w ? t.slice(0, w - 1) + '…' : t);
  const out = [];
  if (state.plan) {
    out.push({
      text: cut('◆ plan mode — the agent plans before it acts · /plan off leaves it'),
      style: 'plan',
    });
  }
  const g = state.goal;
  if (g !== null) {
    const rounds = g.max > 0 ? ` · round ${g.rounds}/${g.max}` : '';
    const head = `◎ goal · ${g.phase}${rounds} · `;
    const tail = `  (${goalCommands(g.phase)})`;
    const room = Math.max(10, w - head.length - tail.length);
    const objective = g.objective.replace(/\s+/g, ' ');
    out.push({
      text: cut(
        head + (objective.length > room ? objective.slice(0, room - 1) + '…' : objective) + tail,
      ),
      style: 'goal',
    });
    if (g.blocked) {
      out.push({ text: cut(`  blocked: ${g.blocked}`), style: 'blocked' });
    }
  }
  return out;
}
