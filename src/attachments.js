/**
 * Images attached to a message: the web app attaches by drop or paste
 * (dsh-client-ui-attachment); a terminal has neither, so /image <path>
 * puts one on the next message, which shows it pending over the composer.
 * The image is the harness's from there (dsh-attachment): admitted,
 * normalized and kept, the message carrying only its reference — the
 * `{type: 'image', attachment}` block the web app's prompts carry.
 */

/**
 * The image type of some bytes by their signature, or undefined for one
 * the harness does not take (it takes PNG, JPEG, WebP and GIF).
 * @param {Uint8Array} b
 */
export function mediaTypeOf(b) {
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) {
    return 'image/png';
  }
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) {
    return 'image/jpeg';
  }
  if (b.length >= 6 && String.fromCharCode(...b.slice(0, 4)) === 'GIF8') {
    return 'image/gif';
  }
  if (
    b.length >= 12 &&
    String.fromCharCode(...b.slice(0, 4)) === 'RIFF' &&
    String.fromCharCode(...b.slice(8, 12)) === 'WEBP'
  ) {
    return 'image/webp';
  }
  return undefined;
}

/**
 * The path a /image line names: what follows, with the quotes or the
 * backslash escapes a terminal puts on a path dropped or pasted into it.
 * @param {string} arg
 */
export function pathArg(arg) {
  const a = arg.trim();
  const quoted = /^(['"])(.*)\1$/s.exec(a);
  if (quoted) {
    return quoted[2];
  }
  return a.replace(/\\(.)/g, '$1');
}

/**
 * How an attached image reads: its name and size.
 * @param {{name?: string, width?: number, height?: number}} ref
 */
export function imageLabel(ref) {
  const size = ref.width && ref.height ? ` ${ref.width}×${ref.height}` : '';
  return `📎 ${ref.name ?? 'image'}${size}`;
}

/**
 * A message's text as the transcript shows it: its text, and a line of its
 * images.
 * @param {ReadonlyArray<{type: string, text?: string, attachment?: object}>} content
 */
export function contentText(content) {
  const text = content
    .filter(c => c.type === 'text' && typeof c.text === 'string')
    .map(c => c.text)
    .join('\n')
    .trim();
  const images = content
    .filter(c => c.type === 'image' && c.attachment)
    .map(c => imageLabel(c.attachment));
  return [text, images.join('  ')].filter(Boolean).join('\n');
}
