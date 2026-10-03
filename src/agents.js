/**
 * This session's subagents, for /agents: the web app's descendant catalog
 * (dsh-client-ui-subagent) as rows of the picker. The tree is the
 * harness's (subagents.listDescendants, pre-order with depth); a row is
 * indented by its depth and says its mode and whether it is running.
 */

/**
 * @param {ReadonlyArray<{kind: string, id: string, depth?: number, mode?: string, label?: string, activity?: string, hasChildren?: boolean}>} entries
 * @returns {Array<{id?: string, label: string, description: string, mode?: string}>}
 */
export function agentRows(entries) {
  const seen = new Map();
  return entries.map(e => {
    const indent = '  '.repeat(Math.max(0, (e.depth ?? 1) - 1));
    const name = (e.label ?? '').replace(/\s+/g, ' ').trim() || e.id;
    let label = `${indent}${name.length > 60 ? name.slice(0, 59) + '…' : name}`;
    // The picker answers with the label: two alike are told apart.
    const n = (seen.get(label) ?? 0) + 1;
    seen.set(label, n);
    if (n > 1) {
      label = `${label} (${n})`;
    }
    if (e.kind !== 'child') {
      return { label, description: 'cannot be read' };
    }
    return {
      id: e.id,
      label,
      mode: e.mode,
      description: [e.mode, e.activity === 'running' ? 'running' : 'done']
        .filter(Boolean)
        .join(' · '),
    };
  });
}
