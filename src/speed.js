/**
 * Tokens spent and how fast the model writes them. The harness reports a
 * step's tokens when its message is done (assistant/message usage); while
 * it streams there are only characters. So:
 *
 * - a finished step's speed is its output tokens over the time from its
 *   first streamed piece to its message — the writing, not the time the
 *   model spent reading the context before it, which on a long session is
 *   most of the wait;
 * - while it streams, the speed is estimated from the characters so far, at
 *   about four to a token, and shown as such (~);
 * - the session's totals add every step's usage, a resumed session's past
 *   included.
 */

/** About this many characters make a token, for the live estimate. */
export const CHARS_PER_TOKEN = 4;

/** @typedef {{input: number, output: number, cache: number}} Totals */
/** @typedef {{first?: number, chars: number, totals: Totals, rate?: number}} Speed */

/** @returns {Speed} */
export function newSpeed() {
  return { first: undefined, chars: 0, totals: { input: 0, output: 0, cache: 0 } };
}

/**
 * Fold one session event in. `rate` is set on the step's message: its
 * output tokens per second.
 * @param {Speed} s
 * @param {{type?: string, time?: number, data?: any}} event
 * @param {number} now used when the event has no time
 * @returns {Speed}
 */
export function foldSpeed(s, event, now) {
  const t = typeof event?.time === 'number' ? event.time : now;
  const d = event?.data ?? {};
  switch (event?.type) {
    case 'step/start':
      return { ...s, first: undefined, chars: 0, rate: undefined };
    case 'assistant/chunk': {
      const c = d.chunk ?? {};
      const piece =
        (c.type === 'text-delta' || c.type === 'reasoning-delta') && typeof c.text === 'string'
          ? c.text
          : c.type === 'tool-call-delta' && typeof c.argumentsDelta === 'string'
            ? c.argumentsDelta
            : '';
      if (piece === '') {
        return s;
      }
      return { ...s, first: s.first ?? t, chars: s.chars + piece.length };
    }
    case 'assistant/message': {
      const u = d.usage ?? {};
      const out = Number.isFinite(u.outputTokens) ? u.outputTokens : 0;
      const seconds = s.first === undefined ? 0 : (t - s.first) / 1000;
      return {
        ...s,
        rate: out > 0 && seconds >= 0.2 ? out / seconds : undefined,
        totals: {
          input: s.totals.input + (Number.isFinite(u.inputTokens) ? u.inputTokens : 0),
          output: s.totals.output + out,
          cache: s.totals.cache + (Number.isFinite(u.cacheReadTokens) ? u.cacheReadTokens : 0),
        },
      };
    }
    default:
      return s;
  }
}

/**
 * The live estimate while a step streams, or undefined before a second of
 * it has come.
 * @param {Speed} s
 * @param {number} now
 */
export function liveRate(s, now) {
  if (s.first === undefined) {
    return undefined;
  }
  const seconds = (now - s.first) / 1000;
  return seconds >= 1 ? s.chars / CHARS_PER_TOKEN / seconds : undefined;
}

/** A count as people read it: 980, 12.3k, 1.2M. */
export function fmtCount(n) {
  if (n < 1000) {
    return String(Math.round(n));
  }
  if (n < 1e6) {
    return `${(n / 1000).toFixed(n < 1e4 ? 1 : 0)}k`;
  }
  return `${(n / 1e6).toFixed(1)}M`;
}

/** A speed: 38 tok/s, 6.4 tok/s. */
export function fmtRate(r) {
  return `${r >= 10 ? Math.round(r) : r.toFixed(1)} tok/s`;
}

/**
 * The session's totals for the footer, or '' before anything was spent.
 * @param {Totals} t
 */
export function totalsText(t) {
  if (t.input + t.output + t.cache === 0) {
    return '';
  }
  return `↑${fmtCount(t.input)} ↓${fmtCount(t.output)}${t.cache > 0 ? ` ⟳${fmtCount(t.cache)}` : ''} tokens`;
}
