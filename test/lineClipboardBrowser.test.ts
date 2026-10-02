import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { electronBinary, wait } from './support/browserSession.js';
import { LIST, MOD, PARA, startCrossSession, type CrossSession } from './support/crossContextSession.js';

/**
 * Whole-line cut, copy and paste with real Cmd/Ctrl+X, +C and +V through the
 * operating system's clipboard: with only a caret, the caret's paragraph or
 * list item is copied or cut whole, and pasting it puts it back as a line of
 * its own above the caret's line.
 */

let session: CrossSession;
let close: (() => Promise<void>) | null = null;

beforeAll(async () => {
  if (!electronBinary) return;
  const started = await startCrossSession('line-clipboard', 'Lines');
  session = started.session;
  close = started.close;
}, 240_000);

afterAll(async () => {
  await close?.();
  close = null;
});

/** Put a collapsed caret inside the text `text` of a box being edited. */
function caretIn(elementId: string, text: string): Promise<boolean> {
  return session.cdp.evaluate<boolean>(`(() => {
    const body = document.querySelector('.slide-layer [data-element-id="${elementId}"] .text-content');
    const walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const at = node.data.indexOf(${JSON.stringify(text)});
      if (at === -1) continue;
      const range = document.createRange();
      range.setStart(node, at + 2);
      range.collapse(true);
      getSelection().removeAllRanges();
      getSelection().addRange(range);
      return true;
    }
    return false;
  })()`);
}

const live = (elementId: string) => session.cdp.evaluate<string>(
  `document.querySelector('.slide-layer [data-element-id="${elementId}"] .text-content').innerHTML`);
const saved = (elementId: string) => session.cdp.evaluate<string>(
  `window.store.slide.elements.find((e) => e.id === '${elementId}').html`);

describe.skipIf(!electronBinary)('whole-line cut, copy and paste', () => {
  it('copies the caret’s paragraph and pastes it as a line above, keeping the caret', async () => {
    await session.reset();
    await session.doubleClick(PARA);
    expect(await caretIn(PARA, 'plain two')).toBe(true);
    await session.chord('c', 'KeyC', 67, MOD, ['copy']);
    expect(await caretIn(PARA, 'plain one')).toBe(true);
    await session.chord('v', 'KeyV', 86, MOD, ['paste']);
    await wait(200);
    expect(await live(PARA)).toBe('<p>plain two</p><p>plain one</p><p>plain two</p>');
    // The caret stayed in the line it was in.
    expect(await session.cdp.evaluate<string>('getSelection().anchorNode.textContent')).toBe('plain one');
    await session.key('Escape', 27);
    await wait(200);
    expect(await saved(PARA)).toBe('<p>plain two</p><p>plain one</p><p>plain two</p>');
  }, 120_000);

  it('cuts a list item whole and pastes it into paragraphs with its list, each one undo step', async () => {
    await session.reset();
    await session.doubleClick(LIST);
    expect(await caretIn(LIST, 'item two')).toBe(true);
    await session.chord('x', 'KeyX', 88, MOD, ['cut']);
    await wait(200);
    expect(await live(LIST)).toBe('<ul><li>item one</li><li>item three</li></ul>');
    await session.key('Escape', 27);
    await wait(200);

    await session.doubleClick(PARA);
    expect(await caretIn(PARA, 'plain two')).toBe(true);
    await session.chord('v', 'KeyV', 86, MOD, ['paste']);
    await wait(200);
    expect(await live(PARA)).toBe('<p>plain one</p><ul><li>item two</li></ul><p>plain two</p>');
    await session.key('Escape', 27);
    await wait(200);

    await session.chord('z', 'KeyZ', 90, MOD);
    await wait(250);
    expect(await saved(PARA)).toBe('<p>plain one</p><p>plain two</p>');
  }, 120_000);

  it('leaves copying a selection to the browser, as before', async () => {
    await session.reset();
    await session.doubleClick(PARA);
    await session.cdp.evaluate(`(() => {
      const text = document.querySelector('.slide-layer [data-element-id="${PARA}"] .text-content p').firstChild;
      const range = document.createRange(); range.setStart(text, 0); range.setEnd(text, 5);
      getSelection().removeAllRanges(); getSelection().addRange(range); return true;
    })()`);
    await session.chord('c', 'KeyC', 67, MOD, ['copy']);
    expect(await caretIn(PARA, 'plain two')).toBe(true);
    await session.chord('v', 'KeyV', 86, MOD, ['paste']);
    await wait(200);
    // An ordinary copy pastes inline, at the caret: no new line.
    expect(await live(PARA)).toBe('<p>plain one</p><p>plplainain two</p>');
  }, 120_000);
});
