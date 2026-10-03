/**
 * The files a turn changed, listed when it ends. Ported from the web app's
 * deliverables row (dsh-client-ui-deliverables): the list comes from the
 * successful calls of the first-party mutation tools — write, edit, and
 * str_replace_editor's create, str_replace and insert — never from what
 * the model says, so a file is listed whether or not the model named it.
 * Reads, failed calls and other tools add nothing; a path is listed once,
 * in the order first written.
 */

const isRecord = v => typeof v === 'object' && v !== null && !Array.isArray(v);
const pathValue = v => (typeof v === 'string' && v.trim().length > 0 ? v : null);

/**
 * The path a mutation call writes, or null for any other call.
 * @param {string} name the tool's wire name
 * @param {string} argsRaw the call's JSON arguments
 */
export function mutationPath(name, argsRaw) {
  let args;
  try {
    args = JSON.parse(argsRaw);
  } catch {
    return null;
  }
  if (!isRecord(args)) {
    return null;
  }
  switch (name) {
    case 'write':
      return typeof args.content === 'string' ? pathValue(args.file_path) : null;
    case 'edit':
      return typeof args.old_string === 'string' &&
        args.old_string.length > 0 &&
        typeof args.new_string === 'string' &&
        args.old_string !== args.new_string &&
        (args.replace_all === undefined || typeof args.replace_all === 'boolean')
        ? pathValue(args.file_path)
        : null;
    case 'str_replace_editor': {
      const path = pathValue(args.path);
      if (path === null) {
        return null;
      }
      switch (args.command) {
        case 'create':
          return typeof args.file_text === 'string' ? path : null;
        case 'str_replace':
          return typeof args.old_str === 'string' &&
            args.old_str.length > 0 &&
            (args.new_str === undefined || typeof args.new_str === 'string')
            ? path
            : null;
        case 'insert':
          return Number.isInteger(args.insert_line) &&
            args.insert_line >= 0 &&
            typeof args.new_str === 'string'
            ? path
            : null;
        default:
          return null;
      }
    }
    default:
      return null;
  }
}

/** @typedef {{calls: Map<string, string | null>, produced: string[]}} Deliverables */

/** @returns {Deliverables} */
export function newDeliverables() {
  return { calls: new Map(), produced: [] };
}

/**
 * Fold one session event in: a turn starts afresh, a call is remembered,
 * its successful result adds its path.
 * @param {Deliverables} state
 * @param {{type?: string, data?: any}} event
 * @returns {Deliverables}
 */
export function foldDeliverables(state, event) {
  const data = event?.data;
  switch (event?.type) {
    case 'turn/start':
      return newDeliverables();
    case 'tool/call': {
      if (typeof data?.callId !== 'string' || typeof data.name !== 'string') {
        return state;
      }
      const calls = new Map(state.calls);
      calls.set(
        data.callId,
        mutationPath(data.name, typeof data.arguments === 'string' ? data.arguments : ''),
      );
      return { ...state, calls };
    }
    case 'tool/result': {
      const message = data?.message;
      const callId = typeof data?.callId === 'string' ? data.callId : message?.source?.callId;
      const block = Array.isArray(message?.content)
        ? message.content.find(b => b?.type === 'tool-result')
        : undefined;
      if (data?.error !== undefined || block?.isError === true) {
        return state;
      }
      const path = state.calls.get(String(callId));
      if (!path || state.produced.includes(path)) {
        return state;
      }
      return { ...state, produced: [...state.produced, path] };
    }
    default:
      return state;
  }
}

/**
 * The line a turn ends with when it changed files, or undefined. The paths
 * are shown relative to the session's directory when they are in it.
 * @param {readonly string[]} produced
 * @param {string} cwd
 * @param {number} width
 */
export function deliverablesText(produced, cwd, width) {
  if (produced.length === 0) {
    return undefined;
  }
  const base = cwd.endsWith('/') ? cwd : `${cwd}/`;
  // One file written by its absolute path and edited by its relative one
  // is one file.
  const shown = [
    ...new Set(
      produced.map(p => (p.startsWith(base) ? p.slice(base.length) : p.replace(/^\.\//, ''))),
    ),
  ];
  const head = `✎ ${shown.length === 1 ? '1 file' : `${shown.length} files`} changed: `;
  const w = Math.max(20, width - 4);
  let text = head;
  for (const [i, p] of shown.entries()) {
    const sep = i === 0 ? '' : ' · ';
    const rest = shown.length - i;
    const more = rest > 1 ? ` · +${rest - 1} more` : '';
    if ((text + sep + p).length + (rest > 1 ? more.length : 0) > w && i > 0) {
      return `${text} · +${rest} more`;
    }
    text += sep + p;
  }
  return text;
}
