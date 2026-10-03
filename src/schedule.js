/**
 * The session's reminders (dsh-schedule, opt-in: overlays/schedule.yml),
 * for /schedule and the footer: the web app's read-only reminder catalog
 * (dsh-client-ui-schedule), folded from the session's own schedule/change
 * events. A one-shot reminder goes when it is dispatched; a repeating one
 * stays until it is cancelled.
 */

/** @typedef {{id: string, kind: string, prompt: string, scheduledAt: string, afterSeconds?: number, everySeconds?: number, lastAt?: string}} Reminder */

/**
 * @param {readonly Reminder[]} reminders
 * @param {{type?: string, data?: any}} event
 * @returns {readonly Reminder[]}
 */
export function foldSchedule(reminders, event) {
  if (event?.type !== 'schedule/change') {
    return reminders;
  }
  const d = event.data ?? {};
  switch (d.operation) {
    case 'create':
      return typeof d.schedule?.id === 'string'
        ? [...reminders.filter(r => r.id !== d.schedule.id), { ...d.schedule }]
        : reminders;
    case 'delete':
      return reminders.filter(r => r.id !== d.id);
    case 'dispatch': {
      const r = reminders.find(x => x.id === d.id);
      if (r === undefined) {
        return reminders;
      }
      return r.kind === 'every'
        ? reminders.map(x => (x.id === d.id ? { ...x, lastAt: d.acceptedAt } : x))
        : reminders.filter(x => x.id !== d.id);
    }
    default:
      return reminders;
  }
}

function minutes(seconds) {
  if (seconds % 3600 === 0) {
    return `${seconds / 3600}h`;
  }
  return seconds % 60 === 0 ? `${seconds / 60}m` : `${seconds}s`;
}

/**
 * The next time a reminder is due: its target, or for a repeating one the
 * next step of its interval after now.
 * @param {Reminder} r
 * @param {number} now
 */
export function nextDue(r, now) {
  const base = Date.parse(r.scheduledAt);
  if (r.kind !== 'every' || !(r.everySeconds > 0)) {
    return base;
  }
  const step = r.everySeconds * 1000;
  return now <= base ? base : base + Math.ceil((now - base) / step) * step;
}

/**
 * What /schedule says.
 * @param {readonly Reminder[]} reminders
 * @param {number} now
 * @param {(ms: number) => string} [clock] how a time is written
 */
export function scheduleText(reminders, now, clock = ms => new Date(ms).toLocaleString()) {
  if (reminders.length === 0) {
    return 'no reminders in this session. (They need overlays/schedule.yml.)';
  }
  const rows = [...reminders]
    .sort((a, b) => nextDue(a, now) - nextDue(b, now))
    .map(r => {
      const due = nextDue(r, now);
      const when = due < now ? `overdue since ${clock(due)}` : `at ${clock(due)}`;
      const every = r.kind === 'every' ? ` · every ${minutes(r.everySeconds)}` : '';
      return `  ⏰ ${when}${every} — ${r.prompt.replace(/\s+/g, ' ')}`;
    });
  return ['reminders:', ...rows].join('\n');
}

/**
 * The reminder a due-reminder message carries: dsh-schedule wraps it in an
 * envelope for the model ("[SCHEDULE REMINDER] … reminder_prompt_json:
 * "…""), and the person is shown only what they asked to be reminded of.
 * @param {string} text
 */
export function reminderPrompt(text) {
  const m = /^reminder_prompt_json: (".*")$/mu.exec(text);
  if (m === null) {
    return text.trim();
  }
  try {
    return String(JSON.parse(m[1]));
  } catch {
    return m[1];
  }
}
