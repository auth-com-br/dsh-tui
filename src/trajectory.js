/**
 * /trajectory: the last turns as a ledger with timings, the terminal's
 * version of the web app's Trajectory view (dsh-client-ui-trajectory) —
 * turns, the steps within them (one model request each), what the model
 * took and gave, and each tool call with how long it ran and whether it
 * failed. Read from the session's log; every event carries its time.
 */

/** @param {number} ms */
export function dur(ms) {
  if (!(ms >= 0)) {
    return '?';
  }
  if (ms < 60000) {
    return `${(ms / 1000).toFixed(1)}s`;
  }
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)}m${String(s % 60).padStart(2, '0')}s`;
}

const num = n => (Number.isFinite(n) ? n.toLocaleString('en-US') : '0');

/**
 * The turns in a log, each with its steps and their tools.
 * @param {ReadonlyArray<{type: string, time?: number, data?: any}>} events
 */
export function turnsOf(events) {
  const turns = [];
  let turn;
  let step;
  const calls = new Map();
  for (const e of events) {
    const d = e.data ?? {};
    switch (e.type) {
      case 'turn/start':
        turn = { start: e.time, steps: [], open: true };
        turns.push(turn);
        step = undefined;
        break;
      case 'turn/end':
        if (turn !== undefined) {
          turn.end = e.time;
          turn.open = false;
          turn.reason = d.reason?.kind;
        }
        break;
      case 'step/start':
        if (turn !== undefined) {
          step = { start: e.time, tools: [] };
          turn.steps.push(step);
        }
        break;
      case 'step/end':
        if (step !== undefined) {
          step.end = e.time;
        }
        break;
      case 'assistant/message':
        if (step !== undefined) {
          step.answered = e.time;
          step.usage = d.usage;
        }
        break;
      case 'tool/call':
        if (step !== undefined && typeof d.callId === 'string') {
          const tool = { name: String(d.name ?? 'tool'), start: e.time };
          step.tools.push(tool);
          calls.set(d.callId, tool);
        }
        break;
      case 'tool/result': {
        const id = typeof d.callId === 'string' ? d.callId : d.message?.source?.callId;
        const tool = calls.get(id);
        if (tool !== undefined) {
          tool.end = e.time;
          const block = Array.isArray(d.message?.content)
            ? d.message.content.find(b => b?.type === 'tool-result')
            : undefined;
          tool.failed = d.error !== undefined || block?.isError === true;
        }
        break;
      }
      default:
        break;
    }
  }
  return turns;
}

/**
 * The ledger of the last `count` turns.
 * @param {ReadonlyArray<{type: string, time?: number, data?: any}>} events
 * @param {number} count
 * @param {number} now for a turn still running
 */
export function trajectoryText(events, count, now) {
  const turns = turnsOf(events);
  if (turns.length === 0) {
    return 'no turns yet.';
  }
  const first = Math.max(0, turns.length - count);
  const out = [];
  for (let i = first; i < turns.length; i++) {
    const t = turns[i];
    let input = 0;
    let output = 0;
    let cache = 0;
    for (const s of t.steps) {
      input += s.usage?.inputTokens ?? 0;
      output += s.usage?.outputTokens ?? 0;
      cache += s.usage?.cacheReadTokens ?? 0;
    }
    const state = t.open ? 'running' : (t.reason ?? 'ended');
    out.push(
      `turn ${i + 1} · ${state} · ${dur((t.end ?? now) - t.start)} · ${t.steps.length} steps · ` +
        `${num(input)} in / ${num(output)} out${cache > 0 ? ` · ${num(cache)} cached` : ''}`,
    );
    t.steps.forEach((s, j) => {
      const model = s.answered !== undefined ? dur(s.answered - s.start) : 'waiting';
      const tokens = s.usage
        ? ` · ${num(s.usage.inputTokens)} in / ${num(s.usage.outputTokens)} out`
        : '';
      out.push(
        `  step ${j + 1}  ${dur((s.end ?? now) - s.start).padStart(6)}  model ${model}${tokens}`,
      );
      for (const tool of s.tools) {
        const mark = tool.end === undefined ? '…' : tool.failed ? '✗' : '✓';
        out.push(`           ${mark} ${tool.name} ${dur((tool.end ?? now) - tool.start)}`);
      }
    });
  }
  return out.join('\n');
}
