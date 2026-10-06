/**
 * The instruction files the agent works from (dsh-agent-instructions, in
 * dsh-base): the user's $DSH_HOME/AGENTS.md, then every AGENTS.md or
 * CLAUDE.md (and their .local.md overlays) from the project root (.git) down
 * to the session's folder, sent to the model with the first request; a file
 * in a deeper folder joins once the agent reads or writes there, and an edit
 * or a removal is sent at the next touch. Nothing on screen said any of it.
 *
 * The harness records each change on the message it sends — source kind
 * "agent-instructions", a path and set/replace/remove per file — and this
 * folds those into the files the agent has now.
 */

/**
 * @param {ReadonlyMap<string, {scope: string}>} files
 * @param {{type?: string, data?: any}} event
 * @returns {{files: ReadonlyMap<string, {scope: string}>, changed: Array<{action: string, path: string}>}}
 */
export function foldInstructions(files, event) {
  const src = event?.data?.source;
  if (
    event?.type !== 'user/message' ||
    src?.kind !== 'agent-instructions' ||
    !Array.isArray(src.changes)
  ) {
    return { files, changed: [] };
  }
  const next = new Map(files);
  const changed = [];
  for (const c of src.changes) {
    if (typeof c?.path !== 'string') {
      continue;
    }
    if (c.action === 'remove') {
      next.delete(c.path);
    } else {
      next.set(c.path, { scope: String(c.scope ?? '') });
    }
    changed.push({ action: String(c.action), path: c.path });
  }
  return { files: next, changed };
}

/** A line for the transcript when files join, change or leave. */
export function changesText(changed) {
  if (changed.length === 0) {
    return undefined;
  }
  const verb = { set: '+', replace: '~', remove: '−' };
  return `📘 instructions ${changed.map(c => `${verb[c.action] ?? ''}${c.path}`).join('  ')}`;
}

/** What /instructions says. */
export function instructionsText(files) {
  if (files.size === 0) {
    return [
      'no instruction files in this session.',
      'The agent reads, and keeps up to date as it works:',
      '  ~/.dsh/AGENTS.md                yours, for every project',
      '  AGENTS.md or CLAUDE.md          in the project root (where .git is) and',
      '                                  in each folder down to where dsh runs',
      '  AGENTS.local.md, CLAUDE.local.md  the same, kept out of git',
      'A CLAUDE.md that repeats its AGENTS.md is sent once.',
    ].join('\n');
  }
  return [
    'instruction files the agent has:',
    ...[...files.entries()].map(([path, f]) => `  📘 ${path}${f.scope ? `  (${f.scope})` : ''}`),
    '',
    'deeper folders add theirs as the agent works in them; edits reach it at its next read or write.',
  ].join('\n');
}
