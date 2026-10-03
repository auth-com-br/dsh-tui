/**
 * The menu shown while a `/` command is typed: the TUI's own commands, the
 * harness's (dsh-commands) and the user-invocable skills, filtered by what
 * follows the `/`. Pure: the App holds the state and applies a pick.
 *
 * Ported from the web app's `/` source (dsh-client-ui-commands): command
 * names are matched by an ordered, case-insensitive subsequence, prefixes
 * first, then by score; skills (dsh-client-ui-skill) by prefix, after the
 * commands. As there, picking a command that takes an argument, or a skill,
 * puts `/name ` in the composer to be finished — a skill is loaded by the
 * harness from the `/name` token in the sent message (dsh-tool-skill) — and
 * picking a bare command runs it.
 */

const MAX_ROWS = 8;

/** Extra weight for name starts and separator boundaries. */
function boundaryBonus(name, index) {
  return index === 0 || name.charAt(index - 1) === '-' || name.charAt(index - 1) === '_' ? 8 : 0;
}

/**
 * The strongest ordered-subsequence alignment of `query` in `name`, or
 * undefined when there is none. The web app's scoring: boundary and adjacent
 * matches earn weight, skipped and leading characters cost it.
 * @param {string} name
 * @param {string} query
 */
export function fuzzyScore(name, query) {
  if (query === '') {
    return 0;
  }
  if (query.length > name.length) {
    return undefined;
  }
  const none = Number.NEGATIVE_INFINITY;
  let previous = Array(name.length).fill(none);
  for (let i = 0; i < name.length; i++) {
    if (name.charAt(i) === query.charAt(0)) {
      previous[i] = 1 + boundaryBonus(name, i) - i;
    }
  }
  for (let q = 1; q < query.length; q++) {
    const current = Array(name.length).fill(none);
    let bestGapped = none;
    for (let i = 0; i < name.length; i++) {
      const gapped = i - 2;
      if (gapped >= 0 && previous[gapped] !== none) {
        bestGapped = Math.max(bestGapped, previous[gapped] + gapped);
      }
      if (name.charAt(i) !== query.charAt(q)) {
        continue;
      }
      const bonus = 1 + boundaryBonus(name, i);
      const adjacent = i > 0 ? previous[i - 1] : none;
      if (adjacent !== none) {
        current[i] = adjacent + bonus + 4;
      }
      if (bestGapped !== none) {
        current[i] = Math.max(current[i], bestGapped + bonus + 1 - i);
      }
    }
    previous = current;
  }
  const best = Math.max(...previous);
  return best === none ? undefined : best;
}

/**
 * Entries whose name matches, prefixes first, then by score, then in the
 * order given.
 * @template {{name: string}} T
 * @param {readonly T[]} entries
 * @param {string} rawQuery
 * @returns {T[]}
 */
export function fuzzyFilter(entries, rawQuery) {
  const query = rawQuery.toLowerCase();
  if (query === '') {
    return [...entries];
  }
  const ranked = [];
  entries.forEach((entry, index) => {
    const name = entry.name.toLowerCase();
    const score = fuzzyScore(name, query);
    if (score !== undefined) {
      ranked.push({ entry, index, prefix: name.startsWith(query), score });
    }
  });
  ranked.sort(
    (a, b) => Number(b.prefix) - Number(a.prefix) || b.score - a.score || a.index - b.index,
  );
  return ranked.map(r => r.entry);
}

/**
 * What the menu filters by: the text after a leading `/`, while the line is
 * still a single word. undefined when no menu is shown.
 * @param {string} input
 */
export function menuQuery(input) {
  if (!input.startsWith('/') || /\s/.test(input)) {
    return undefined;
  }
  return input.slice(1);
}

/**
 * The name a `/` line leads with: "/goal ship it" is "goal".
 * @param {string} text
 */
export function leadingName(text) {
  return text.trim().slice(1).split(/\s/)[0];
}

/**
 * @typedef {{name: string, description: string, kind: 'command' | 'skill', takesInput?: boolean, hint?: string}} MenuEntry
 */

/**
 * The menu's rows for a query: the commands (the TUI's and the harness's,
 * one row per name) fuzzy-ranked, then the skills whose name starts with it;
 * a name equal to the query first.
 * @param {{commands: readonly MenuEntry[], skills: readonly MenuEntry[]}} catalog
 * @param {string} query
 * @returns {MenuEntry[]}
 */
export function menuRows(catalog, query) {
  const seen = new Set();
  const commands = catalog.commands.filter(c => {
    if (seen.has(c.name)) {
      return false;
    }
    seen.add(c.name);
    return true;
  });
  const q = query.toLowerCase();
  const skills = catalog.skills.filter(
    s => !seen.has(s.name) && s.name.toLowerCase().startsWith(q),
  );
  const rows = [...fuzzyFilter(commands, query), ...skills];
  // A name typed whole is the one meant, ahead of longer names it begins
  // (/plan before /plan-mode), so enter runs what was typed.
  const exact = rows.findIndex(r => r.name.toLowerCase() === q);
  return exact > 0 ? [rows[exact], ...rows.slice(0, exact), ...rows.slice(exact + 1)] : rows;
}

/**
 * What picking a row does: put `/name ` in the composer to be finished
 * (a skill, or a command that takes an argument), or run `/name`.
 * @param {MenuEntry} row
 * @returns {{insert: string} | {run: string}}
 */
export function pickRow(row) {
  if (row.kind === 'skill' || row.takesInput) {
    return { insert: `/${row.name} ` };
  }
  return { run: `/${row.name}` };
}

/**
 * The lines the menu shows: at most MAX_ROWS rows around the cursor, the
 * chosen one marked, and a count of the rest.
 * @param {readonly MenuEntry[]} rows
 * @param {number} cursor
 * @param {number} width
 * @returns {Array<{text: string, selected: boolean, dim?: boolean}>}
 */
export function menuLines(rows, cursor, width) {
  if (rows.length === 0) {
    return [];
  }
  const w = Math.max(20, width - 4);
  const cut = t => (t.length > w ? t.slice(0, w - 1) + '…' : t);
  const start = Math.min(
    Math.max(0, cursor - Math.floor(MAX_ROWS / 2)),
    Math.max(0, rows.length - MAX_ROWS),
  );
  const shown = rows.slice(start, start + MAX_ROWS);
  const nameWidth = Math.min(40, Math.max(...shown.map(r => label(r).length)) + 2);
  const out = shown.map((r, i) => {
    const here = start + i === cursor;
    const tag = r.kind === 'skill' ? 'skill · ' : '';
    return {
      text: cut(`${here ? '›' : ' '} ${label(r).padEnd(nameWidth)}${tag}${r.description}`),
      selected: here,
    };
  });
  const rest = rows.length - shown.length;
  out.push({
    text: `  ↑↓ choose · tab complete · enter pick · esc close${rest > 0 ? ` · ${rest} more` : ''}`,
    selected: false,
    dim: true,
  });
  return out;
}

// A row's text: an `@` reference's own label (refs.js), else the command.
function label(row) {
  if (row.label !== undefined) {
    return row.label;
  }
  return `/${row.name}${row.hint ? ' ' + row.hint : ''}`;
}
