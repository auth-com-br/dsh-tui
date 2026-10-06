/**
 * dsh-tui Ink UI — plain React (React.createElement only, no JSX, no build).
 *
 * Design: Codex CLI TUI, distilled from openai/codex codex-rs/tui sources.
 *   - No chrome boxes. Terminal-default colors; semantic accents only:
 *     cyan (input ›, user ▌, activity), green (success/output),
 *     red (errors), magenta (brand + `$` prompt), dim (secondary).
 *   - Message prefixes with aligned wrapping: `• ` assistant, `▌ ` user
 *     (user block also carries a faint background), `$ ` commands.
 *   - Tool cells: `• Running <cmd>` (live marker) → `$ <cmd>` + output +
 *     `✓ • 1.2s` / `✗ (1) • 0ms`.
 *   - `• Working (Ns)` status row above the composer while busy.
 *   - Bottom hint row: model · cwd on the left, key hints on the right.
 *   - Markdown: headers stay `#`-prefixed and bold; fenced code blocks keep
 *     their fences; inline `code` gets a subtle chip.
 *   - Hermes-inspired extras: collapsible thinking (t), todo panel (todo/write).
 *
 * All event access is defensive: shapes carry optional fields and the harness
 * iterates fast, so the UI must never crash on unknown types.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Box, Text, useApp, useInput, useStdout } from 'ink';
import { Composer } from './composer.js';
import { newQuestions, questionKey, questionLines, answersOf } from './questions.js';
import { whenOf } from './sessions.js';
import { menuQuery, menuRows, menuLines, pickRow, leadingName } from './slashmenu.js';
import { activeAtToken, replaceToken, shownMentions } from './refs.js';
import { NO_STANDING, foldStanding, standingLines } from './status.js';
import { newDeliverables, foldDeliverables, deliverablesText } from './deliverables.js';
import { jobsBadge, jobsText } from './jobs.js';
import { foldWorkflow, workflowText } from './workflow.js';
import { trajectoryText } from './trajectory.js';
import { foldSchedule, scheduleText, reminderPrompt } from './schedule.js';
import { modelsFlow } from './models.js';
import { settingsText, parseSettingsArgs } from './settingsview.js';
import { pluginsText } from './plugins.js';
import { THEMES } from './theme.js';
import { pathArg, imageLabel, contentText } from './attachments.js';
import { parseRate, ratingText } from './feedback.js';
import { layoutMarkdown } from './markdown.js';
import { newSpeed, foldSpeed, liveRate, fmtRate, totalsText } from './speed.js';
import { foldInstructions, changesText, instructionsText } from './instructions.js';
import { SIDEBAR_WIDTH, sidebarShown, sidebarLines } from './sidebar.js';
import { createUserMessage } from '@deepseek-ai/dsh-llm';
import { userMessageBg, codeChipBg, strWidth, clusters } from './utils.js';

/** createElement shorthand. */
const el = React.createElement;

// ── Codex semantic palette (terminal-default based) ──────────────────────
const ACCENT = 'cyan'; // input ›, user ▌, activity markers
const OK = 'green'; // ✓, command output
const ERR = 'red'; // ✗, errors
// `$` prompt and app mark — kept as direct hex values in render calls
// so BRAND is intentionally declared for documentation / future use
const BRAND = 'magenta'; // eslint-disable-line no-unused-vars

/** Codex-style braille spinner (ink-spinner has no braille frame set). */
const BRAILLE_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

function BrailleSpinner() {
  const [frame, setFrame] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setFrame(f => (f + 1) % BRAILLE_FRAMES.length), 80);
    return () => clearInterval(timer);
  }, []);
  return el(Text, null, BRAILLE_FRAMES[frame]);
}

/** Caps. */
const MAX_ITEMS = 500;
const MAX_TOOL_ARGS = 160;
const MAX_RESULT_PREVIEW = 300;
const OUTPUT_HEAD = 10; // first output lines kept per tool result
const OUTPUT_TAIL = 6; // last output lines kept per tool result

// ── Width chain (keep in sync with ChatRow layout) ───────────────────────
// App width = columns - 2 (transcript side padding), so rows render at
// `width - 2`. User lines add 1+1 padding; assistant body lines carry a
// 2-column `• ` / `  ` gutter. Estimates must use the same arithmetic or the
// bottom-anchored viewport clips the last line of long messages.
const TRANSCRIPT_PAD = 2;
const USER_LINE_PAD = 2;
const USER_PREFIX_W = 2; // '▌ '
const MARKDOWN_GUTTER = 2; // '• ' on the first line, '  ' afterwards

/** The TUI's own commands, as the `/` menu offers them. */
const TUI_COMMANDS = [
  { name: 'help', description: 'show the commands and keys', kind: 'command' },
  { name: 'clear', description: 'clear the transcript', kind: 'command' },
  { name: 'retry', description: 're-send the last message', kind: 'command' },
  { name: 'model', description: 'choose the model', kind: 'command' },
  { name: 'sessions', description: 'resume another session of this directory', kind: 'command' },
  { name: 'mcp', description: 'the MCP servers and their tools', kind: 'command' },
  { name: 'agents', description: "watch this session's subagents", kind: 'command' },
  { name: 'jobs', description: "this session's background jobs", kind: 'command' },
  { name: 'schedule', description: "this session's reminders", kind: 'command' },
  {
    name: 'thinking',
    description: 'open or fold every thought',
    kind: 'command',
    takesInput: true,
    hint: 'all | none',
  },
  {
    name: 'sidebar',
    description: 'the side panel: context used, tokens, files',
    kind: 'command',
    takesInput: true,
    hint: '[on|off|auto]',
  },
  {
    name: 'instructions',
    description: 'the AGENTS.md / CLAUDE.md files the agent works from',
    kind: 'command',
  },
  {
    name: 'settings',
    description: "the plugins' settings: list, set or reset a field",
    kind: 'command',
    takesInput: true,
    hint: '[ns.field value | reset ns.field]',
  },
  {
    name: 'plugins',
    description: 'what the harness loaded, failures first',
    kind: 'command',
    takesInput: true,
    hint: '[filter]',
  },
  {
    name: 'theme',
    description: 'light, dark, or auto (what the terminal says)',
    kind: 'command',
    takesInput: true,
    hint: '[auto|light|dark]',
  },
  {
    name: 'image',
    description: 'attach an image to the next message',
    kind: 'command',
    takesInput: true,
    hint: '<path> | clear',
  },
  {
    name: 'rate',
    description: 'rate the last answer, with a note',
    kind: 'command',
    takesInput: true,
    hint: 'good|bad [note] | clear',
  },
  {
    name: 'models',
    description: 'model providers: API keys, add a server, its models',
    kind: 'command',
  },
  {
    name: 'trajectory',
    description: 'the last turns with their steps, tools and timings',
    kind: 'command',
    takesInput: true,
    hint: '[turns]',
  },
  {
    name: 'rename',
    description: 'rename this session',
    kind: 'command',
    takesInput: true,
    hint: '<title>',
  },
  { name: 'exit', description: 'quit', kind: 'command' },
];

const HELP_TEXT = [
  'commands:',
  '  /help         show this help',
  '  /clear        clear the transcript',
  '  /retry        re-send the last message',
  '  /model [name]  choose the model (provider/model)',
  '  /sessions     resume another session of this directory',
  '  /mcp          the MCP servers and their tools',
  "  /agents       watch this session's subagents (read-only)",
  "  /jobs         this session's background jobs",
  "  /schedule     this session's reminders (overlays/schedule.yml)",
  '  /instructions  the AGENTS.md / CLAUDE.md files the agent works from',
  '  /thinking all|none  open or fold every thought (ctrl+t: the lowest on screen)',
  '  /sidebar [on|off|auto]  the side panel: context used, tokens, files',
  '  /models       model providers: API keys, add a server (local or remote)',
  "  /settings [ns.field value]  the plugins' settings; reset ns.field undoes",
  '  /plugins [filter]  what the harness loaded, failures first',
  '  /theme [auto|light|dark]  the backgrounds; kept for the next start',
  '  /image <path>  attach an image to the next message (/image clear)',
  '  /rate good|bad [note]  rate the last answer; the model never sees it',
  '  /trajectory [n]  the last n turns with steps, tools and timings',
  '  /rename <title>  rename this session',
  '  @path         refer to a file or folder; @ also lists other sessions',
  '  /exit, /quit  quit dsh tui',
  'keys:',
  '  ↑ / ↓          scroll transcript',
  '  page up/down   scroll by page',
  '  esc            back to latest',
  '  ctrl + t       toggle thinking display',
  '  ctrl + c       quit',
].join('\n');

/**
 * The model a /model argument names: "provider/model", or a model id alone
 * when one route has it.
 * @param {Array<{provider: string, model: string}>} models
 * @param {string} wanted
 */
export function pickModel(models, wanted) {
  const w = wanted.trim();
  return (
    models.find(m => `${m.provider}/${m.model}` === w) ??
    (models.filter(m => m.model === w).length === 1 ? models.find(m => m.model === w) : undefined)
  );
}

/**
 * The help: the TUI's own commands and keys, then the harness's commands
 * (dsh-commands) with their input hints and descriptions.
 * @param {ReadonlyArray<{name: string, description: string, input?: {hint?: string}}>} commands
 */
export function helpText(commands) {
  if (!commands || commands.length === 0) {
    return HELP_TEXT;
  }
  const rows = [...commands]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map(c => {
      const head = `/${c.name}${c.input?.hint ? ' ' + c.input.hint : ''}`;
      return `  ${head.padEnd(26)} ${c.description}`;
    });
  return [HELP_TEXT, 'harness commands:', ...rows].join('\n');
}

// ── Width helpers (CJK-aware) ────────────────────────────────────────────

// wcwidth, strWidth and clusters are utils.js's.

/** Wrap `text` to `width` columns; returns an array of lines. Newlines split first. */
function wrapText(text, width) {
  if (width < 4) {
    return [text];
  }
  const parts = String(text).split('\n');
  if (parts[parts.length - 1] === '') {
    parts.pop();
  }
  const lines = [];
  for (const part of parts) {
    if (part === '') {
      lines.push('');
      continue;
    }
    let cur = '';
    let curW = 0;
    for (const { s: ch, w } of clusters(part)) {
      if (curW + w > width) {
        lines.push(cur);
        cur = '';
        curW = 0;
      }
      cur += ch;
      curW += w;
    }
    if (cur !== '') {
      lines.push(cur);
    }
  }
  return lines.length === 0 ? [''] : lines;
}

/**
 * Wrap and prefix: first line gets `prefix`, subsequent lines get `indent`
 * spaces — the Codex aligned-message look.
 */
function prefixedLines(text, width, prefix, indent = 2) {
  const pad = ' '.repeat(indent);
  const prefixW = strWidth(prefix);
  const avail = prefixW > 0 ? Math.max(1, width - prefixW) : Math.max(1, width - indent);
  const lines = wrapText(text, avail);
  if (lines.length === 0) {
    return [prefix];
  }
  return [prefix + lines[0], ...lines.slice(1).map(line => pad + line)];
}

/** Clip a string to `max` chars with an ellipsis. */
function truncate(text, max) {
  if (typeof text !== 'string') {
    return '';
  }
  if (strWidth(text) <= max) {
    return text;
  }
  let out = '';
  let w = 0;
  for (const { s: ch, w: cw } of clusters(text)) {
    if (w + cw > max - 1) {
      break;
    }
    out += ch;
    w += cw;
  }
  return `${out}…`;
}

/** Join the text of every block of one `type` in a message content array. */
function blocksText(content, type) {
  if (!Array.isArray(content)) {
    return '';
  }
  return content
    .filter(
      block =>
        block && typeof block === 'object' && block.type === type && typeof block.text === 'string',
    )
    .map(block => block.text)
    .join('');
}

/** First text found in a tool-result message (ToolResultBlock inner blocks). */
function toolResultText(message) {
  if (!message || typeof message !== 'object' || !Array.isArray(message.content)) {
    return '';
  }
  const parts = [];
  for (const block of message.content) {
    if (!block || typeof block !== 'object') {
      continue;
    }
    if (block.type === 'text' && typeof block.text === 'string') {
      parts.push(block.text);
    } else if (block.type === 'tool-result' && Array.isArray(block.content)) {
      for (const inner of block.content) {
        if (
          inner &&
          typeof inner === 'object' &&
          inner.type === 'text' &&
          typeof inner.text === 'string'
        ) {
          parts.push(inner.text);
        }
      }
    }
  }
  return parts.join('\n');
}

/** Human label for a turn-end reason. */
function reasonText(reason) {
  if (!reason || typeof reason !== 'object') {
    return 'ended';
  }
  switch (reason.kind) {
    case 'completed':
      return '✓ completed';
    case 'error':
      return `✗ error: ${reason.error?.code ?? 'UNKNOWN'} ${reason.error?.message ?? ''}`;
    case 'aborted':
      return '⏹ aborted';
    case 'max-tokens':
      return '⚠ max-tokens';
    default:
      return String(reason.kind);
  }
}

/** Strip CSI/OSC escapes so raw tool bytes cannot repaint the TUI. */
const ANSI_RE = /\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g;
function stripAnsi(text) {
  return String(text).replace(ANSI_RE, '');
}

/** Compact token-usage line; omits missing fields. */
function usageText(usage) {
  if (!usage || typeof usage !== 'object') {
    return '';
  }
  const parts = [];
  if (typeof usage.inputTokens === 'number') {
    parts.push(`${usage.inputTokens}in`);
  }
  if (typeof usage.outputTokens === 'number') {
    parts.push(`${usage.outputTokens}out`);
  }
  if (typeof usage.cacheReadTokens === 'number') {
    parts.push(`${usage.cacheReadTokens}cache`);
  }
  return parts.length > 0 ? `usage: ${parts.join(' ')}` : '';
}

function fmtDuration(ms) {
  const sec = Math.max(0, ms) / 1000;
  return sec < 10 ? `${sec.toFixed(1)}s` : `${Math.round(sec)}s`;
}

/** Codex-style compact elapsed: 0s, 59s, 1m 02s, 1h 02m 03s. */
function fmtElapsedCompact(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  if (hours > 0) {
    return `${hours}h ${String(minutes).padStart(2, '0')}m ${String(seconds).padStart(2, '0')}s`;
  }
  if (minutes > 0) {
    return `${minutes}m ${String(seconds).padStart(2, '0')}s`;
  }
  return `${seconds}s`;
}

// ── Markdown (Codex-style: keep `#` and fences, no boxes) ────────────────

/** Split text into fenced code blocks and plain segments. */
function splitCodeBlocks(text) {
  const blocks = [];
  const lines = String(text).split('\n');
  let inFence = false;
  let buf = [];
  for (const line of lines) {
    if (line.startsWith('```')) {
      if (inFence) {
        buf.push(line);
        blocks.push({ type: 'code', content: buf.join('\n') });
        buf = [];
        inFence = false;
      } else {
        if (buf.length > 0) {
          blocks.push({ type: 'text', content: buf.join('\n') });
          buf = [];
        }
        inFence = true;
        buf.push(line);
      }
    } else {
      buf.push(line);
    }
  }
  if (buf.length > 0) {
    blocks.push({ type: inFence ? 'code' : 'text', content: buf.join('\n') });
  }
  return blocks;
}

/**
 * Markdown body for an assistant message, laid out by markdown.js —
 * headings, tables, rules, quotes, code — and drawn here segment by
 * segment. `prefix` (e.g. `• `) goes on the first line; the rest indent to
 * the same column, the Codex aligned-gutter look.
 */
function markdownLines(text, width, indent = 2, chipBg = '#333333', prefix = '') {
  const pad = ' '.repeat(indent);
  // `width` is the available content width; the gutter must come out of it or
  // every rendered line is one wider than the estimate and wraps a second,
  // flush-left line (misaligned continuation, clipped tail).
  const gutterW = prefix !== '' ? strWidth(prefix) : indent;
  const avail = Math.max(1, width - gutterW);
  return layoutMarkdown(text, avail).map((segs, i) =>
    el(
      Text,
      { key: `b${i}`, wrap: 'truncate-end' },
      i === 0 && prefix !== '' ? prefix : pad,
      ...segs.map((seg, j) =>
        el(
          Text,
          {
            key: j,
            bold: seg.bold,
            italic: seg.italic,
            dimColor: seg.dim,
            color: seg.heading ? ACCENT : undefined,
            backgroundColor: seg.code ? chipBg : undefined,
          },
          seg.text,
        ),
      ),
    ),
  );
}

/** Body lines for a plain (non-markdown) message with a prefix. */
function plainLines(text, width, prefix, indent = 2) {
  return prefixedLines(text, width, prefix, indent).map((line, i) =>
    el(Text, { key: `l${i}`, wrap: 'wrap' }, line),
  );
}

// ── Transcript rows ───────────────────────────────────────────────────────

/** Cap tool output to head + tail lines with an ellipsis marker. */
function splitOutput(text) {
  if (typeof text !== 'string' || text === '') {
    return null;
  }
  const clean = stripAnsi(text).replace(/\r\n?/g, '\n');
  const capped = truncate(clean, MAX_RESULT_PREVIEW);
  const lines = capped.split('\n');
  if (lines.length <= OUTPUT_HEAD + OUTPUT_TAIL) {
    return { lines, omitted: 0 };
  }
  return {
    lines: [...lines.slice(0, OUTPUT_HEAD), ...lines.slice(-OUTPUT_TAIL)],
    omitted: lines.length - OUTPUT_HEAD - OUTPUT_TAIL,
  };
}

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, message: '' };
  }
  static getDerivedStateFromError(error) {
    return { hasError: true, message: error instanceof Error ? error.message : String(error) };
  }
  componentDidUpdate(prevProps) {
    if (this.state.hasError && prevProps.resetKey !== this.props.resetKey) {
      this.setState({ hasError: false, message: '' });
    }
  }
  componentDidCatch(error) {
    console.error(
      `dsh-tui: render error: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  render() {
    if (this.state.hasError) {
      return el(Text, { color: ERR, wrap: 'wrap' }, `⚠ render error: ${this.state.message}`);
    }
    return this.props.children;
  }
}

function ChatRow({ item, width, thinkingOpen, themeBg }) {
  switch (item.kind) {
    case 'user': {
      // Faint derived background + cyan ▌ prefix (Codex user-message style).
      return el(
        Box,
        {
          flexDirection: 'column',
          backgroundColor: userMessageBg(themeBg),
          paddingY: 0,
          flexShrink: 0,
        },
        ...plainLines(item.text, width - TRANSCRIPT_PAD - USER_LINE_PAD, '▌ ', 2).map((line, i) =>
          el(Box, { key: `u${i}`, paddingLeft: 1, paddingRight: 1 }, line),
        ),
      );
    }
    case 'assistant': {
      const lines = [];
      if (item.reasoning !== '') {
        const view = thinkingView(item.reasoning, width, thinkingOpen);
        lines.push(
          el(
            Box,
            { key: 'thinking', flexDirection: 'column' },
            el(Text, { dimColor: true }, view.heading),
            ...view.lines.map((line, i) =>
              el(
                Text,
                { key: `t${i}`, dimColor: true, italic: true, wrap: 'truncate' },
                `    ${line}`,
              ),
            ),
          ),
        );
      }
      if (item.text !== '') {
        lines.push(
          el(
            Box,
            { key: 'body', flexDirection: 'column' },
            ...markdownLines(item.text, width - TRANSCRIPT_PAD, 2, codeChipBg(themeBg), '• '),
          ),
        );
      }
      if (item.usage) {
        lines.push(
          el(
            Text,
            { key: 'usage', dimColor: true, wrap: 'wrap' },
            `  ${usageText(item.usage)}${item.rate ? ` · ${fmtRate(item.rate)}` : ''}`,
          ),
        );
      }
      if (lines.length === 0) {
        return null;
      }
      return el(Box, { flexDirection: 'column', marginTop: 1, flexShrink: 0 }, ...lines);
    }
    case 'tool': {
      const done = item.status === 'done';
      const failed = item.status === 'error';
      const mark = failed
        ? el(Text, { key: 'm', color: ERR, bold: true }, '✗')
        : done
          ? el(Text, { key: 'm', color: OK, bold: true }, '✓')
          : el(BrailleSpinner, { key: 'm' });
      const label = done || failed ? '' : 'Running ';
      const seconds =
        typeof item.seconds === 'number' ? ` • ${fmtDuration(item.seconds * 1000)}` : '';
      // Cap the head to one rendered line: a wrapping head would break the
      // aligned look and the one-line estimate.
      const cmd = truncate(
        `${item.name} ${truncate(item.args, MAX_TOOL_ARGS)}`.trim(),
        Math.max(12, width - 16),
      );
      const outputLines = splitOutput(item.output);
      const rows = [
        el(
          Text,
          { key: 'head', wrap: 'wrap' },
          el(Text, {}, '  '),
          mark,
          el(
            Text,
            { bold: !done && !failed, color: done || failed ? undefined : ACCENT },
            ` ${label}${cmd}`,
          ),
          el(Text, { dimColor: true }, seconds),
        ),
      ];
      if (outputLines !== null) {
        let outIndex = 0;
        for (const line of outputLines.lines) {
          // Pre-wrap to keep the 4-space indent on continuations (Ink would
          // otherwise wrap flush-left).
          for (const wrapped of wrapText(line, Math.max(1, width - 6))) {
            rows.push(
              el(Text, { key: `o${outIndex++}`, dimColor: true, wrap: 'wrap' }, `    ${wrapped}`),
            );
          }
        }
        if (outputLines.omitted > 0) {
          rows.push(
            el(
              Text,
              { key: 'ell', dimColor: true, wrap: 'wrap' },
              `    … +${outputLines.omitted} lines`,
            ),
          );
        }
      }
      if (failed && item.error) {
        const errText = `    error: ${item.error.code ?? item.error.name ?? 'unknown'}`;
        rows.push(
          el(
            Text,
            { key: 'err', color: ERR, wrap: 'wrap' },
            truncate(errText, Math.max(12, width - 2)),
          ),
        );
      }
      return el(Box, { flexDirection: 'column', marginTop: 1, flexShrink: 0 }, ...rows);
    }
    case 'divider':
      return el(Text, { dimColor: true }, '  ' + '─'.repeat(Math.min(48, width - 4)));
    default: // status rows: dim; red when the turn failed.
      return el(
        Text,
        { dimColor: !item.error, color: item.error ? ERR : undefined, wrap: 'wrap' },
        item.text,
      );
  }
}

// ── Thinking ─────────────────────────────────────────────────────────────

/** How many of the latest thinking lines show while it streams, folded. */
const THINKING_TAIL = 3;

/**
 * A thought, folded or open. Folded it is one line saying how long it is —
 * the answer is what a person reads, and a local model thinks at length;
 * open (ctrl+t) it is every line. While it streams, folded, its latest
 * lines show under the heading, so it is seen to be moving.
 * @returns {{heading: string, lines: string[]}}
 */
export function thinkingView(reasoning, width, open, streaming = false) {
  const all = wrapText(String(reasoning), Math.max(1, width - 6));
  const n = all.length;
  if (open) {
    return { heading: `  ▾ thinking · ${n} line${n === 1 ? '' : 's'} · ctrl+t folds`, lines: all };
  }
  if (streaming) {
    return { heading: '  ▸ thinking… · ctrl+t shows all', lines: all.slice(-THINKING_TAIL) };
  }
  return { heading: `  ▸ thinking · ${n} line${n === 1 ? '' : 's'} · ctrl+t shows`, lines: [] };
}

/** Live streaming block while a turn is in flight. */
function StreamBlock({ stream, width, thinkingOpen, themeBg }) {
  const children = [];
  if (stream.reasoning !== '') {
    const view = thinkingView(stream.reasoning, width, thinkingOpen, true);
    children.push(
      el(
        Box,
        { key: 'reasoning', flexDirection: 'column', marginTop: 1 },
        el(Text, { dimColor: true }, view.heading),
        ...view.lines.map((line, i) =>
          el(Text, { key: `t${i}`, dimColor: true, italic: true, wrap: 'truncate' }, `    ${line}`),
        ),
      ),
    );
  }
  if (stream.text !== '') {
    children.push(
      el(
        Box,
        { key: 'text', flexDirection: 'column', marginTop: 1 },
        ...markdownLines(stream.text, width - TRANSCRIPT_PAD, 2, codeChipBg(themeBg), '• '),
      ),
    );
  }
  if (stream.tool !== null) {
    const name = stream.tool.name !== '' ? stream.tool.name : 'tool';
    children.push(
      el(
        Text,
        { key: 'tool', wrap: 'wrap' },
        el(Text, {}, '  '),
        el(BrailleSpinner, { key: 'sp' }),
        el(Text, { bold: true, color: ACCENT }, ` Running ${name}`),
        el(Text, { dimColor: true }, ` ${truncate(stream.tool.args, MAX_TOOL_ARGS)}`),
      ),
    );
  }
  return children.length === 0 ? null : el(Box, { flexDirection: 'column' }, ...children);
}

/** Todo list panel (whole-list snapshot from todo/write). */
function TodoPanel({ todos }) {
  if (!Array.isArray(todos) || todos.length === 0) {
    return null;
  }
  return el(
    Box,
    { flexDirection: 'column', marginTop: 1, flexShrink: 0 },
    el(Text, { dimColor: true, bold: true }, '  todos'),
    ...todos.map((todo, index) => {
      const done = todo && todo.status === 'completed';
      const inProgress = todo && todo.status === 'in_progress';
      return el(
        Text,
        {
          key: index,
          dimColor: !done,
          color: done ? OK : inProgress ? ACCENT : undefined,
          wrap: 'wrap',
        },
        `    ${done ? '✓' : inProgress ? '◐' : '☐'} ${todo && typeof todo.content === 'string' ? todo.content : ''}`,
      );
    }),
  );
}

// ── Approvals ─────────────────────────────────────────────────────────────

/**
 * The lines an approval prompt shows in place of the composer: what is
 * asked, the action itself (the tool call's arguments, already streamed
 * into its cell), why, and the keys. The first line carries the words
 * "approval needed", which tend reads to show the harness as waiting.
 * @param {{toolName: string, args?: string, reason?: string}} req
 * @param {number} width
 * @returns {string[]}
 */
export function approvalLines(req, width) {
  const w = Math.max(20, width - 4);
  const lines = [`▲ approval needed · ${req.toolName}`];
  if (req.args) {
    lines.push(`  ${truncate(req.args.replace(/\s+/g, ' '), w - 2)}`);
  }
  if (req.reason) {
    lines.push(`  ${truncate(req.reason.replace(/\s+/g, ' '), w - 2)}`);
  }
  lines.push('  y allow once · n reject · esc reject');
  return lines;
}

/**
 * The outcome a key gives a pending approval, or null for a key that does
 * not answer it: y allows this one action, n and esc reject it. Nothing is
 * allowed by a key that was meant for something else, so only y allows.
 * @param {string} input
 * @param {{escape?: boolean}} key
 * @returns {'allowed-once' | 'rejected' | null}
 */
export function approvalOutcome(input, key) {
  if (input === 'y' || input === 'Y') {
    return 'allowed-once';
  }
  if (input === 'n' || input === 'N' || key.escape) {
    return 'rejected';
  }
  return null;
}

// ── App ───────────────────────────────────────────────────────────────────

export function App({
  followup,
  onEvent,
  onApproval,
  onQuestion,
  runCommand,
  listCommands,
  listModels,
  currentModel,
  selectModel,
  listSessions,
  switchSession,
  listSkills,
  mcpStatus,
  renameSession,
  listRefs,
  listAgents,
  openAgent,
  listJobs,
  onJobsChanged,
  sessionEvents,
  modelsService,
  settingsService,
  listPlugins,
  viewer,
  onBack,
  replayNote = 'resumed',
  history = [],
  onExit,
  onInterrupt,
  firstSeq = 0,
  model = '?',
  themeBg: initialBg = '#000000',
  theme: initialTheme = 'auto',
  setTheme,
  attachImage,
  feedback,
  contextWindow,
}) {
  // The message that closed the last turn: what /rate rates.
  const lastAnswerId = useRef(undefined);
  // Images /image attached to the next message, admitted already.
  const [pendingImages, setPendingImages] = useState([]);
  // The background the backgrounds are derived from; /theme changes it.
  const [themeBg, setThemeBg] = useState(initialBg);
  const [theme, setThemeName] = useState(initialTheme);
  const [items, setItems] = useState([]);
  const [todos, setTodos] = useState([]);
  // The composer's text is the composer's (composer.js), so typing does not
  // re-render the App; it is mirrored here only while it is a `/` line or
  // ends in an `@` token, which is when the menus need it. composerText is
  // always the whole of it.
  const [input, setMirror] = useState('');
  const composerText = useRef('');
  const composerApi = useRef(null);
  const onComposerChange = useCallback(text => {
    composerText.current = text;
    setMirror(text.startsWith('/') || activeAtToken(text) !== undefined ? text : '');
  }, []);
  const setInput = useCallback(
    text => {
      composerText.current = text;
      composerApi.current?.set(text);
      onComposerChange(text);
    },
    [onComposerChange],
  );
  const [busy, setBusy] = useState(false);
  const [stream, setStream] = useState({ reasoning: '', text: '', tool: null });
  const [hint, setHint] = useState(null);
  // Thinking is folded by default: a local model thinks at length, and the
  // answer under its thought was pushed off the screen by it.
  // Thoughts are folded; one is opened by ctrl+t on it (the lowest one on
  // screen), every one by /thinking all.
  const [openThoughts, setOpenThoughts] = useState(() => new Set());
  const [allThoughts, setAllThoughts] = useState(false);
  const thoughtOpen = useCallback(
    item => allThoughts || openThoughts.has(item?.id),
    [allThoughts, openThoughts],
  );
  const nextItemId = useRef(1);
  const visibleRef = useRef([]);
  // The side panel (sidebar.js): auto on a wide terminal, /sidebar sets it.
  const [sidebarPref, setSidebarPref] = useState('auto');
  const [modelWindow, setModelWindow] = useState(undefined);
  const [sessionTitle, setSessionTitle] = useState(undefined);
  const [sessionFiles, setSessionFiles] = useState([]);
  const [scrollLines, setScrollLines] = useState(0);
  // Approval requests waiting for the user, oldest first: the first is the
  // one shown. Each carries the resolve of the harness's waiting request.
  const [approvals, setApprovals] = useState([]);
  // The model shown in the footer, which /model changes.
  const [modelLabel, setModelLabel] = useState(model);
  // Set while a resumed session's past is replayed onto the screen.
  const replaying = useRef(false);
  // Batches of questions the agent asked, oldest first; the first is being
  // answered, its state in `state` and its waiting request's resolve.
  const [asks, setAsks] = useState([]);
  // The `/` menu: its cursor, the line it was closed on with esc (it stays
  // closed until the line changes), and the skills it offers, read once on
  // the first `/`.
  const [menuCursor, setMenuCursor] = useState(0);
  const [menuClosedFor, setMenuClosedFor] = useState(null);
  const [skills, setSkills] = useState(undefined);
  // The `@` menu's rows and the token they were asked for.
  const [refs, setRefs] = useState({ key: undefined, rows: [] });
  // Plan mode and the goal, folded from the session's events (status.js).
  const [standing, setStanding] = useState(NO_STANDING);
  // The files this turn changed, shown when it ends (deliverables.js).
  const deliverables = useRef(newDeliverables());
  const workflowRuns = useRef(new Map());
  // Tokens spent and the model's speed (speed.js); totals is the footer's.
  const speed = useRef(newSpeed());
  const [totals, setTotals] = useState(speed.current.totals);
  // The instruction files the agent has (instructions.js).
  const instructionFiles = useRef(new Map());
  // The session's reminders, folded from its schedule/change events.
  const [reminders, setReminders] = useState([]);
  // The session's background jobs, as the registry says they changed.
  const [jobs, setJobs] = useState([]);
  useEffect(() => {
    if (typeof listJobs !== 'function' || typeof onJobsChanged !== 'function') {
      return undefined;
    }
    const refresh = () => setJobs(listJobs());
    refresh();
    return onJobsChanged(refresh);
  }, [listJobs, onJobsChanged]);
  const viewportStep = useRef(5);
  const [, setTick] = useState(0); // drives the Working elapsed timer
  const usageRef = useRef(null);
  const hintTimer = useRef(undefined);
  const exiting = useRef(false);
  const lastUserText = useRef('');
  const toolStarts = useRef(new Map());
  const runningTools = useRef(new Map()); // callId → { name, args } while the row is live
  const toolResults = useRef(new Map()); // callId → done info (out-of-order guard)
  const turnStart = useRef(undefined);
  const lastEventAt = useRef(Date.now());
  const { exit: inkExit } = useApp();
  const { stdout } = useStdout();
  const termCols = stdout?.columns ?? 100;
  const rows = stdout?.rows ?? 30;
  const showSidebar = sidebarShown(sidebarPref, termCols);
  // The conversation's columns: the terminal's, less the panel's.
  const cols = showSidebar ? termCols - SIDEBAR_WIDTH : termCols;
  const width = Math.max(20, cols - 2);
  // For handlers that outlive a render (handleEvent is memoised).
  const widthRef = useRef(width);
  widthRef.current = width;

  // The model's context window, for the panel: asked again when the model
  // changes.
  useEffect(() => {
    if (typeof contextWindow !== 'function') {
      return undefined;
    }
    let live = true;
    Promise.resolve(contextWindow()).then(
      w => live && setModelWindow(w),
      () => live && setModelWindow(undefined),
    );
    return () => {
      live = false;
    };
  }, [contextWindow, modelLabel]);

  // A resized terminal is a new height for the frame, and new widths for
  // every line: drawn again at once rather than at the next key.
  useEffect(() => {
    if (!stdout) {
      return undefined;
    }
    const onResize = () => setTick(v => v + 1);
    stdout.on('resize', onResize);
    return () => stdout.off('resize', onResize);
  }, [stdout]);

  // Working elapsed timer while busy.
  useEffect(() => {
    if (!busy) {
      return;
    }
    const t = setInterval(() => setTick(v => v + 1), 1000);
    return () => clearInterval(t);
  }, [busy]);

  /** Append one transcript entry, dropping the oldest rows past MAX_ITEMS. */
  const pushItem = useCallback(item => {
    // An id of its own, by which a thought is opened alone.
    const withId = item.id === undefined ? { ...item, id: nextItemId.current++ } : item;
    setItems(prev => [...prev.slice(-(MAX_ITEMS - 1)), withId]);
  }, []);

  const clearHint = useCallback(() => {
    if (hintTimer.current !== undefined) {
      clearTimeout(hintTimer.current);
    }
    hintTimer.current = undefined;
    setHint(null);
  }, []);

  const flashHint = useCallback((text, ms = 1500) => {
    setHint(text);
    if (hintTimer.current !== undefined) {
      clearTimeout(hintTimer.current);
    }
    hintTimer.current = setTimeout(() => {
      hintTimer.current = undefined;
      setHint(null);
    }, ms);
  }, []);

  const showBusyHint = useCallback(() => flashHint('(busy — waiting for the model)'), [flashHint]);

  /** Exit the Ink app, then request the harness process exit. Never twice. */
  const handleExit = useCallback(() => {
    if (exiting.current) {
      return;
    }
    exiting.current = true;
    inkExit();
    onExit();
  }, [inkExit, onExit]);

  /**
   * Answer the oldest pending approval and drop it from the queue.
   * @param {'allowed-once' | 'rejected' | 'cancelled'} outcome
   */
  const answerApproval = useCallback(outcome => {
    setApprovals(prev => {
      if (prev.length === 0) {
        return prev;
      }
      prev[0].resolve(outcome);
      return prev.slice(1);
    });
  }, []);

  // The `/` menu, open while the composer holds a single `/word` and the
  // composer is shown. The skills are asked for once, on the first `/`.
  const handleSubmitRef = useRef(undefined);
  const query = approvals.length === 0 && asks.length === 0 ? menuQuery(input) : undefined;
  useEffect(() => {
    if (query === undefined || skills !== undefined) {
      return;
    }
    setSkills([]);
    if (typeof listSkills === 'function') {
      Promise.resolve(listSkills()).then(
        list => setSkills(list),
        () => {},
      );
    }
  }, [query, skills, listSkills]);
  // The `@` menu, open while an `@` token is being typed at the end of the
  // line: its candidates are the harness's, asked for a moment after the
  // last key, and the last answer stays up while the next is coming.
  const atKey =
    query === undefined && approvals.length === 0 && asks.length === 0
      ? activeAtToken(input)?.prefix
      : undefined;
  useEffect(() => {
    if (atKey === undefined || typeof listRefs !== 'function') {
      return undefined;
    }
    let live = true;
    const quoted = atKey.startsWith('@"');
    const timer = setTimeout(() => {
      Promise.resolve(listRefs(atKey.slice(quoted ? 2 : 1), quoted)).then(
        rows => {
          if (live) {
            setRefs({ key: atKey, rows });
          }
        },
        () => {},
      );
    }, 80);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [atKey, listRefs]);
  const menu =
    menuClosedFor === input
      ? []
      : query === undefined
        ? atKey !== undefined && refs.key !== undefined
          ? refs.rows
          : []
        : menuRows(
            {
              commands: [
                ...TUI_COMMANDS,
                ...(typeof listCommands === 'function' ? listCommands() : []).map(c => ({
                  name: c.name,
                  description: c.description,
                  kind: 'command',
                  takesInput: c.input !== undefined,
                  hint: c.input?.hint,
                })),
              ],
              skills: skills ?? [],
            },
            query,
          );
  const cursor = Math.min(menuCursor, Math.max(0, menu.length - 1));
  useEffect(() => {
    setMenuCursor(0);
  }, [query, atKey]);
  // An `@` row replaces the token being typed: settled (enter), or for a
  // folder, opened to go on completing inside it (tab).
  const pickRef = (row, drill) => {
    const line = composerText.current;
    const token = activeAtToken(line);
    if (token === undefined) {
      return;
    }
    setInput(replaceToken(line, token, drill && row.drill ? row.drill : row.settle));
  };
  const pickFromMenu = row => {
    if (row.settle !== undefined) {
      pickRef(row, false);
      return;
    }
    const pick = pickRow(row, query);
    if ('insert' in pick) {
      setInput(pick.insert);
    } else {
      handleSubmitRef.current(pick.run);
    }
  };

  // Global keys: esc interrupts the live turn, ctrl + t toggles thinking,
  // ctrl + c quits. Bare letters never hijack typing — except while an
  // approval is asked, when the composer is not there to type into and y,
  // n and esc answer it.
  useInput((input, key) => {
    if (asks.length > 0 && approvals.length === 0 && !(key.ctrl && input === 'c')) {
      setAsks(prev => {
        if (prev.length === 0) {
          return prev;
        }
        const state = questionKey(prev[0].state, input, key);
        if (state.done) {
          prev[0].resolve(answersOf(state));
          return prev.slice(1);
        }
        return [{ ...prev[0], state }, ...prev.slice(1)];
      });
      return;
    }
    if (approvals.length > 0 && !(key.ctrl && input === 'c')) {
      const outcome = approvalOutcome(input, key);
      if (outcome !== null) {
        answerApproval(outcome);
      }
      return;
    }
    // Watching a subagent: esc goes back to the session; the rest of the
    // keys scroll as anywhere.
    if (viewer !== undefined && key.escape) {
      onBack?.();
      return;
    }
    if (menu.length > 0 && !key.ctrl) {
      if (key.upArrow) {
        setMenuCursor((cursor - 1 + menu.length) % menu.length);
        return;
      }
      if (key.downArrow) {
        setMenuCursor((cursor + 1) % menu.length);
        return;
      }
      if (key.tab) {
        if (menu[cursor].settle !== undefined) {
          pickRef(menu[cursor], true);
        } else {
          setInput(`/${menu[cursor].name} `);
        }
        return;
      }
      if (key.escape) {
        setMenuClosedFor(composerText.current);
        return;
      }
    }
    if (key.ctrl && input === 'c') {
      handleExit();
    } else if (key.escape && busy && typeof onInterrupt === 'function') {
      onInterrupt();
    } else if (key.escape) {
      setScrollLines(0);
    } else if (key.ctrl && input === 't') {
      // The lowest thought on screen: the latest at the foot, an older one
      // scrolled to. With every thought open, ctrl+t folds them all.
      if (allThoughts) {
        setAllThoughts(false);
        setOpenThoughts(new Set());
      } else {
        const target = [...visibleRef.current].reverse().find(i => i.reasoning);
        if (target !== undefined) {
          setOpenThoughts(prev => {
            const next = new Set(prev);
            if (next.has(target.id)) {
              next.delete(target.id);
            } else {
              next.add(target.id);
            }
            return next;
          });
        }
      }
    } else if (key.upArrow || key.pageUp) {
      setScrollLines(v => v + viewportStep.current);
    } else if (key.downArrow || key.pageDown) {
      setScrollLines(v => Math.max(0, v - viewportStep.current));
    }
  });

  /** Map one SessionEvent to UI state. Defensive: unknown shapes are ignored. */
  const handleEvent = useCallback(
    event => {
      if (!event || typeof event !== 'object') {
        return;
      }
      lastEventAt.current = Date.now();
      // Events below the agent's live boundary are seed history, not chat —
      // except a resumed session's past, which is replayed on purpose.
      if (!replaying.current && typeof event.seq === 'number' && event.seq < firstSeq) {
        return;
      }
      const data = event.data && typeof event.data === 'object' ? event.data : {};
      setStanding(s => foldStanding(s, event));
      deliverables.current = foldDeliverables(deliverables.current, event);
      speed.current = foldSpeed(speed.current, event, Date.now());
      if (event.type === 'session/title' && typeof data.title === 'string') {
        setSessionTitle(data.title);
      }
      const instr = foldInstructions(instructionFiles.current, event);
      if (instr.changed.length > 0) {
        instructionFiles.current = instr.files;
        pushItem({ kind: 'status', text: changesText(instr.changed) });
      }
      if (event.type === 'assistant/message') {
        setTotals(speed.current.totals);
      }
      setReminders(r => foldSchedule(r, event));
      // A workflow run is one block in the transcript, redrawn as its
      // members start and end.
      const run = foldWorkflow(workflowRuns.current, event);
      if (run !== undefined) {
        const block = { kind: 'status', workflow: run.runId, text: workflowText(run) };
        setItems(prev =>
          prev.some(i => i.workflow === run.runId)
            ? prev.map(i => (i.workflow === run.runId ? block : i))
            : [...prev, block],
        );
      }
      switch (event.type) {
        case 'user/message': {
          // Live, the user's own message is on screen already (send pushes
          // it); replaying a resumed session's past, it is drawn from the
          // log. Messages the harness writes (runtime context, reminders)
          // are not the user's and are left out.
          // A reminder that came due (dsh-schedule) is a message the
          // harness sends; it is shown, or the answer would come from
          // nowhere.
          if (data.source?.kind === 'plugin' && data.source.plugin === 'schedule') {
            const text = (data.content ?? []).find(c => c.type === 'text')?.text;
            pushItem({
              kind: 'status',
              text: `⏰ reminder${typeof text === 'string' ? `: ${reminderPrompt(text)}` : ''}`,
            });
          }
          if (replaying.current && data.source?.kind === 'user') {
            const text = contentText(data.content ?? []);
            if (text !== '') {
              pushItem({ kind: 'user', text: shownMentions(text) });
            }
          }
          break;
        }
        case 'turn/start':
          setBusy(true);
          turnStart.current = Date.now();
          lastEventAt.current = Date.now();
          setScrollLines(0);
          setStream({ reasoning: '', text: '', tool: null });
          runningTools.current.clear();
          toolResults.current.clear();
          // Mirror the harness todos projection: cleared by the next turn/start
          // (turn/end keeps the finished checklist visible).
          setTodos([]);
          usageRef.current = null;
          break;
        case 'turn/end': {
          setBusy(false);
          turnStart.current = undefined;
          clearHint();
          const reason = data.reason && typeof data.reason === 'object' ? data.reason : {};
          if (data.usage && typeof data.usage === 'object') {
            usageRef.current = data.usage;
          }
          // Close any tool rows the harness never finished: a dangling spinner
          // reads as a stuck TUI even when the turn itself ended.
          const dangling = [...runningTools.current.entries()];
          runningTools.current.clear();
          if (dangling.length > 0) {
            const danglingIds = new Set(dangling.map(([id]) => id));
            const closed = reason.kind === 'completed' ? 'done' : 'error';
            setItems(prev =>
              prev.map(item =>
                item.kind === 'tool' && item.status === 'running' && danglingIds.has(item.callId)
                  ? {
                      ...item,
                      status: closed,
                      error:
                        closed === 'error'
                          ? { name: 'interrupted', code: 'turn-ended' }
                          : undefined,
                    }
                  : item,
              ),
            );
          }
          const label = reasonText(reason);
          const usageLine = usageText(usageRef.current);
          const isError = reason.kind === 'error';
          const parts = [label];
          if (usageLine !== '') {
            parts.push(usageLine);
          }
          if (isError) {
            parts.push('/retry to try again');
          }
          const text = parts.join(' · ');
          const base = `${process.cwd()}/`;
          const produced = deliverables.current.produced.map(f =>
            f.startsWith(base) ? f.slice(base.length) : f,
          );
          if (produced.length > 0) {
            setSessionFiles(prev => [...prev.filter(f => !produced.includes(f)), ...produced]);
          }
          const changed = deliverablesText(
            deliverables.current.produced,
            process.cwd(),
            widthRef.current,
          );
          setItems(prev => {
            const divider = prev.length === 0 ? [] : [{ kind: 'divider' }];
            const files = changed === undefined ? [] : [{ kind: 'status', text: changed }];
            return [...prev, ...divider, ...files, { kind: 'status', text, error: isError }];
          });
          break;
        }
        case 'assistant/chunk': {
          const chunk = data.chunk && typeof data.chunk === 'object' ? data.chunk : {};
          if (chunk.type === 'text-delta' && typeof chunk.text === 'string') {
            setStream(prev => ({ ...prev, text: prev.text + chunk.text }));
          } else if (chunk.type === 'reasoning-delta' && typeof chunk.text === 'string') {
            setStream(prev => ({ ...prev, reasoning: prev.reasoning + chunk.text }));
          } else if (chunk.type === 'tool-call-delta' && typeof chunk.argumentsDelta === 'string') {
            setStream(prev => ({
              ...prev,
              tool: {
                name: typeof chunk.name === 'string' ? chunk.name : (prev.tool?.name ?? ''),
                args: (prev.tool?.args ?? '') + chunk.argumentsDelta,
              },
            }));
          } else if (chunk.type === 'usage' && chunk.usage && typeof chunk.usage === 'object') {
            usageRef.current = chunk.usage;
          }
          break;
        }
        case 'assistant/message': {
          const message = data.message && typeof data.message === 'object' ? data.message : {};
          if (typeof message.id === 'string') {
            lastAnswerId.current = message.id;
          }
          const content = Array.isArray(message.content) ? message.content : [];
          const itemUsage = data.usage && typeof data.usage === 'object' ? data.usage : undefined;
          if (itemUsage) {
            usageRef.current = itemUsage;
          }
          setStream({ reasoning: '', text: '', tool: null });
          pushItem({
            kind: 'assistant',
            text: blocksText(content, 'text'),
            reasoning: blocksText(content, 'reasoning'),
            usage: itemUsage,
            rate: speed.current.rate,
          });
          break;
        }
        case 'tool/call': {
          const callId = typeof data.callId === 'string' ? data.callId : `t${Date.now()}`;
          setStream(prev => (prev.tool ? { ...prev, tool: null } : prev));
          const name = typeof data.name === 'string' ? data.name : 'tool';
          const args = typeof data.arguments === 'string' ? data.arguments : '';
          const pre = toolResults.current.get(callId);
          if (pre !== undefined) {
            // The result arrived before its call row (out-of-order stream):
            // render the row already done instead of leaving a live spinner.
            toolResults.current.delete(callId);
            pushItem({ kind: 'tool', callId, name, args, ...pre });
          } else {
            toolStarts.current.set(callId, Date.now());
            runningTools.current.set(callId, { name, args });
            pushItem({ kind: 'tool', callId, name, args, status: 'running' });
          }
          break;
        }
        case 'tool/result': {
          const message =
            data.message && typeof data.message === 'object' ? data.message : undefined;
          const callId =
            typeof data.callId === 'string'
              ? data.callId
              : message && message.source && typeof message.source.callId === 'string'
                ? message.source.callId
                : undefined;
          const resultBlock = Array.isArray(message?.content)
            ? message.content.find(block => block && block.type === 'tool-result')
            : undefined;
          const errorInfo = data.error && typeof data.error === 'object' ? data.error : undefined;
          const isError =
            errorInfo !== undefined ? true : resultBlock ? resultBlock.isError === true : false;
          const start = callId !== undefined ? toolStarts.current.get(callId) : undefined;
          if (callId !== undefined) {
            toolStarts.current.delete(callId);
          }
          const seconds = start !== undefined ? (Date.now() - start) / 1000 : undefined;
          const text = toolResultText(message);
          const info = {
            status: isError ? 'error' : 'done',
            seconds,
            output: text,
            error: isError
              ? { name: errorInfo?.name ?? 'tool error', code: errorInfo?.code }
              : undefined,
          };
          let target = callId;
          if (target === undefined) {
            // No id on the wire: patch the oldest still-running tool row.
            const first = runningTools.current.keys().next();
            if (!first.done) {
              target = first.value;
            }
          }
          if (target !== undefined) {
            runningTools.current.delete(target);
          }
          // Stash the outcome so a late tool/call (out-of-order stream) can
          // render the row done; capped so the guard cannot grow unbounded.
          toolResults.current.set(target ?? `t${Date.now()}`, info);
          if (toolResults.current.size > 32) {
            toolResults.current.delete(toolResults.current.keys().next().value);
          }
          setItems(prev =>
            prev.map(item =>
              item.kind === 'tool' && target !== undefined && item.callId === target
                ? { ...item, ...info }
                : item,
            ),
          );
          break;
        }
        case 'todo/write': {
          if (Array.isArray(data.todos)) {
            setTodos(data.todos);
          }
          break;
        }
        default:
          // user/message is already shown optimistically; unknown event types
          // (fast-moving harness) are ignored safely.
          break;
      }
    },
    [firstSeq, pushItem, clearHint],
  );

  // Register this component's event consumer with the non-React bridge once.
  useEffect(() => {
    onEvent(handleEvent);
    return () => onEvent(null);
  }, [onEvent, handleEvent]);

  // A resumed session's past, replayed once through the same handler as live
  // events, so it is drawn as it was when it happened.
  useEffect(() => {
    if (history.length === 0) {
      return;
    }
    replaying.current = true;
    for (const event of history) {
      handleEvent(event);
    }
    replaying.current = false;
    // A turn the past ends inside is still running — a subagent being
    // watched, or this session's own turn while a subagent was on screen —
    // and its next events arrive live.
    const lastStart = history.findLastIndex(e => e.type === 'turn/start');
    const running = lastStart > history.findLastIndex(e => e.type === 'turn/end');
    setBusy(running);
    if (!running) {
      setStream({ reasoning: '', text: '', tool: null });
    }
    pushItem({
      kind: 'status',
      text: `${replayNote} · ${history.filter(e => e.type === 'turn/end').length} turns`,
    });
  }, []); // once, on mount: the past does not change

  // The harness's approval requests for this agent (index.js): each waits
  // for the user's answer. A request the harness withdraws (its signal
  // aborts: the turn was cancelled) leaves the prompt and settles itself.
  useEffect(() => {
    if (typeof onApproval !== 'function') {
      return undefined;
    }
    onApproval(
      request =>
        new Promise(resolve => {
          const tool =
            request.callId !== undefined ? runningTools.current.get(request.callId) : undefined;
          const entry = {
            toolName: request.toolName,
            args: tool?.args ?? '',
            reason: request.reason,
            resolve,
          };
          if (request.signal) {
            if (request.signal.aborted) {
              resolve('cancelled');
              return;
            }
            request.signal.addEventListener(
              'abort',
              () => {
                setApprovals(prev => prev.filter(a => a !== entry));
                resolve('cancelled');
              },
              { once: true },
            );
          }
          setApprovals(prev => [...prev, entry]);
        }),
    );
    return () => onApproval(null);
  }, [onApproval]);

  // The questions the agent asks (index.js). A request the harness withdraws
  // leaves the screen and rejects, which the harness reports as aborted.
  useEffect(() => {
    if (typeof onQuestion !== 'function') {
      return undefined;
    }
    onQuestion(
      request =>
        new Promise((resolve, reject) => {
          const entry = { state: newQuestions(request.questions ?? []), resolve };
          if (request.signal) {
            if (request.signal.aborted) {
              reject(new Error('the question was withdrawn'));
              return;
            }
            request.signal.addEventListener(
              'abort',
              () => {
                setAsks(prev => prev.filter(a => a !== entry));
                reject(new Error('the question was withdrawn'));
              },
              { once: true },
            );
          }
          setAsks(prev => [...prev, entry]);
        }),
    );
    return () => onQuestion(null);
  }, [onQuestion]);

  const send = useCallback(
    text => {
      const value = typeof text === 'string' ? text.trim() : '';
      if (value === '') {
        return;
      }
      if (busy) {
        showBusyHint();
        return;
      }
      setInput('');
      setHint(null);
      setScrollLines(0);
      setBusy(true);
      lastUserText.current = value;
      const images = pendingImages.map(ref => ({ type: 'image', attachment: ref }));
      setPendingImages([]);
      pushItem({
        kind: 'user',
        text: shownMentions(contentText([{ type: 'text', text: value }, ...images])),
      });
      try {
        // Fire-and-forget: session events drive the UI, not this promise.
        followup(
          createUserMessage({
            content: [{ type: 'text', text: value }, ...images],
            source: { kind: 'user' },
          }),
        );
      } catch (error) {
        setBusy(false);
        pushItem({
          kind: 'status',
          text: `✗ ${error instanceof Error ? error.message : String(error)}`,
          error: true,
        });
      }
    },
    [busy, followup, pushItem, showBusyHint, pendingImages],
  );

  const handleSubmit = useCallback(
    value => {
      const text = typeof value === 'string' ? value.trim() : '';
      if (text === '') {
        return;
      }
      // Slash commands stay usable while a turn is running (quit/clear must
      // never be hostage to the model).
      if (text === '/help') {
        setInput('');
        setHint(null);
        pushItem({
          kind: 'status',
          text: helpText(typeof listCommands === 'function' ? listCommands() : []),
        });
        return;
      }
      // The session's title, as the web app renames it (sessionTitle): what
      // /sessions and the @ menu list it by.
      if (text === '/rename' || text.startsWith('/rename ')) {
        setInput('');
        const title = text.slice('/rename'.length).trim();
        if (title === '') {
          pushItem({ kind: 'status', text: 'usage: /rename <title>' });
          return;
        }
        try {
          const accepted = renameSession(title);
          pushItem({ kind: 'status', text: `renamed: ${accepted?.title ?? title}` });
        } catch (error) {
          pushItem({
            kind: 'status',
            text: `✗ ${error instanceof Error ? error.message : String(error)}`,
            error: true,
          });
        }
        return;
      }
      // The subagents this session started, at every depth (the web app's
      // descendant catalog): one picked is shown read-only, live while it
      // runs, and esc comes back.
      if (text === '/agents') {
        setInput('');
        if (typeof listAgents !== 'function') {
          pushItem({ kind: 'status', text: 'no subagent support here' });
          return;
        }
        void Promise.resolve(listAgents()).then(
          rows => {
            if (rows.length === 0) {
              pushItem({ kind: 'status', text: 'this session has started no subagents' });
              return;
            }
            const entry = {
              state: newQuestions([
                {
                  id: 'agent',
                  question: 'Subagent to watch (read-only; esc there comes back)',
                  custom: false,
                  options: rows.map(r => ({ label: r.label, description: r.description })),
                },
              ]),
              resolve: answer => {
                const picked = answer.answers[0]?.selected?.[0];
                const row = rows.find(r => r.label === picked);
                if (row !== undefined && row.id !== undefined) {
                  void Promise.resolve(openAgent(row.id, row)).catch(error =>
                    pushItem({
                      kind: 'status',
                      text: `✗ ${error instanceof Error ? error.message : String(error)}`,
                      error: true,
                    }),
                  );
                }
              },
            };
            setAsks(prev => [...prev, entry]);
          },
          error =>
            pushItem({
              kind: 'status',
              text: `✗ ${error instanceof Error ? error.message : String(error)}`,
              error: true,
            }),
        );
        return;
      }
      // The last turns as a ledger with timings: /trajectory, or
      // /trajectory 3 for the last three.
      if (text === '/trajectory' || text.startsWith('/trajectory ')) {
        setInput('');
        const n = Number.parseInt(text.slice('/trajectory'.length).trim() || '1', 10);
        pushItem({
          kind: 'status',
          text:
            typeof sessionEvents === 'function'
              ? trajectoryText(sessionEvents(), Number.isFinite(n) && n > 0 ? n : 1, Date.now())
              : 'no session log here',
        });
        return;
      }
      // The model providers and their keys: a few questions in the
      // composer's place (src/models.js).
      // The plugins' configuration (src/settingsview.js): listed, and a
      // field set or put back, validated by the harness.
      if (text === '/settings' || text.startsWith('/settings ')) {
        setInput('');
        if (settingsService === undefined) {
          pushItem({ kind: 'status', text: 'no settings here' });
          return;
        }
        const described = settingsService.describe();
        const edit = parseSettingsArgs(
          text.slice('/settings'.length),
          described.map(d => d.ns),
        );
        if ('error' in edit) {
          pushItem({ kind: 'status', text: `✗ ${edit.error}`, error: true });
          return;
        }
        if (edit.op === 'show') {
          pushItem({ kind: 'status', text: settingsText(described) });
          return;
        }
        const key = `${edit.ns}.${edit.path.join('.')}`;
        void settingsService.mutate(edit.ns, [edit]).then(
          () =>
            pushItem({
              kind: 'status',
              text:
                edit.op === 'set'
                  ? `${key} = ${JSON.stringify(edit.value)}`
                  : `${key} is back to the profile's`,
            }),
          error =>
            pushItem({
              kind: 'status',
              text: `✗ ${key}: ${error instanceof Error ? error.message : String(error)}`,
              error: true,
            }),
        );
        return;
      }
      if (text === '/plugins' || text.startsWith('/plugins ')) {
        setInput('');
        pushItem({
          kind: 'status',
          text:
            typeof listPlugins === 'function'
              ? pluginsText(listPlugins(), text.slice('/plugins'.length), widthRef.current)
              : 'no plugin list here',
        });
        return;
      }
      if (text === '/theme' || text.startsWith('/theme ')) {
        setInput('');
        const wanted = text.slice('/theme'.length).trim();
        if (wanted === '') {
          pushItem({ kind: 'status', text: `theme: ${theme} — /theme ${THEMES.join('|')}` });
          return;
        }
        if (!THEMES.includes(wanted) || typeof setTheme !== 'function') {
          pushItem({ kind: 'status', text: `✗ /theme ${THEMES.join('|')}`, error: true });
          return;
        }
        try {
          setThemeBg(setTheme(wanted));
          setThemeName(wanted);
          pushItem({ kind: 'status', text: `theme: ${wanted}, kept for the next start` });
        } catch (error) {
          pushItem({
            kind: 'status',
            text: `✗ ${error instanceof Error ? error.message : String(error)}`,
            error: true,
          });
        }
        return;
      }
      // An image on the next message: admitted now, so a file that is not
      // an image, or a model that takes none, is said before the message
      // is written.
      if (text === '/image' || text.startsWith('/image ')) {
        setInput('');
        const arg = text.slice('/image'.length).trim();
        if (arg === 'clear') {
          setPendingImages([]);
          pushItem({ kind: 'status', text: 'attachments cleared' });
          return;
        }
        if (arg === '' || typeof attachImage !== 'function') {
          pushItem({
            kind: 'status',
            text: 'usage: /image <path> — PNG, JPEG, WebP or GIF; /image clear drops them',
          });
          return;
        }
        void attachImage(pathArg(arg)).then(
          ref => setPendingImages(prev => [...prev, ref]),
          error =>
            pushItem({
              kind: 'status',
              text: `✗ ${error instanceof Error ? error.message : String(error)}`,
              error: true,
            }),
        );
        return;
      }
      if (text === '/rate' || text.startsWith('/rate ')) {
        setInput('');
        const edit = parseRate(text.slice('/rate'.length));
        const say = (line, error = false) => pushItem({ kind: 'status', text: line, error });
        if ('error' in edit) {
          say(`✗ ${edit.error}`, true);
          return;
        }
        if (feedback === undefined || lastAnswerId.current === undefined) {
          say(feedback === undefined ? 'no feedback store here' : 'no answer to rate yet');
          return;
        }
        const messageId = lastAnswerId.current;
        void (async () => {
          const current = await feedback.get(messageId);
          if (edit.op === 'show') {
            say(ratingText(current));
          } else if (edit.op === 'clear') {
            if (current !== undefined) {
              await feedback.remove(messageId, current.version);
            }
            say('the last answer is not rated now');
          } else {
            const item = await feedback.put(
              messageId,
              edit.rating,
              edit.note,
              current?.version ?? null,
            );
            say(`${ratingText(item)} — kept with the session; the model does not see it`);
          }
        })().catch(error =>
          say(`✗ ${error instanceof Error ? error.message : String(error)}`, true),
        );
        return;
      }
      if (text === '/models') {
        setInput('');
        if (modelsService === undefined) {
          pushItem({ kind: 'status', text: 'no settings here' });
          return;
        }
        const ask = questions =>
          new Promise(resolve =>
            setAsks(prev => [
              ...prev,
              { state: newQuestions(questions), resolve: answer => resolve(answer?.answers) },
            ]),
          );
        const say = (line, error = false) => pushItem({ kind: 'status', text: line, error });
        void modelsFlow({ ask, say }, modelsService).catch(error =>
          say(`✗ ${error instanceof Error ? error.message : String(error)}`, true),
        );
        return;
      }
      if (text === '/thinking' || text.startsWith('/thinking ')) {
        setInput('');
        const arg = text.slice('/thinking'.length).trim();
        if (arg === 'all') {
          setAllThoughts(true);
        } else if (arg === 'none') {
          setAllThoughts(false);
          setOpenThoughts(new Set());
        } else {
          pushItem({
            kind: 'status',
            text: 'ctrl+t opens or folds the lowest thought on screen · /thinking all · /thinking none',
          });
        }
        return;
      }
      if (text === '/sidebar' || text.startsWith('/sidebar ')) {
        setInput('');
        const arg = text.slice('/sidebar'.length).trim();
        setSidebarPref(prev =>
          ['on', 'off', 'auto'].includes(arg) ? arg : sidebarShown(prev, termCols) ? 'off' : 'on',
        );
        return;
      }
      if (text === '/instructions') {
        setInput('');
        pushItem({ kind: 'status', text: instructionsText(instructionFiles.current) });
        return;
      }
      if (text === '/schedule') {
        setInput('');
        pushItem({ kind: 'status', text: scheduleText(reminders, Date.now()) });
        return;
      }
      if (text === '/jobs') {
        setInput('');
        pushItem({
          kind: 'status',
          text: jobsText(typeof listJobs === 'function' ? listJobs() : [], Date.now()),
        });
        return;
      }
      if (text === '/mcp') {
        setInput('');
        pushItem({
          kind: 'status',
          text: typeof mcpStatus === 'function' ? mcpStatus() : 'no MCP support here',
        });
        return;
      }
      if (text === '/clear') {
        setInput('');
        clearHint();
        setItems([]);
        setTodos([]);
        setStream({ reasoning: '', text: '', tool: null });
        usageRef.current = null;
        turnStart.current = undefined;
        toolStarts.current = new Map();
        runningTools.current = new Map();
        toolResults.current = new Map();
        setScrollLines(0);
        return;
      }
      if (text === '/exit' || text === '/quit') {
        setInput('');
        handleExit();
        return;
      }
      if (text === '/retry') {
        setInput('');
        if (busy) {
          showBusyHint();
        } else if (lastUserText.current === '') {
          flashHint('(nothing to retry yet)');
        } else {
          send(lastUserText.current);
        }
        return;
      }
      if (text === '/sessions' && typeof listSessions === 'function') {
        setInput('');
        void Promise.resolve(listSessions()).then(list => {
          if (list.length === 0) {
            pushItem({ kind: 'status', text: 'no other session in this directory' });
            return;
          }
          const now = Date.now();
          const entry = {
            state: newQuestions([
              {
                id: 'session',
                custom: false,
                question: 'Resume which session of this directory?',
                options: list.map(s => ({
                  label: s.title.slice(0, 60),
                  description: `${whenOf(s.createdAt, now)} · ${s.id}`,
                })),
              },
            ]),
            resolve: answer => {
              const label = answer.answers[0]?.selected?.[0];
              const chosen = list.find(s => s.title.slice(0, 60) === label);
              if (chosen !== undefined && typeof switchSession === 'function') {
                void Promise.resolve(switchSession(chosen.id)).catch(error =>
                  pushItem({
                    kind: 'status',
                    text: `✗ could not resume: ${error instanceof Error ? error.message : String(error)}`,
                  }),
                );
              }
            },
          };
          setAsks(prev => [...prev, entry]);
        });
        return;
      }
      if ((text === '/model' || text.startsWith('/model ')) && typeof listModels === 'function') {
        setInput('');
        const wanted = text.slice('/model'.length).trim();
        void Promise.resolve(listModels()).then(models => {
          if (models.length === 0) {
            pushItem({ kind: 'status', text: 'no models are configured' });
            return;
          }
          const apply = m => {
            selectModel(m);
            setModelLabel(m.model);
            pushItem({
              kind: 'status',
              text: `model ${m.provider}/${m.model} — from the next step, and for new sessions`,
            });
          };
          if (wanted !== '') {
            const m = pickModel(models, wanted);
            if (m === undefined) {
              pushItem({ kind: 'status', text: `no model ${wanted} — /model lists them` });
            } else {
              apply(m);
            }
            return;
          }
          // Chosen with the question screen: the routes' models as options,
          // the current one marked.
          const now = typeof currentModel === 'function' ? currentModel() : undefined;
          const options = models.map(m => ({
            label: `${m.provider}/${m.model}`,
            description:
              (m.name && m.name !== m.model ? m.name : m.providerName) +
              (now && now.provider === m.provider && now.model === m.model ? ' · current' : ''),
          }));
          const entry = {
            state: newQuestions([{ id: 'model', question: 'Model for this session', options }]),
            resolve: answer => {
              const label = answer.answers[0]?.selected?.[0] ?? answer.answers[0]?.custom;
              const m = label ? pickModel(models, label) : undefined;
              if (m !== undefined) {
                apply(m);
              }
            },
          };
          setAsks(prev => [...prev, entry]);
        });
        return;
      }
      // Any other /command is the harness's (dsh-commands): it runs against
      // the agent, never as a model message — a line naming no command is
      // said so rather than sent to the model. A line led by a skill's name
      // is a message: the harness loads the skill from that token
      // (dsh-tool-skill).
      if (
        text.startsWith('/') &&
        !(skills ?? []).some(s => s.name === leadingName(text)) &&
        typeof runCommand === 'function'
      ) {
        setInput('');
        void Promise.resolve(runCommand(text)).then(
          execution => {
            if (execution === undefined) {
              pushItem({
                kind: 'status',
                text: `unknown command ${text.split(/\s/)[0]} — /help lists them`,
              });
              return;
            }
            const result = execution.result ?? {};
            const said = result.text ?? (result.kind === 'error' ? 'failed' : 'done');
            pushItem({ kind: 'status', text: result.kind === 'error' ? `✗ ${said}` : said });
          },
          error =>
            pushItem({
              kind: 'status',
              text: `✗ ${error instanceof Error ? error.message : String(error)}`,
            }),
        );
        return;
      }
      if (busy) {
        showBusyHint();
        return;
      }
      send(text);
    },
    [
      busy,
      handleExit,
      send,
      showBusyHint,
      flashHint,
      runCommand,
      skills,
      mcpStatus,
      renameSession,
      listAgents,
      openAgent,
      listJobs,
      sessionEvents,
      modelsService,
      settingsService,
      listPlugins,
      theme,
      setTheme,
      termCols,
      attachImage,
      feedback,
      reminders,
      listCommands,
      listModels,
      currentModel,
      selectModel,
    ],
  );
  handleSubmitRef.current = handleSubmit;

  // The lines in the composer's place beyond its own: the `/` menu above
  // it, or an approval or a question shown instead of it.
  const menuShown = menuLines(menu, cursor, width);
  const composerExtra =
    approvals.length > 0
      ? approvalLines(approvals[0], width).length - 1
      : asks.length > 0
        ? questionLines(asks[0].state, width).length - 1
        : menuShown.length;
  const standingShown = [
    ...standingLines(standing, width),
    ...(pendingImages.length > 0
      ? [
          {
            text: `${pendingImages.map(imageLabel).join('  ')}  · on the next message (/image clear)`,
            style: 'goal',
          },
        ]
      : []),
  ];

  // ── Viewport: keep the transcript tail visible (bottom-anchored), with
  // line-based scrolling on top (scrollLines = lines offset from the bottom).
  // The bottom of the screen, fixed: what is shown over the composer
  // (todos, plan and goal, attachments, the scroll hint), the rule that
  // carries the status, the composer — or a menu, an approval, a question
  // in or over its place — and the footer. The transcript gets exactly the
  // rest: let it grow and the layout squeezed the composer and the footer
  // off the screen while an answer streamed in.
  const todoLines = todos.length > 0 ? 2 + todos.length : 0;
  const inputLines =
    viewer !== undefined && approvals.length === 0 && asks.length === 0 ? 1 : composerExtra + 1;
  const chrome = todoLines + standingShown.length + (scrollLines > 0 ? 1 : 0) + 1 + inputLines + 1;
  const room = Math.max(3, rows - chrome);
  const viewport = computeViewport({
    items,
    rows,
    width,
    scrollLines,
    busy,
    todos,
    thinkingOpen: thoughtOpen,
    composerExtra: composerExtra + standingShown.length,
    room,
    streamLines: estimateStreamLines(stream, width, allThoughts),
  });
  const { visible, scrollLines: clampedLines, atBottom, step, overflowTop } = viewport;
  visibleRef.current = visible;
  useEffect(() => {
    viewportStep.current = step;
  }, [step]);

  // ── Layout ───────────────────────────────────────────────────────────────────
  // Empty state: DeepSeek brand banner + info panel (Hermes-style), no
  // permanent chrome — model · cwd live in the footer once the chat starts.
  const cwd = typeof process !== 'undefined' && process.cwd ? process.cwd() : '';
  const home = typeof process !== 'undefined' ? process.env.HOME : undefined;
  const shortCwd =
    cwd !== '' && home && cwd.startsWith(home)
      ? cwd === home
        ? '~'
        : `~${cwd.slice(home.length)}`
      : cwd;

  const DEEPSEEK_LOGO = [
    '██████╗ ███████╗███████╗██████╗ ███████╗███████╗███████╗██╗  ██╗',
    '██╔══██╗██╔════╝██╔════╝██╔══██╗██╔════╝██╔════╝██╔════╝██║ ██╔╝',
    '██║  ██║█████╗  █████╗  ██████╔╝███████╗█████╗  █████╗  █████╔╝ ',
    '██║  ██║██╔══╝  ██╔══╝  ██╔═══╝ ╚════██║██╔══╝  ██╔══╝  ██╔═██╗ ',
    '██████╔╝███████╗███████╗██║     ███████║███████╗███████╗██║  ██╗',
    '╚═════╝ ╚══════╝╚══════╝╚═╝     ╚══════╝╚══════╝╚══════╝╚═╝  ╚═╝',
  ];
  const LOGO_GRADIENT = ['#4D6BFE', '#5B79FE', '#6D8AFE', '#829CFE', '#9AB1FF', '#B5C6FF'];

  const welcome =
    items.length === 0 && stream.text === '' && stream.reasoning === '' && stream.tool === null
      ? el(
          Box,
          {
            flexDirection: 'column',
            alignItems: 'center',
            marginTop: 1,
            paddingLeft: 1,
            paddingRight: 1,
          },
          ...DEEPSEEK_LOGO.map((line, i) =>
            el(Text, { key: `logo${i}`, color: LOGO_GRADIENT[i] }, line),
          ),
          el(
            Box,
            { flexDirection: 'row', marginTop: 1 },
            el(Text, { bold: true, color: '#6D8AFE' }, 'DeepSeek Harness'),
            el(Text, { dimColor: true }, '  ·  terminal AI chat for the DeepSeek Harness'),
          ),
          el(
            Box,
            {
              borderStyle: 'single',
              borderColor: '#4D6BFE',
              marginTop: 1,
              paddingLeft: 2,
              paddingRight: 2,
              flexDirection: 'column',
            },
            el(
              Box,
              { flexDirection: 'row' },
              el(Text, { dimColor: true }, 'model     '),
              el(Text, { bold: true }, model),
              el(Text, { dimColor: true }, '  ·  StepFun Step Explore'),
            ),
            el(
              Box,
              { flexDirection: 'row' },
              el(Text, { dimColor: true }, 'directory '),
              el(Text, {}, shortCwd),
            ),
            el(
              Box,
              { flexDirection: 'row' },
              el(Text, { dimColor: true }, 'commands  '),
              el(Text, {}, '/help · /clear · /exit'),
            ),
          ),
          el(Text, { dimColor: true, marginTop: 1 }, 'press /help for keys · ctrl + c to quit'),
        )
      : null;

  const transcript = el(
    Box,
    // flexShrink 0: shrunk to the room, it let its content run out below
    // it, so laying the room out from its bottom showed the head of the
    // last answer — the thinking — and not its end, the answer itself.
    { flexDirection: 'column', paddingLeft: 1, paddingRight: 1, flexShrink: 0 },
    el(
      ErrorBoundary,
      { resetKey: items.length },
      welcome,
      ...visible.map((item, index) =>
        el(ChatRow, { key: index, item, width, thinkingOpen: thoughtOpen(item), themeBg }),
      ),
      ...(clampedLines === 0
        ? [el(StreamBlock, { key: 'stream', stream, width, thinkingOpen: allThoughts, themeBg })]
        : []),
    ),
  );

  const idleSeconds = busy ? Math.floor((Date.now() - lastEventAt.current) / 1000) : 0;
  // The rule over the composer, carrying the status: a line whatever
  // happens, so the composer does not move when a turn starts or ends.
  const live = busy ? liveRate(speed.current, Date.now()) : undefined;
  // One line of text, its dashes counted: a box of dashes as wide as the
  // terminal, shrunk to fit, was measured at its full width and drew over
  // the status beside it.
  const elapsed =
    busy && turnStart.current !== undefined
      ? fmtElapsedCompact(Date.now() - turnStart.current)
      : '';
  const statusParts = busy
    ? [
        ` ${elapsed}`,
        live !== undefined ? ` · ~${fmtRate(live)}` : '',
        idleSeconds >= 15 ? ` · model thinking ${idleSeconds}s` : '',
        ' ',
      ].join('')
    : '';
  const ruleRight = busy ? (viewer !== undefined ? ' esc back ─' : ' esc interrupt ─') : ' /help ─';
  const ruleLeft = busy ? '─ ⠋ Working' : '─';
  const fill = Math.max(
    1,
    cols - 2 - strWidth(ruleLeft) - strWidth(statusParts) - strWidth(ruleRight),
  );
  const statusRule = el(
    Box,
    { paddingLeft: 1, paddingRight: 1, flexShrink: 0, height: 1 },
    el(
      Text,
      { wrap: 'truncate' },
      el(Text, { dimColor: true }, busy ? '─ ' : '─'),
      ...(busy
        ? [
            el(BrailleSpinner),
            el(Text, { bold: true, color: ACCENT }, ' Working'),
            el(Text, { dimColor: true, color: idleSeconds >= 60 ? ERR : undefined }, statusParts),
          ]
        : []),
      el(Text, { dimColor: true }, '─'.repeat(fill) + ruleRight),
    ),
  );

  const scrollHint = !atBottom
    ? el(
        Text,
        { dimColor: true },
        `  ↑ ${clampedLines} line${clampedLines === 1 ? '' : 's'} above · esc back to latest`,
      )
    : null;

  const questionStyle = {
    title: { bold: true, color: 'cyan' },
    row: {},
    selected: { bold: true, color: ACCENT },
    detail: { dimColor: true },
    input: { color: ACCENT },
    keys: { dimColor: true },
  };
  const inputRow =
    viewer !== undefined && approvals.length === 0 && asks.length === 0
      ? el(
          Box,
          { paddingLeft: 1, paddingRight: 1 },
          el(
            Text,
            { color: ACCENT },
            `◂ subagent ${viewer.label} · ${[viewer.mode, busy ? 'running' : 'done'].filter(Boolean).join(' · ')} · read-only — esc goes back`,
          ),
        )
      : approvals.length === 0 && asks.length > 0
        ? el(
            Box,
            { paddingLeft: 1, paddingRight: 1, flexDirection: 'column' },
            ...questionLines(asks[0].state, width).map((line, i) =>
              el(Text, { key: i, ...questionStyle[line.style] }, line.text),
            ),
          )
        : approvals.length > 0
          ? el(
              Box,
              { paddingLeft: 1, paddingRight: 1, flexDirection: 'column' },
              ...approvalLines(approvals[0], width).map((line, i) =>
                el(
                  Text,
                  i === 0 ? { key: i, bold: true, color: 'yellow' } : { key: i, dimColor: i > 0 },
                  line,
                ),
              ),
            )
          : el(
              Box,
              { flexDirection: 'column' },
              ...menuShown.map((line, i) =>
                el(
                  Box,
                  { key: `m${i}`, paddingLeft: 1, paddingRight: 1 },
                  el(
                    Text,
                    line.selected ? { bold: true, color: ACCENT } : { dimColor: line.dim === true },
                    line.text,
                  ),
                ),
              ),
              el(
                Box,
                { key: 'composer', paddingLeft: 1, paddingRight: 1, flexDirection: 'row' },
                el(Text, { bold: true, color: ACCENT }, '❯ '),
                el(Composer, {
                  ref: composerApi,
                  initial: composerText.current,
                  onChange: onComposerChange,
                  // enter on an open menu picks its row: a bare command runs,
                  // one taking an argument or a skill is completed to be
                  // finished.
                  onSubmit: value =>
                    menu.length > 0 ? pickFromMenu(menu[cursor]) : handleSubmit(value),
                  placeholder: 'Ask anything',
                }),
              ),
            );

  const spent = totalsText(totals);
  const hintLeft = `  ${modelLabel}${spent ? ` · ${spent}` : ''} · ${shortCwd}`;
  const hintRightParts = [];
  if (hint !== null) {
    hintRightParts.push(hint);
  }
  if (reminders.length > 0) {
    hintRightParts.push(`⏰ ${reminders.length}`);
  }
  const badge = jobsBadge(jobs);
  if (badge !== '') {
    hintRightParts.push(badge);
  }
  hintRightParts.push('ctrl+t thought');
  hintRightParts.push('ctrl + c quit');
  const hintRow = el(
    Box,
    { paddingLeft: 1, paddingRight: 1, flexDirection: 'row' },
    // One line, the folder cut first: a footer that wrapped took a second
    // line and pushed the composer up from the foot of the terminal.
    el(
      Box,
      { flexShrink: 1, flexGrow: 1 },
      el(Text, { dimColor: true, wrap: 'truncate-end' }, hintLeft),
    ),
    el(Text, { dimColor: true, wrap: 'truncate-start' }, '  ' + hintRightParts.join('   ')),
  );

  const sidebar = showSidebar
    ? el(
        Box,
        {
          width: SIDEBAR_WIDTH,
          height: rows,
          flexShrink: 0,
          flexDirection: 'column',
          borderStyle: 'single',
          borderTop: false,
          borderRight: false,
          borderBottom: false,
          borderColor: 'gray',
          paddingLeft: 1,
          paddingRight: 1,
          overflow: 'hidden',
        },
        ...sidebarLines(
          {
            title: sessionTitle,
            model: modelLabel,
            context: speed.current.context,
            window: modelWindow,
            totals,
            rate: speed.current.rate,
            files: sessionFiles,
            instructions: [...instructionFiles.current.keys()],
            standing: standingLines(standing, SIDEBAR_WIDTH - 3).map(l => l.text.trim()),
          },
          SIDEBAR_WIDTH - 3,
        ).map((line, i) =>
          el(
            Text,
            {
              key: i,
              wrap: 'truncate',
              bold: line.style === 'title' || line.style === 'label',
              dimColor: line.style === 'dim',
              color:
                line.style === 'label'
                  ? ACCENT
                  : line.style === 'alert'
                    ? ERR
                    : line.style === 'warn'
                      ? 'yellow'
                      : line.style === 'ok'
                        ? OK
                        : undefined,
            },
            line.text === '' ? ' ' : line.text,
          ),
        ),
      )
    : null;

  const main = el(
    Box,
    // The terminal's height, not 100%: Ink sizes 100% to the content, so a
    // short conversation left the composer under it, mid-screen, instead of
    // at the foot of the terminal. A frame exactly the terminal's height is
    // not redrawn whole by Ink; one taller would be.
    { flexDirection: 'column', height: rows, width: cols, flexShrink: 0 },
    el(
      Box,
      {
        height: room,
        flexShrink: 0,
        flexDirection: 'column',
        overflow: 'hidden',
        // Laid out from the bottom at the latest, and while the top item
        // overflows, so the rendered height — not the estimate — decides
        // what is cut, and it is the head of what is too tall rather than
        // the end of the answer streaming in.
        justifyContent: atBottom || overflowTop ? 'flex-end' : 'flex-start',
      },
      transcript,
    ),
    el(Box, { flexShrink: 0, flexDirection: 'column' }, el(TodoPanel, { todos })),
    ...(scrollHint ? [el(Box, { flexShrink: 0 }, scrollHint)] : []),
    ...standingShown.map((line, i) =>
      el(
        Box,
        { key: `standing${i}`, paddingLeft: 1, paddingRight: 1, flexShrink: 0 },
        el(
          Text,
          line.style === 'plan'
            ? { color: 'yellow', bold: true }
            : line.style === 'blocked'
              ? { color: ERR }
              : { color: ACCENT },
          line.text,
        ),
      ),
    ),
    statusRule,
    el(Box, { flexShrink: 0, flexDirection: 'column' }, inputRow),
    el(Box, { flexShrink: 0, height: 1 }, hintRow),
  );
  return el(Box, { flexDirection: 'row', height: rows }, main, sidebar);
}

// ── Viewport math (pure, exported for tests) ───────────────────────────────

/** Line count of a markdown body as rendered by markdownLines(). */
function markdownLineCount(text, width) {
  return layoutMarkdown(String(text), Math.max(1, width - TRANSCRIPT_PAD - MARKDOWN_GUTTER)).length;
}

/**
 * Rendered-line estimate for one transcript item, matching ChatRow layout.
 * Overestimating slightly is fine (viewport clips the tail, never the head).
 */
export function estimateItemLines(item, width, thinkingOpen = true) {
  const avail = Math.max(1, width - 6);
  const text = item && typeof item.text === 'string' ? item.text : '';
  const output = item && typeof item.output === 'string' ? item.output : '';
  switch (item && item.kind) {
    case 'user': {
      let n = 0;
      for (const line of text.split('\n')) {
        n += wrapText(
          line,
          Math.max(1, width - TRANSCRIPT_PAD - USER_LINE_PAD - USER_PREFIX_W),
        ).length;
      }
      return Math.max(1, n);
    }
    case 'assistant': {
      let n = 1; // marginTop
      if (item.reasoning !== undefined && item.reasoning !== '') {
        n += 1 + thinkingView(item.reasoning, width, thinkingOpen).lines.length;
      }
      if (text !== '') {
        n += markdownLineCount(text, width);
      }
      if (item.usage) {
        n += 1;
      }
      return Math.max(1, n);
    }
    case 'tool': {
      let n = 2; // marginTop + status head
      const out = splitOutput(output);
      if (out !== null) {
        for (const line of out.lines) {
          n += wrapText(line, avail).length;
        }
        if (out.omitted > 0) {
          n += 1;
        }
      }
      if (item.status === 'error' && item.error) {
        n += 1;
      }
      return Math.max(1, n);
    }
    case 'divider':
      return 1;
    default:
      return Math.max(
        1,
        wrapText(String(item && item.text ? item.text : ''), Math.max(1, width - 2)).length,
      );
  }
}

/**
 * Compute the visible transcript slice for a scroll position.
 * `scrollLines` is the offset in rendered lines from the bottom (0 = bottom
 * anchored, i.e. the latest messages are visible).
 */
export function computeViewport({
  items,
  rows,
  width,
  scrollLines,
  busy,
  todos = [],
  thinkingOpen = true,
  composerExtra = 0,
  room,
  streamLines = 0,
}) {
  // thinkingOpen: one for all, or by item.
  const heights = items.map(item =>
    estimateItemLines(
      item,
      width,
      typeof thinkingOpen === 'function' ? thinkingOpen(item) : thinkingOpen,
    ),
  );
  const totalLines = heights.reduce((a, b) => a + b, 0);
  // Chrome rows: status row (busy) + scroll hint + composer + footer +
  // empty-state banner + todo panel, and whatever the composer grew by.
  const chromeLines =
    composerExtra +
    (busy ? 1 : 0) +
    (scrollLines > 0 ? 1 : 0) +
    2 +
    (items.length === 0 ? 1 : 0) +
    (todos.length > 0 ? 2 + todos.length : 0);
  // room: the transcript's height as the App laid it out, exactly; the
  // estimate above is for a caller that did not.
  const height = room ?? Math.max(6, rows - chromeLines);
  const maxScroll = Math.max(0, totalLines - 1);
  const lines = Math.min(Math.max(0, scrollLines), maxScroll);
  // At the bottom, the answer streaming in is drawn under the items and
  // takes its share of the room; scrolled up, it is not drawn.
  const available = lines === 0 ? Math.max(0, height - streamLines) : height;

  let visible = [];
  // overflowTop: the topmost visible item is taller than the room left for
  // it, and its end is what belongs in view — the transcript is then laid
  // out from the bottom so the head is the part cut off.
  let overflowTop = false;
  if (items.length > 0) {
    // Window bottom = the item that contains the `lines`-th line from bottom.
    let endIdx = items.length - 1;
    let consumed = 0;
    for (let i = items.length - 1; i >= 0; i--) {
      if (consumed + heights[i] > lines) {
        endIdx = i;
        break;
      }
      consumed += heights[i];
      if (i === 0) {
        endIdx = 0;
      }
    }
    // Fill upward from the window bottom until the viewport is full.
    let startIdx = endIdx;
    let total = 0;
    for (let i = endIdx; i >= 0; i--) {
      if (total + heights[i] > available) {
        // An item that cannot fit whole is still shown, its head cut off,
        // when there is room left for any of it. Skipping it left only the
        // short rows below it — a long answer followed by its status row
        // drew a blank screen. Scrolled into the item itself (the window
        // bottom above its last line), its head shows as before.
        const scrolledInto = i === endIdx && lines > consumed;
        if (total < available && !scrolledInto) {
          startIdx = i;
          overflowTop = true;
        }
        break;
      }
      total += heights[i];
      startIdx = i;
    }
    visible = items.slice(startIdx, endIdx + 1);
  }
  return {
    visible,
    scrollLines: lines,
    maxScroll,
    atBottom: lines === 0,
    atTop: lines >= maxScroll,
    overflowTop,
    step: Math.max(4, Math.floor(height / 2)),
  };
}

/**
 * Rendered-line estimate of the answer streaming in, matching StreamBlock.
 * @param {{reasoning: string, text: string, tool: object | null}} stream
 * @param {number} width
 * @param {boolean} thinkingOpen
 */
export function estimateStreamLines(stream, width, thinkingOpen = true) {
  let n = 0;
  if (stream.reasoning !== '') {
    n += 2 + thinkingView(stream.reasoning, width, thinkingOpen, true).lines.length;
  }
  if (stream.text !== '') {
    n += 1 + markdownLineCount(stream.text, width);
  }
  if (stream.tool !== null) {
    n += 1;
  }
  return n;
}

// Pure helpers, exported for tests (no Ink dependencies beyond React elements).
export {
  wrapText,
  truncate,
  splitOutput,
  stripAnsi,
  userMessageBg,
  codeChipBg,
  markdownLines,
  splitCodeBlocks,
};
