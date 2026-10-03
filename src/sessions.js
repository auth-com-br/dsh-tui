/**
 * Sessions: the TUI's own command line (--resume), the list of this
 * directory's sessions to resume, and how one is named in that list. The
 * harness keeps sessions on disk (sessionPersistence); resuming one is
 * `agents.resume`, done in index.js.
 */

/**
 * The TUI's arguments — what follows `dsh --profile tui`, through dsh-cmdline:
 *   --resume <id>      resume that session
 *   --resume, -c, --continue   resume this directory's latest session
 *   -h, --help         say this and exit
 * @param {readonly string[]} args
 * @returns {{resume?: string | true, help?: boolean, error?: string}}
 */
export function parseArgs(args) {
  const out = {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '-h' || a === '--help') {
      out.help = true;
    } else if (a === '-c' || a === '--continue') {
      out.resume = true;
    } else if (a === '--resume' || a === '-r') {
      const next = args[i + 1];
      if (next !== undefined && !next.startsWith('-')) {
        out.resume = next;
        i++;
      } else {
        out.resume = true;
      }
    } else if (a.startsWith('--resume=')) {
      out.resume = a.slice('--resume='.length) || true;
    } else {
      out.error = `unknown argument ${a} — dsh --profile tui --help`;
    }
  }
  return out;
}

export const USAGE = [
  'usage: dsh --profile tui [--resume [id] | -c]',
  '',
  '  --resume <id>        resume that session',
  '  --resume, -c         resume the latest session of this directory',
  '  -h, --help           this help',
  '',
  "In the TUI, /sessions lists this directory's sessions to resume.",
].join('\n');

/**
 * A session's name: its title (the harness names sessions after their first
 * request, and a title model may rename them), else its first message.
 * @param {readonly {type: string, data?: any}[]} events
 */
export function titleOf(events) {
  let title;
  let first;
  for (const e of events) {
    if (e.type === 'session/title' && typeof e.data?.title === 'string') {
      title = e.data.title;
    }
    if (first === undefined && e.type === 'user/message' && e.data?.source?.kind === 'user') {
      const text = (e.data.content ?? []).find(c => c.type === 'text')?.text;
      if (typeof text === 'string' && text.trim() !== '') {
        first = text.trim().replace(/\s+/g, ' ');
      }
    }
  }
  return title ?? first ?? '(empty session)';
}

/**
 * How many messages the user wrote in a session.
 * @param {readonly {type: string, data?: any}[]} events
 */
export function userMessages(events) {
  return events.filter(e => e.type === 'user/message' && e.data?.source?.kind === 'user').length;
}

/**
 * This directory's sessions, newest first, each with its title: subagent
 * sessions and other directories' are left out, as the ACP list leaves them,
 * and so are sessions nobody wrote in — opened and quit, there is nothing to
 * resume, and the newest of them would hide the one meant.
 * @param {{list: (signal?: AbortSignal) => Promise<any[]>, load: (id: string) => Promise<{events: readonly any[]}>}} persistence
 * @param {string} cwd
 * @param {{limit?: number, skip?: string}} [opts] skip: the session open now
 */
export async function listSessions(persistence, cwd, opts = {}) {
  const limit = opts.limit ?? 20;
  const headers = (await persistence.list())
    .filter(
      h =>
        h.cwd === cwd &&
        h.origin !== 'subagent' &&
        h.parentSession === undefined &&
        h.id !== opts.skip,
    )
    .sort((a, b) => b.createdAt - a.createdAt);
  const out = [];
  for (const h of headers) {
    if (out.length >= limit) {
      break;
    }
    let events;
    try {
      events = (await persistence.load(h.id)).events;
    } catch {
      // A session that cannot be read is still listed, to be resumed or not.
      out.push({ id: h.id, createdAt: h.createdAt, title: '(unreadable)', messages: 0 });
      continue;
    }
    const messages = userMessages(events);
    if (messages === 0) {
      continue;
    }
    out.push({ id: h.id, createdAt: h.createdAt, title: titleOf(events), messages });
  }
  return out;
}

/**
 * When a session was made, said briefly: the time today, the weekday this
 * week, the date before that.
 * @param {number} createdAt
 * @param {number} now
 */
export function whenOf(createdAt, now) {
  const d = new Date(createdAt);
  const pad = n => String(n).padStart(2, '0');
  const time = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const day = 24 * 60 * 60 * 1000;
  const n = new Date(now);
  if (d.toDateString() === n.toDateString()) {
    return `today ${time}`;
  }
  if (now - createdAt < 6 * day) {
    return `${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getDay()]} ${time}`;
  }
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
