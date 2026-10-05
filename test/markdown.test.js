import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  layoutMarkdown,
  lineText,
  wrapSegments,
  inlineSegments,
  splitRow,
} from '../src/markdown.js';
import { strWidth } from '../src/utils.js';

/**
 * Markdown in the transcript. If these regress, a table is shown as raw
 * pipes, its borders do not line up (an emoji counted one column wide), a
 * heading keeps its #s, or a wide table runs off the screen.
 */

const text = lines => lines.map(lineText);

const disk = [
  '| Item | Valor |',
  '|---|---|',
  '| SMART | ✅ PASSED (Aprovado) |',
  '| Uso atual | ⚠️92% cheio (95 GB usados / 109 GB) |',
].join('\n');

describe('tables', () => {
  test('a table is drawn with box characters and every row is as wide as the rule', () => {
    const lines = text(layoutMarkdown(disk, 80));
    assert.match(lines[0], /^┌─+┬─+┐$/);
    assert.match(lines[1], /^│ Item +│ Valor +│$/);
    assert.match(lines[2], /^├─+┼─+┤$/);
    assert.match(lines[3], /^│ SMART +│ ✅ PASSED \(Aprovado\) +│$/);
    assert.match(
      lines[4],
      /^│ Uso atual │ ⚠️92% cheio \(95 GB usados \/ 109 GB\) │$/,
      'the widest cell sets the column',
    );
    assert.match(lines.at(-1), /^└─+┴─+┘$/);
    for (const l of lines) {
      assert.equal(strWidth(l), strWidth(lines[0]), `misaligned: ${l}`);
    }
  });

  test('the header is bold and the separator line sets the alignment', () => {
    const lines = layoutMarkdown('| a | n |\n|:-|--:|\n| x | 7 |', 40);
    assert.ok(lines[1].some(s => s.text === 'a' && s.bold));
    assert.equal(lineText(lines[3]), '│ x │ 7 │');
    const centered = text(layoutMarkdown('| col |\n|:---:|\n| x |', 40));
    assert.equal(centered[3], '│  x  │');
  });

  test('a table wider than the screen wraps its cells inside their columns', () => {
    const wide = `| Item | Nota |\n|---|---|\n| SSD | ${'muito espaço usado '.repeat(4).trim()} |`;
    const lines = text(layoutMarkdown(wide, 40));
    assert.ok(lines.length > 5, 'the long cell takes several lines');
    for (const l of lines) {
      assert.ok(strWidth(l) <= 40, `too wide: ${l}`);
      assert.equal(strWidth(l), strWidth(lines[0]));
    }
  });

  test('a table that cannot fit at all becomes header: value lines', () => {
    const lines = text(
      layoutMarkdown('| a | b | c | d | e |\n|-|-|-|-|-|\n| 1 | 2 | 3 | 4 | 5 |', 16),
    );
    assert.deepEqual(lines.slice(0, 2), ['a: 1', 'b: 2']);
  });

  test('a pipe inside `code` or escaped is part of the cell', () => {
    assert.deepEqual(splitRow('| `a|b` | c\\|d |'), ['`a|b`', 'c|d']);
  });
});

describe('blocks', () => {
  test('a heading loses its #s and is bold, its inline code rendered', () => {
    const [line] = layoutMarkdown('#### 2. HDD — `/dev/sdb` (9.1 TB)', 80);
    assert.equal(lineText(line), '2. HDD — /dev/sdb (9.1 TB)');
    assert.ok(line.every(s => s.bold && s.heading));
    assert.ok(line.some(s => s.code && s.text === '/dev/sdb'));
  });

  test('a rule spans the width, a quote has a bar, code keeps its fences', () => {
    assert.deepEqual(text(layoutMarkdown('---', 10)), ['──────────']);
    assert.deepEqual(text(layoutMarkdown('> O sistema está bem', 40)), ['▎ O sistema está bem']);
    assert.deepEqual(text(layoutMarkdown('```js\nconst a = 1;\n```', 40)), [
      '```js',
      'const a = 1;',
      '```',
    ]);
  });

  test("a list item's wrapped lines hang under its text", () => {
    const lines = text(layoutMarkdown('1. SSD quase cheio — liberar 15 GB agora', 18));
    assert.equal(lines[0], '1. SSD quase cheio');
    assert.ok(lines.slice(1).every(l => l.startsWith('   ')));
  });
});

describe('inline and wrapping', () => {
  test('markers are removed and styles kept', () => {
    assert.deepEqual(inlineSegments('a **b** `c` *d*'), [
      { text: 'a ' },
      { text: 'b', bold: true },
      { text: ' ' },
      { text: 'c', code: true },
      { text: ' ' },
      { text: 'd', italic: true },
    ]);
  });

  test('wrapping breaks at spaces and splits a word longer than the line', () => {
    assert.deepEqual(wrapSegments([{ text: 'aa bb cc' }], 5).map(lineText), ['aa bb', 'cc']);
    assert.deepEqual(wrapSegments([{ text: 'abcdefgh' }], 3).map(lineText), ['abc', 'def', 'gh']);
  });
});
