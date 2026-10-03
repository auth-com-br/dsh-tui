/**
 * Workflow runs in the transcript: the web app's run node
 * (dsh-client-ui-workflow-run) as a block that follows the run live. The
 * facts are the workflow tool's own session events — tool-workflow/
 * run-start, agent-start, agent-end, run-end — so the block shows the run,
 * its phases and each member's status, and nothing the events do not say.
 * A member's conversation is a subagent's: /agents opens it.
 */

/** @typedef {{seq: number, label: string, phase?: string, status: string}} Member */
/** @typedef {{runId: string, name: string, members: Member[], end?: string}} Run */

/**
 * Fold one event into the runs, by run id. Returns the run it changed, or
 * undefined when the event is not a workflow's.
 * @param {Map<string, Run>} runs mutated: the runs seen so far
 * @param {{type?: string, data?: any}} event
 * @returns {Run | undefined}
 */
export function foldWorkflow(runs, event) {
  const d = event?.data;
  const id = typeof d?.runId === 'string' ? d.runId : undefined;
  switch (event?.type) {
    case 'tool-workflow/run-start': {
      if (id === undefined) {
        return undefined;
      }
      const run = { runId: id, name: String(d.name ?? 'workflow'), members: [] };
      runs.set(id, run);
      return run;
    }
    case 'tool-workflow/agent-start': {
      const run = id === undefined ? undefined : runs.get(id);
      if (run === undefined) {
        return undefined;
      }
      const next = {
        ...run,
        members: [
          ...run.members,
          {
            seq: d.seq,
            label: String(d.label ?? ''),
            ...(d.phase ? { phase: d.phase } : {}),
            status: 'running',
          },
        ],
      };
      runs.set(id, next);
      return next;
    }
    case 'tool-workflow/agent-end': {
      const run = id === undefined ? undefined : runs.get(id);
      if (run === undefined) {
        return undefined;
      }
      const next = {
        ...run,
        members: run.members.map(m => (m.seq === d.seq ? { ...m, status: String(d.outcome) } : m)),
      };
      runs.set(id, next);
      return next;
    }
    case 'tool-workflow/run-end': {
      const run = id === undefined ? undefined : runs.get(id);
      if (run === undefined) {
        return undefined;
      }
      const next = { ...run, end: String(d.stopReason) };
      runs.set(id, next);
      return next;
    }
    default:
      return undefined;
  }
}

const MARK = { running: '●', completed: '✓', failed: '✗', error: '✗', cancelled: '⊘' };

/**
 * The block's text: the run and how it stands, then its members under
 * their phases, in the order they started.
 * @param {Run} run
 */
export function workflowText(run) {
  const done = run.members.filter(m => m.status === 'completed').length;
  const state = run.end ?? 'running';
  const lines = [
    `${MARK[state] ?? '●'} workflow ${run.name} · ${state} · ${done}/${run.members.length} agents done`,
  ];
  let phase;
  for (const m of run.members) {
    if (m.phase !== phase) {
      phase = m.phase;
      if (phase !== undefined) {
        lines.push(`  ${phase}`);
      }
    }
    const indent = phase === undefined ? '  ' : '    ';
    lines.push(`${indent}${MARK[m.status] ?? '·'} ${m.label} · ${m.status}`);
  }
  return lines.join('\n');
}
