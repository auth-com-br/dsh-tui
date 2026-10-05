import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mediaTypeOf, pathArg, imageLabel, contentText } from '../src/attachments.js';

/**
 * Attachments. If these regress, an image is refused as the wrong type, a
 * path dropped into the terminal is not found, or a message's image does
 * not show in the transcript.
 */

test('the four types the harness takes are told by their signature', () => {
  assert.equal(
    mediaTypeOf(Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
    'image/png',
  );
  assert.equal(mediaTypeOf(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0])), 'image/jpeg');
  assert.equal(mediaTypeOf(new TextEncoder().encode('GIF89a')), 'image/gif');
  assert.equal(mediaTypeOf(new TextEncoder().encode('RIFF....WEBPVP8 ')), 'image/webp');
  assert.equal(mediaTypeOf(new TextEncoder().encode('%PDF-1.7')), undefined);
});

test('a path dropped into the terminal comes quoted or escaped', () => {
  assert.equal(pathArg(" '/home/a/My Shots/x.png' "), '/home/a/My Shots/x.png');
  assert.equal(pathArg('/home/a/My\\ Shots/x.png'), '/home/a/My Shots/x.png');
  assert.equal(pathArg('shot.png'), 'shot.png');
});

test('a message shows its text and a line of its images', () => {
  const ref = { name: 'shot.png', width: 800, height: 600 };
  assert.equal(imageLabel(ref), '📎 shot.png 800×600');
  assert.equal(
    contentText([
      { type: 'text', text: 'what is this?' },
      { type: 'image', attachment: ref },
    ]),
    'what is this?\n📎 shot.png 800×600',
  );
});
