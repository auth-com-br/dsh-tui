import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseRate, ratingText } from '../src/feedback.js';

/**
 * /rate. If these regress, a rating is stored as the opposite one, or its
 * note loses words.
 */

test('good and bad, in English or Portuguese, with a note kept whole', () => {
  assert.deepEqual(parseRate('good'), { op: 'put', rating: 'positive' });
  assert.deepEqual(parseRate('ruim  inventou a API'), {
    op: 'put',
    rating: 'negative',
    note: 'inventou a API',
  });
  assert.deepEqual(parseRate(''), { op: 'show' });
  assert.deepEqual(parseRate('clear'), { op: 'clear' });
  assert.match(parseRate('meh').error, /usage/);
});

test('a rating reads with its mark and note', () => {
  assert.equal(
    ratingText({ rating: 'negative', note: 'wrong file' }),
    '👎 the last answer: wrong file',
  );
  assert.match(ratingText(undefined), /not rated/);
});
