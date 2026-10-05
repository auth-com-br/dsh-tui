/**
 * Questions the agent asks the user (dsh-user-questions), answered in the
 * composer's place. Pure: the state, what a key does to it, and the lines it
 * shows — the App holds the state and resolves the harness's waiting request
 * with `answersOf` once the last question is answered.
 *
 * A question offers its options, and always one more: writing an answer of
 * one's own, which the harness takes as `custom`. A question with no options
 * is that line alone. Multi-select questions toggle with space.
 */

const MAX_DETAIL_LINES = 12;

/**
 * The state for a batch of questions.
 * @param {Array<{id: string, question: string, header?: string, detail?: string, options?: Array<{label: string, description?: string}>, multiSelect?: boolean, secret?: boolean, custom?: boolean}>} questions
 */
export function newQuestions(questions) {
  return {
    questions,
    index: 0,
    cursor: 0,
    picked: [],
    typing: (questions[0]?.options ?? []).length === 0,
    text: '',
    answers: [],
  };
}

/**
 * The current question's rows: its options, then "write my own answer" —
 * unless the question is a menu (custom: false), where only an option is
 * an answer.
 */
function rowsOf(q) {
  const options = (q.options ?? []).map(o => o.label);
  return q.custom === false && options.length > 0 ? options : [...options, null];
}

/**
 * Apply one key. Returns the next state; `done` is set once every question
 * has an answer (or was skipped with esc).
 * @param {ReturnType<typeof newQuestions>} s
 * @param {string} input
 * @param {{upArrow?: boolean, downArrow?: boolean, return?: boolean, escape?: boolean, backspace?: boolean, delete?: boolean}} key
 */
export function questionKey(s, input, key) {
  const q = s.questions[s.index];
  if (q === undefined) {
    return s;
  }
  const rows = rowsOf(q);
  const answered = item => advance({ ...s, answers: [...s.answers, item] });

  if (s.typing) {
    if (key.escape) {
      // Back to the options when there are any; skipped when there are none.
      return (q.options ?? []).length > 0
        ? { ...s, typing: false, text: '' }
        : answered({ id: q.id, selected: [] });
    }
    if (key.return) {
      const text = s.text.trim();
      if (text === '') {
        return s;
      }
      return answered({ id: q.id, selected: q.multiSelect ? s.picked : [], custom: text });
    }
    if (key.backspace || key.delete) {
      return { ...s, text: s.text.slice(0, -1) };
    }
    if (input && !key.upArrow && !key.downArrow) {
      return { ...s, text: s.text + input };
    }
    return s;
  }

  if (key.escape) {
    return answered({ id: q.id, selected: [] });
  }
  if (key.upArrow) {
    return { ...s, cursor: (s.cursor - 1 + rows.length) % rows.length };
  }
  if (key.downArrow) {
    return { ...s, cursor: (s.cursor + 1) % rows.length };
  }
  const n = Number.parseInt(input, 10);
  if (input.length === 1 && n >= 1 && n <= rows.length) {
    s = { ...s, cursor: n - 1 };
    if (!q.multiSelect || rows[n - 1] === null) {
      return choose(s, q, rows, answered);
    }
    return toggle(s, rows);
  }
  if (input === ' ' && q.multiSelect) {
    return rows[s.cursor] === null ? { ...s, typing: true } : toggle(s, rows);
  }
  if (key.return) {
    return choose(s, q, rows, answered);
  }
  return s;
}

function toggle(s, rows) {
  const label = rows[s.cursor];
  const picked = s.picked.includes(label)
    ? s.picked.filter(l => l !== label)
    : [...s.picked, label];
  return { ...s, picked };
}

function choose(s, q, rows, answered) {
  const label = rows[s.cursor];
  if (label === null) {
    return { ...s, typing: true };
  }
  if (q.multiSelect) {
    const picked = s.picked.length > 0 ? s.picked : [label];
    return answered({ id: q.id, selected: picked });
  }
  return answered({ id: q.id, selected: [label] });
}

function advance(s) {
  const index = s.index + 1;
  if (index >= s.questions.length) {
    return { ...s, index, done: true };
  }
  const next = s.questions[index];
  return {
    ...s,
    index,
    cursor: 0,
    picked: [],
    typing: (next.options ?? []).length === 0,
    text: '',
  };
}

/** The answer the harness is waiting for. */
export function answersOf(s) {
  return { answers: s.answers };
}

/**
 * The lines shown for the current question, each with a style hint:
 * 'title', 'detail', 'row', 'selected', 'input' or 'keys'.
 * @param {ReturnType<typeof newQuestions>} s
 * @param {number} width
 * @returns {Array<{text: string, style: string}>}
 */
export function questionLines(s, width) {
  const q = s.questions[s.index];
  if (q === undefined) {
    return [];
  }
  const w = Math.max(20, width - 4);
  const cut = t => (t.length > w ? t.slice(0, w - 1) + '…' : t);
  const count = s.questions.length > 1 ? ` (${s.index + 1}/${s.questions.length})` : '';
  const out = [
    { text: cut(`? question${count}${q.header ? ' · ' + q.header : ''}`), style: 'title' },
  ];
  out.push({ text: cut(`  ${q.question}`), style: 'row' });
  if (q.detail) {
    const lines = q.detail.split('\n');
    for (const line of lines.slice(0, MAX_DETAIL_LINES)) {
      out.push({ text: cut(`    ${line}`), style: 'detail' });
    }
    if (lines.length > MAX_DETAIL_LINES) {
      out.push({ text: `    … ${lines.length - MAX_DETAIL_LINES} more lines`, style: 'detail' });
    }
  }
  const rows = rowsOf(q);
  if (!s.typing || rows.length > 1) {
    rows.forEach((label, i) => {
      const here = i === s.cursor && !s.typing;
      const mark =
        q.multiSelect && label !== null ? (s.picked.includes(label) ? '[x] ' : '[ ] ') : '';
      const name = label === null ? '✎ write my own answer' : label;
      const desc = label === null ? '' : (q.options[i].description ?? '');
      out.push({
        text: cut(`  ${here ? '›' : ' '} ${i + 1}. ${mark}${name}${desc ? ' — ' + desc : ''}`),
        style: here ? 'selected' : 'row',
      });
    });
  }
  if (s.typing) {
    // A secret (an API key) is typed unseen: the screen is the one place
    // it would otherwise be left, in the scrollback too.
    const shown = q.secret ? '•'.repeat(s.text.length) : s.text;
    out.push({ text: cut(`  ✎ ${shown}█`), style: 'input' });
    out.push({ text: '  enter send · esc back', style: 'keys' });
  } else {
    const multi = q.multiSelect ? ' · space mark' : '';
    out.push({
      text: `  ↑↓ or 1-${rows.length} choose${multi} · enter confirm · esc skip`,
      style: 'keys',
    });
  }
  return out;
}
