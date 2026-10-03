/**
 * `@` references in the composer: files of the agent's workspace and other
 * sessions, offered in the menu as `@` is typed. Pure: the App holds the
 * state, index.js asks the harness for candidates.
 *
 * Ported from the web app (dsh-client-ui-reference): files before sessions,
 * a file is path text the model reads with its tools — nothing is attached —
 * and a session is the canonical `@[label](dsh-session:…)` mention, which
 * the harness's session-reference resolver turns into a read-only snapshot
 * of that session for the model. A directory is both a reference of its own
 * (enter) and a place to go into (tab), as there.
 */

/**
 * The `@path` or `@"path with spaces` token being typed at the end of the
 * line — the cursor is at the end in this composer — or undefined. An `@`
 * inside a word (an e-mail address) is not one. dsh-file-reference/grammar's
 * activeAtToken.
 * @param {string} line
 * @returns {{prefix: string, query: string, quoted: boolean} | undefined}
 */
export function activeAtToken(line) {
  const quoted = /(?:^|\s)(@"([^"]*))$/u.exec(line);
  if (quoted !== null) {
    return { prefix: quoted[1], query: quoted[2], quoted: true };
  }
  const plain = /(?:^|\s)(@([^\s]*))$/u.exec(line);
  if (plain === null) {
    return undefined;
  }
  return { prefix: plain[1], query: plain[2], quoted: false };
}

/**
 * A path as prompt text: `@path`, or `@"path"` when it has whitespace or
 * the user opened a quote; a directory keeps its quote open after the slash
 * so completion can go on into it. undefined for a path the grammar cannot
 * carry. dsh-file-reference/grammar's formatFileMention.
 * @param {{path: string, kind: 'file' | 'directory'}} candidate
 * @param {boolean} preserveQuote
 */
export function formatFileMention(candidate, preserveQuote) {
  const path = candidate.kind === 'directory' ? `${candidate.path}/` : candidate.path;
  if (/[\u0000-\u001f\u007f-\u009f"]/u.test(path)) {
    return undefined;
  }
  if (!(preserveQuote || /\s/u.test(path))) {
    return `@${path}`;
  }
  return candidate.kind === 'directory' ? `@"${path}` : `@"${path}"`;
}

/**
 * A session's mention with a readable label: the resolver labels a session
 * whose title it has not indexed by its id, and the label is only what the
 * composer shows — the session is the URI's.
 * @param {string} mention `@[label](dsh-session:…)`
 * @param {string} label
 */
export function relabelMention(mention, label) {
  const m = /^@\[.*\]\((dsh-session:[^)\s]+)\)$/su.exec(mention);
  const clean = label
    .replace(/[[\]()\\\n\r]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (m === null || clean === '') {
    return mention;
  }
  return `@[${clean}](${m[1]})`;
}

/**
 * A message as the transcript shows it: a session mention as `@label`, as
 * the web app shows its chip; what was sent keeps the mention.
 * @param {string} text
 */
export function shownMentions(text) {
  return text.replace(/@\[([^\]\n]*)\]\(dsh-session:[^)\s]+\)/gu, (_, label) => `@${label}`);
}

/**
 * @typedef {{name: string, description: string, kind: 'file' | 'directory' | 'session', label: string, settle: string, drill?: string}} RefRow
 * settle is the text a pick puts in place of the token (enter); drill, for
 * a directory, the text that keeps completing inside it (tab).
 */

/**
 * The menu's rows: files, then sessions.
 * @param {ReadonlyArray<{path: string, kind: 'file' | 'directory'}>} files
 * @param {ReadonlyArray<{sessionId: string, label: string, mention: string, sameWorkspace: boolean, cwd?: string, when?: string}>} sessions
 * @param {boolean} quoted the user opened a quote
 * @returns {RefRow[]}
 */
export function refRows(files, sessions, quoted) {
  const out = [];
  for (const f of files) {
    const settle = formatFileMention(f, quoted);
    if (settle === undefined) {
      continue;
    }
    const slash = f.path.lastIndexOf('/');
    out.push({
      name: f.path,
      label: f.kind === 'directory' ? `${f.path}/` : f.path,
      description: f.kind === 'directory' ? 'folder' : slash > 0 ? 'file' : 'file · top level',
      kind: f.kind,
      // A settled directory is the folder itself, its quote closed like a
      // file's.
      settle: f.kind === 'directory' && settle.startsWith('@"') ? `${settle}" ` : `${settle} `,
      ...(f.kind === 'directory' ? { drill: settle } : {}),
    });
  }
  for (const s of sessions) {
    out.push({
      name: s.sessionId,
      label: s.label,
      description: ['session', s.when, s.sameWorkspace ? '' : (s.cwd ?? '')]
        .filter(Boolean)
        .join(' · '),
      kind: 'session',
      settle: `${relabelMention(s.mention, s.label)} `,
    });
  }
  return out;
}

/**
 * The line with the token replaced by a pick.
 * @param {string} line
 * @param {{prefix: string}} token
 * @param {string} text
 */
export function replaceToken(line, token, text) {
  return line.slice(0, line.length - token.prefix.length) + text;
}
