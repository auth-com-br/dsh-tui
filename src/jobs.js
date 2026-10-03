/**
 * This session's background jobs, for the footer and /jobs: the web app's
 * read-only job list (dsh-client-ui-jobs). Nothing here reads a job's
 * output: the registry's read() takes the next stream delta and marks the
 * job reported, which is the model's (job_output) — a read by the TUI would
 * take output, and the completion notice, from the agent.
 */

/** @typedef {{id: string, kind?: string, label: string, status: string, detail?: string, startedAt: number, finishedAt?: number}} Job */

const LIVE = new Set(['running', 'stopping']);

/**
 * The footer's count of jobs still going, or '' when none is.
 * @param {readonly Job[]} jobs
 */
export function jobsBadge(jobs) {
  const n = jobs.filter(j => LIVE.has(j.status)).length;
  return n === 0 ? '' : `jobs: ${n} running`;
}

function elapsed(ms) {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) {
    return `${s}s`;
  }
  const m = Math.floor(s / 60);
  return m < 60
    ? `${m}m${String(s % 60).padStart(2, '0')}s`
    : `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}m`;
}

/**
 * What /jobs says: the running first, then the settled, each with how long
 * it ran and the producer's detail (an exit code).
 * @param {readonly Job[]} jobs
 * @param {number} now
 */
export function jobsText(jobs, now) {
  if (jobs.length === 0) {
    return 'this session has no background jobs.';
  }
  const rows = [...jobs]
    .sort(
      (a, b) =>
        Number(LIVE.has(b.status)) - Number(LIVE.has(a.status)) || b.startedAt - a.startedAt,
    )
    .map(j => {
      const took = elapsed((j.finishedAt ?? now) - j.startedAt);
      const mark = LIVE.has(j.status) ? '●' : j.status === 'completed' ? '✓' : '✗';
      const detail = j.detail ? ` (${j.detail})` : '';
      return `  ${mark} ${j.id.padEnd(10)} ${j.status.padEnd(9)} ${took.padStart(7)}  ${j.label.replace(/\s+/g, ' ')}${detail}`;
    });
  return [
    'background jobs:',
    ...rows,
    '',
    "their output is the agent's to read (job_output).",
  ].join('\n');
}
