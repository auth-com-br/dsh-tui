/**
 * An assistant message's markdown, laid out for the terminal: a list of
 * lines, each a list of styled segments. The renderer (ui.js) draws the
 * segments; the viewport counts the same lines, so what is drawn and what
 * is measured cannot disagree.
 *
 * What the models write and a terminal can show: headings (without their
 * #s), tables drawn with box characters, rules, quotes, fenced code kept
 * as written, and inline `code`, **bold** and *italic*. A table too wide
 * for the screen wraps its cells; one that cannot fit even so is written
 * as "header: value" lines per row.
 */

import { clusters, strWidth } from './utils.js';

/** @typedef {{text: string, bold?: boolean, italic?: boolean, code?: boolean, dim?: boolean, heading?: boolean}} Seg */

/**
 * Inline markdown as segments, markers removed.
 * @param {string} text
 * @param {Partial<Seg>} [base] style every segment carries
 * @returns {Seg[]}
 */
export function inlineSegments(text, base = {}) {
  const out = [];
  const re = /(`[^`\n]+`)|(\*\*[^*\n]+\*\*)|(__[^_\n]+__)|(\*[^*\n\s][^*\n]*\*)/g;
  let last = 0;
  let m;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) {
      out.push({ ...base, text: text.slice(last, m.index) });
    }
    const t = m[0];
    if (m[1] !== undefined) {
      out.push({ ...base, text: t.slice(1, -1), code: true });
    } else if (m[2] !== undefined || m[3] !== undefined) {
      out.push({ ...base, text: t.slice(2, -2), bold: true });
    } else {
      out.push({ ...base, text: t.slice(1, -1), italic: true });
    }
    last = m.index + t.length;
  }
  if (last < text.length) {
    out.push({ ...base, text: text.slice(last) });
  }
  return out;
}

const segsWidth = segs => segs.reduce((w, s) => w + strWidth(s.text), 0);

/**
 * Wrap segments to a width, at spaces where it can, inside a word where a
 * word is longer than the line.
 * @param {Seg[]} segs
 * @param {number} width
 * @returns {Seg[][]}
 */
export function wrapSegments(segs, width) {
  const w = Math.max(1, width);
  // Words keep their style; a space is a break.
  const words = [];
  for (const seg of segs) {
    for (const part of seg.text.split(/( +)/)) {
      if (part !== '') {
        words.push({ ...seg, text: part });
      }
    }
  }
  const lines = [];
  let line = [];
  let lineW = 0;
  const flush = () => {
    // A line does not end or start on the space it broke at.
    while (line.length > 0 && /^ +$/.test(line[line.length - 1].text)) {
      lineW -= strWidth(line.pop().text);
    }
    lines.push(line);
    line = [];
    lineW = 0;
  };
  for (const word of words) {
    const ww = strWidth(word.text);
    const space = /^ +$/.test(word.text);
    if (space && lineW === 0) {
      continue;
    }
    if (lineW + ww <= w) {
      line.push(word);
      lineW += ww;
      continue;
    }
    if (space) {
      flush();
      continue;
    }
    if (ww <= w) {
      flush();
      line.push(word);
      lineW = ww;
      continue;
    }
    // Longer than a line: split by what the terminal draws.
    for (const c of clusters(word.text)) {
      if (lineW + c.w > w) {
        flush();
      }
      const lastSeg = line[line.length - 1];
      if (lastSeg !== undefined && lastSeg.text !== undefined && sameStyle(lastSeg, word)) {
        lastSeg.text += c.s;
      } else {
        line.push({ ...word, text: c.s });
      }
      lineW += c.w;
    }
  }
  if (line.length > 0 || lines.length === 0) {
    flush();
  }
  return lines;
}

function sameStyle(a, b) {
  return (
    a.bold === b.bold &&
    a.italic === b.italic &&
    a.code === b.code &&
    a.dim === b.dim &&
    a.heading === b.heading
  );
}

// ── tables ───────────────────────────────────────────────────────────────

/** The cells of a table row: split at | outside `code`, edges trimmed. */
export function splitRow(line) {
  let t = line.trim();
  if (t.startsWith('|')) {
    t = t.slice(1);
  }
  if (t.endsWith('|') && !t.endsWith('\\|')) {
    t = t.slice(0, -1);
  }
  const cells = [];
  let cur = '';
  let inCode = false;
  for (let i = 0; i < t.length; i++) {
    const ch = t[i];
    if (ch === '\\' && t[i + 1] === '|') {
      cur += '|';
      i++;
    } else if (ch === '`') {
      inCode = !inCode;
      cur += ch;
    } else if (ch === '|' && !inCode) {
      cells.push(cur.trim());
      cur = '';
    } else {
      cur += ch;
    }
  }
  cells.push(cur.trim());
  return cells;
}

// The line under a table's header: dashes, with colons for alignment,
// between pipes — one dash is enough (|:-|--:|). A pipe is required, or a
// --- rule under a line holding a | would start a table.
const SEPARATOR = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/;

function alignOf(cell) {
  const c = cell.trim();
  if (c.startsWith(':') && c.endsWith(':')) {
    return 'center';
  }
  return c.endsWith(':') ? 'right' : 'left';
}

/**
 * A table laid out in `width` columns: box-drawn when it fits, cells
 * wrapped when it is wide, "header: value" lines when even that cannot fit.
 * @param {string[][]} rows header first
 * @param {string[]} aligns
 * @param {number} width
 * @returns {Seg[][]}
 */
export function layoutTable(rows, aligns, width) {
  const n = Math.max(...rows.map(r => r.length));
  const cells = rows.map((r, ri) =>
    Array.from({ length: n }, (_, ci) =>
      inlineSegments(r[ci] ?? '', ri === 0 ? { bold: true } : {}),
    ),
  );
  const natural = Array.from({ length: n }, (_, ci) =>
    Math.max(1, ...cells.map(r => segsWidth(r[ci]))),
  );
  // Each column has a space either side and a border after; plus the first.
  const budget = width - (3 * n + 1);
  const minCol = 3;
  if (budget < n * minCol) {
    return listTable(cells, width);
  }
  const widths = [...natural];
  let total = widths.reduce((a, b) => a + b, 0);
  while (total > budget) {
    let widest = 0;
    for (let i = 1; i < n; i++) {
      if (widths[i] > widths[widest]) {
        widest = i;
      }
    }
    if (widths[widest] <= minCol) {
      return listTable(cells, width);
    }
    widths[widest] -= 1;
    total -= 1;
  }
  const rule = (l, m, r) => [
    { text: l + widths.map(w => '─'.repeat(w + 2)).join(m) + r, dim: true },
  ];
  const out = [rule('┌', '┬', '┐')];
  cells.forEach((row, ri) => {
    const wrapped = row.map((segs, ci) => wrapSegments(segs, widths[ci]));
    const height = Math.max(...wrapped.map(w => w.length));
    for (let k = 0; k < height; k++) {
      const line = [{ text: '│', dim: true }];
      wrapped.forEach((cellLines, ci) => {
        const segs = cellLines[k] ?? [];
        const gap = widths[ci] - segsWidth(segs);
        const align = ri === 0 ? 'left' : (aligns[ci] ?? 'left');
        const left = align === 'right' ? gap : align === 'center' ? Math.floor(gap / 2) : 0;
        line.push({ text: ' '.repeat(1 + left) }, ...segs, { text: ' '.repeat(1 + gap - left) });
        line.push({ text: '│', dim: true });
      });
      out.push(line);
    }
    if (ri === 0) {
      out.push(rule('├', '┼', '┤'));
    }
  });
  out.push(rule('└', '┴', '┘'));
  return out;
}

/** A table too wide for any columns: each row as "header: value" lines. */
function listTable(cells, width) {
  const [head, ...body] = cells;
  const out = [];
  body.forEach((row, ri) => {
    if (ri > 0) {
      out.push([{ text: '·', dim: true }]);
    }
    row.forEach((segs, ci) => {
      const label = head[ci].map(s => ({ ...s, bold: true }));
      out.push(...wrapSegments([...label, { text: ': ' }, ...segs], width));
    });
  });
  return out;
}

// ── blocks ───────────────────────────────────────────────────────────────

/**
 * Lay a message out in `width` columns.
 * @param {string} text
 * @param {number} width
 * @returns {Seg[][]}
 */
export function layoutMarkdown(text, width) {
  const w = Math.max(4, width);
  const lines = String(text).split('\n');
  const out = [];
  let fence = null;
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const trimmed = raw.trim();
    if (fence !== null) {
      // Code is kept as written, fences too, wrapped by width.
      for (const piece of wrapSegments([{ text: raw.replace(/\t/g, '  ') }], w)) {
        out.push(piece.length > 0 ? piece : [{ text: '' }]);
      }
      if (trimmed.startsWith(fence)) {
        fence = null;
      }
      continue;
    }
    const open = /^(`{3,}|~{3,})/.exec(trimmed);
    if (open) {
      fence = open[1];
      out.push([{ text: raw.trim(), dim: true }]);
      continue;
    }
    if (trimmed === '') {
      out.push([]);
      continue;
    }
    // A table: a row, then the |---|---| line under it.
    if (
      trimmed.includes('|') &&
      i + 1 < lines.length &&
      SEPARATOR.test(lines[i + 1]) &&
      lines[i + 1].includes('|')
    ) {
      const rows = [splitRow(raw)];
      const aligns = splitRow(lines[i + 1]).map(alignOf);
      let j = i + 2;
      while (j < lines.length && lines[j].includes('|') && lines[j].trim() !== '') {
        rows.push(splitRow(lines[j]));
        j++;
      }
      out.push(...layoutTable(rows, aligns, w));
      i = j - 1;
      continue;
    }
    if (/^([-*_])(\s*\1){2,}$/.test(trimmed)) {
      out.push([{ text: '─'.repeat(w), dim: true }]);
      continue;
    }
    const heading = /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(trimmed);
    if (heading) {
      out.push(...wrapSegments(inlineSegments(heading[2], { bold: true, heading: true }), w));
      continue;
    }
    const quote = /^>\s?(.*)$/.exec(trimmed);
    if (quote) {
      for (const line of wrapSegments(inlineSegments(quote[1], { dim: true }), w - 2)) {
        out.push([{ text: '▎ ', dim: true }, ...line]);
      }
      continue;
    }
    // A list item's continuation lines line up under its text.
    const item = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/.exec(raw);
    if (item) {
      const marker = /^\d/.test(item[2]) ? `${item[2]} ` : '• ';
      const indent = ' '.repeat(Math.min(item[1].length, 8));
      const hang = indent.length + strWidth(marker);
      wrapSegments(inlineSegments(item[3]), w - hang).forEach((line, k) => {
        out.push([{ text: k === 0 ? indent + marker : ' '.repeat(hang) }, ...line]);
      });
      continue;
    }
    out.push(...wrapSegments(inlineSegments(trimmed), w));
  }
  while (out.length > 0 && out[out.length - 1].length === 0) {
    out.pop();
  }
  return out.length === 0 ? [[]] : out;
}

/** A laid-out line as plain text: what a test reads. */
export function lineText(segs) {
  return segs.map(s => s.text).join('');
}
