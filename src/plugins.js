/**
 * /plugins: what the harness has loaded, read-only — the web app's Plugin
 * list (dsh-client-ui-settings-plugin-inventory over dsh-host-plugin-
 * inventory), read the same way: the Loader's entries, groups left out,
 * each with its module, whether it is enabled and its fiber's phase.
 * Failures come first, since they are why one opens the list.
 */

/** Cordis's FiberState, as dsh-host-plugin-inventory mirrors it. */
const PHASE = ['pending', 'loading', 'active', 'failed', null, 'unloading'];

/**
 * The inventory rows from the Loader's entries.
 * @param {Iterable<{id: string, disabled?: boolean, options?: {name?: string, group?: boolean}, fiber?: {state?: number}}>} entries
 */
export function inventory(entries) {
  const out = [];
  for (const e of entries) {
    if (e.options?.group) {
      continue;
    }
    out.push({
      id: String(e.id),
      module: String(e.options?.name ?? '?'),
      enabled: !e.disabled,
      phase: e.fiber === undefined ? null : (PHASE[e.fiber.state] ?? null),
    });
  }
  return out;
}

/**
 * What /plugins says; with a filter, the matching plugins one per line.
 * @param {ReturnType<typeof inventory>} rows
 * @param {string} filter
 * @param {number} width
 */
export function pluginsText(rows, filter, width) {
  const f = filter.trim().toLowerCase();
  if (f !== '') {
    const hits = rows.filter(r => `${r.id} ${r.module}`.toLowerCase().includes(f));
    if (hits.length === 0) {
      return `no plugin matches "${filter.trim()}".`;
    }
    return hits
      .map(
        r =>
          `  ${mark(r)} ${shown(r.id).padEnd(28)} ${(r.enabled ? (r.phase ?? 'not loaded') : 'off').padEnd(10)} ${r.module}`,
      )
      .join('\n');
  }
  const failed = rows.filter(r => r.phase === 'failed');
  const off = rows.filter(r => !r.enabled);
  const active = rows.filter(r => r.enabled && r.phase === 'active');
  const other = rows.filter(r => r.enabled && r.phase !== 'active' && r.phase !== 'failed');
  const out = [
    `plugins: ${active.length} active · ${off.length} off · ${failed.length} failed${other.length ? ` · ${other.length} loading or not loaded` : ''}`,
  ];
  for (const r of failed) {
    out.push(`  ✗ ${shown(r.id)} (${r.module}) failed to load`);
  }
  const list = (label, rs) => {
    if (rs.length > 0) {
      out.push(
        ...wrap(`${label} ${rs.map(r => shown(r.id)).join(', ')}`, Math.max(30, width - 4)).map(
          l => `  ${l}`,
        ),
      );
    }
  };
  list('○ off:', off);
  list('… not active:', other);
  list('● active:', active);
  out.push('', '/plugins <text> shows the matching ones with their modules.');
  return out.join('\n');
}

/**
 * An entry id as shown: the profile's root group prefixes every entry with
 * `include:`, which says nothing in a list where all of them have it.
 */
function shown(id) {
  return id.replace(/^include:/, '');
}

function mark(r) {
  if (!r.enabled) {
    return '○';
  }
  return r.phase === 'active' ? '●' : r.phase === 'failed' ? '✗' : '…';
}

function wrap(text, width) {
  const lines = [];
  let line = '';
  for (const word of text.split(' ')) {
    if (line !== '' && line.length + 1 + word.length > width) {
      lines.push(line);
      line = `  ${word}`;
    } else {
      line = line === '' ? word : `${line} ${word}`;
    }
  }
  if (line !== '') {
    lines.push(line);
  }
  return lines;
}
