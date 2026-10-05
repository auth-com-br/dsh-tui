/**
 * /settings: the plugins' configuration, as the web app's Plugins page
 * (dsh-client-ui-settings-plugins) edits it — each namespace a plugin
 * registers with dsh-settings, its fields, which ones the user overrode,
 * and a way to set one or put it back to what the profile composed. The
 * harness validates every write against the namespace's schema, so a value
 * it does not take is refused with its reason rather than stored.
 *
 * Model providers and keys are /models' (they hold credentials and routes);
 * this lists the rest.
 */

/** Namespaces /models owns. */
const MODELS = new Set(['llm-pi-ai', 'llm-deepseek', 'agent-default-model']);

/**
 * The leaves of a value, as dotted paths.
 * @param {unknown} value
 * @param {string[]} path
 * @param {Array<{path: string[], value: unknown}>} out
 */
function leaves(value, path = [], out = []) {
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    const keys = Object.keys(value);
    if (keys.length === 0) {
      out.push({ path, value });
    }
    for (const k of keys) {
      leaves(value[k], [...path, k], out);
    }
  } else {
    out.push({ path, value });
  }
  return out;
}

/** Whether a path is set in the user's section. */
function overridden(user, path) {
  let at = user;
  for (const k of path) {
    if (at === null || typeof at !== 'object' || !(k in at)) {
      return false;
    }
    at = at[k];
  }
  return true;
}

/**
 * What /settings says: every namespace but the models', each field with
 * its value, those the user set marked.
 * @param {ReadonlyArray<{ns: string, value?: unknown, user?: unknown, applies?: string}>} described
 */
export function settingsText(described) {
  const out = [];
  for (const d of described) {
    if (MODELS.has(d.ns)) {
      continue;
    }
    out.push(`${d.ns}${d.applies && d.applies !== 'live' ? `  (applies ${d.applies})` : ''}`);
    for (const leaf of leaves(d.value ?? {})) {
      const key = leaf.path.join('.');
      const mark = overridden(d.user, leaf.path) ? '*' : ' ';
      out.push(`  ${mark} ${key.padEnd(24)} ${JSON.stringify(leaf.value)}`);
    }
  }
  if (out.length === 0) {
    return 'no settings here.';
  }
  return [
    ...out,
    '',
    '* set by you. /settings <namespace>.<field> <value> sets one;',
    '/settings reset <namespace>.<field> puts it back. Keys and models are /models.',
  ].join('\n');
}

/**
 * The edit a /settings line asks for.
 * @param {string} args what follows `/settings`
 * @param {readonly string[]} namespaces the registered ones
 * @returns {{op: 'set', ns: string, path: string[], value: unknown} | {op: 'unset', ns: string, path: string[]} | {op: 'show'} | {error: string}}
 */
export function parseSettingsArgs(args, namespaces) {
  const text = args.trim();
  if (text === '') {
    return { op: 'show' };
  }
  const reset = /^reset\s+(\S+)$/.exec(text);
  const set = /^(\S+)\s+(.+)$/s.exec(text);
  const target = reset?.[1] ?? set?.[1];
  if (target === undefined) {
    return {
      error: 'usage: /settings <namespace>.<field> <value> · /settings reset <namespace>.<field>',
    };
  }
  const ns = [...namespaces]
    .sort((a, b) => b.length - a.length)
    .find(n => target.startsWith(`${n}.`));
  if (ns === undefined) {
    return { error: `no namespace in "${target}" — /settings lists them` };
  }
  if (MODELS.has(ns)) {
    return { error: `${ns} is /models'` };
  }
  const path = target.slice(ns.length + 1).split('.');
  if (path.some(p => p === '')) {
    return { error: `"${target}" is not a field` };
  }
  if (reset) {
    return { op: 'unset', ns, path };
  }
  const raw = set[2].trim();
  let value;
  try {
    // Numbers, booleans, null, arrays and objects as JSON; anything else
    // is a string, so `shell.foo hello` needs no quotes.
    value = JSON.parse(raw);
  } catch {
    value = raw;
  }
  return { op: 'set', ns, path, value };
}
