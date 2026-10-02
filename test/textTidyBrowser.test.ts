import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { electronBinary, wait } from './support/browserSession.js';
import { PARA, startCrossSession, type CrossSession } from './support/crossContextSession.js';

/**
 * What an edit saves, in the running editor: a formula the browser's editing
 * cut across runs is stored as one run, and spacing nobody chose (a run whose
 * letter-spacing equals what its box already has) is dropped, while spacing
 * that differs is kept. Computed styles decide "already has", so this needs a
 * real layout engine.
 */

let session: CrossSession;
let close: (() => Promise<void>) | null = null;

beforeAll(async () => {
  if (!electronBinary) return;
  const started = await startCrossSession('text-tidy', 'Tidy');
  session = started.session;
  close = started.close;
}, 240_000);

afterAll(async () => {
  await close?.();
  close = null;
});

const SPLIT = '<p>$\\mathcal{L}<span style="letter-spacing: 0px;">+x</span><span style="letter-spacing: 0px;">$</span>'
  + ' and <span style="letter-spacing: 0px;">plain</span> and <span style="letter-spacing: 4px;">wide</span></p>';

describe.skipIf(!electronBinary)('saving an edit', () => {
  it('stores formulas whole and drops spacing that only repeats the box’s own', async () => {
    await session.reset();
    await session.cdp.evaluate(`(() => { window.store.commit((deck) => {
      deck.slides[0].elements.find((e) => e.id === ${JSON.stringify(PARA)}).html = ${JSON.stringify(SPLIT)};
    }, { label: 'split' }); return true; })()`);
    await wait(200);
    await session.doubleClick(PARA);
    await session.cdp.evaluate(`(() => {
      const p = document.querySelector('.slide-layer [data-element-id="${PARA}"] .text-content p');
      const range = document.createRange(); range.selectNodeContents(p); range.collapse(false);
      getSelection().removeAllRanges(); getSelection().addRange(range); return true;
    })()`);
    await session.type('!');
    await session.key('Escape', 27);
    await wait(300);
    const saved = await session.cdp.evaluate<string>(
      `window.store.slide.elements.find((e) => e.id === ${JSON.stringify(PARA)}).html`);
    expect(saved).toContain('$\\mathcal{L}+x$');
    expect(saved).not.toContain('letter-spacing: 0px');
    expect(saved).toContain('<span style="letter-spacing: 4px;">wide');
    expect(saved).toContain('and plain and');
    // And it renders: one formula, no warning.
    expect(await session.cdp.evaluate<number>(
      `document.querySelectorAll('.slide-layer [data-element-id="${PARA}"] .katex').length`)).toBe(1);
  }, 120_000);
});
