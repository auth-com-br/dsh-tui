/**
 * /rate: feedback on an answer, as the web app's Like/Dislike with a note
 * (dsh-client-ui-message-feedback) — on the message that closed the last
 * turn, the one the web app puts its pair under. The rating is the
 * harness's (dsh-message-feedback), kept with the session and never seen by
 * the model.
 */

/**
 * The /rate line.
 * @param {string} args what follows /rate
 * @returns {{op: 'show'} | {op: 'clear'} | {op: 'put', rating: 'positive' | 'negative', note?: string} | {error: string}}
 */
export function parseRate(args) {
  const text = args.trim();
  if (text === '') {
    return { op: 'show' };
  }
  const [word, ...rest] = text.split(/\s+/);
  const note = text.slice(word.length).trim();
  const w = word.toLowerCase();
  if (w === 'clear') {
    return rest.length === 0 ? { op: 'clear' } : { error: 'usage: /rate clear' };
  }
  const rating = ['good', '+', 'up', 'yes', 'bom', 'boa'].includes(w)
    ? 'positive'
    : ['bad', '-', 'down', 'no', 'ruim'].includes(w)
      ? 'negative'
      : undefined;
  if (rating === undefined) {
    return { error: 'usage: /rate good|bad [note] · /rate clear' };
  }
  return { op: 'put', rating, ...(note ? { note } : {}) };
}

/**
 * How a rating reads.
 * @param {{rating: string, note?: string} | undefined} item
 */
export function ratingText(item) {
  if (item === undefined) {
    return 'the last answer is not rated — /rate good|bad [note]';
  }
  return `${item.rating === 'positive' ? '👍' : '👎'} the last answer${item.note ? `: ${item.note}` : ''}`;
}
