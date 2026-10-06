/**
 * The side panel, as OpenCode keeps one: what the session is and how much
 * of the model's context it has used, beside the conversation instead of
 * asked for. Pure: the lines and their styles, from what the App knows.
 */

import { fmtCount, fmtRate } from './speed.js';

/** Columns the panel takes, its border included. */
export const SIDEBAR_WIDTH = 34;
/** Terminals at least this wide show it unless told not to. */
export const SIDEBAR_AUTO_COLS = 120;

/**
 * Whether the panel shows: `/sidebar` sets on or off; auto shows it on a
 * terminal wide enough to spare the columns.
 * @param {'auto' | 'on' | 'off'} pref
 * @param {number} cols
 */
export function sidebarShown(pref, cols) {
  if (pref === 'on') {
    return cols >= SIDEBAR_WIDTH + 40;
  }
  return pref === 'auto' && cols >= SIDEBAR_AUTO_COLS;
}

/**
 * A bar of `width` cells filled to a fraction.
 * @param {number} fraction
 * @param {number} width
 */
export function bar(fraction, width) {
  const f = Math.min(1, Math.max(0, fraction));
  const full = Math.round(f * width);
  return '█'.repeat(full) + '░'.repeat(width - full);
}

const cut = (t, w) => (t.length > w ? `${t.slice(0, w - 1)}…` : t);

/**
 * The panel's lines.
 * @param {{title?: string, model: string, context?: number, window?: number, totals: {input: number, output: number, cache: number}, rate?: number, files: string[], instructions: string[], standing: string[]}} info
 * @param {number} width the panel's inner width
 * @returns {Array<{text: string, style?: 'title' | 'label' | 'dim' | 'warn' | 'alert' | 'ok'}>}
 */
export function sidebarLines(info, width) {
  const w = Math.max(10, width);
  const out = [];
  const section = label => {
    if (out.length > 0) {
      out.push({ text: '' });
    }
    out.push({ text: label, style: 'label' });
  };
  out.push({ text: cut(info.title ?? 'new session', w), style: 'title' });
  out.push({ text: cut(info.model, w), style: 'dim' });

  section('Context');
  if (info.context === undefined) {
    out.push({ text: 'nothing sent yet', style: 'dim' });
  } else if (info.window) {
    const f = info.context / info.window;
    const style = f >= 0.9 ? 'alert' : f >= 0.7 ? 'warn' : 'ok';
    out.push({
      text: `${fmtCount(info.context)} / ${fmtCount(info.window)} (${Math.round(f * 100)}%)`,
    });
    out.push({ text: bar(f, w), style });
    if (f >= 0.7) {
      out.push({ text: cut('/compact frees room', w), style: 'dim' });
    }
  } else {
    out.push({ text: `${fmtCount(info.context)} tokens`, style: 'dim' });
  }

  section('Tokens');
  const t = info.totals;
  out.push({ text: `↑ ${fmtCount(t.input)} in   ↓ ${fmtCount(t.output)} out` });
  if (t.cache > 0) {
    out.push({ text: `⟳ ${fmtCount(t.cache)} from cache`, style: 'dim' });
  }
  if (info.rate !== undefined) {
    out.push({ text: `last answer ${fmtRate(info.rate)}`, style: 'dim' });
  }

  if (info.standing.length > 0) {
    section('Now');
    for (const line of info.standing) {
      out.push({ text: cut(line, w) });
    }
  }
  if (info.files.length > 0) {
    section(`Changed (${info.files.length})`);
    for (const f of info.files.slice(-8)) {
      out.push({ text: cut(f, w), style: 'dim' });
    }
  }
  if (info.instructions.length > 0) {
    section('Instructions');
    for (const f of info.instructions) {
      out.push({ text: cut(`📘 ${f}`, w), style: 'dim' });
    }
  }
  return out;
}
