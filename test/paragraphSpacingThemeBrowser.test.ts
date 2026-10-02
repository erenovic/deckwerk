import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { electronBinary, wait } from './support/browserSession.js';
import { LIST, PARA, startCrossSession, type CrossSession } from './support/crossContextSession.js';

/**
 * Paragraph spacing set once in the Design tab reaches every text box that has
 * none of its own, measured in the running editor: the gap between paragraphs
 * and between list items is the theme's number, and a box's own Props value
 * still wins on that box.
 */

let session: CrossSession;
let close: (() => Promise<void>) | null = null;

beforeAll(async () => {
  if (!electronBinary) return;
  const started = await startCrossSession('paragraph-spacing-theme', 'Spacing');
  session = started.session;
  close = started.close;
}, 240_000);

afterAll(async () => {
  await close?.();
  close = null;
});

/** Gaps between consecutive blocks (or list items) of a box, in canvas pixels. */
function gaps(elementId: string, selector: string): Promise<number[]> {
  return session.cdp.evaluate<number[]>(`(() => {
    const stage = document.querySelector('#canvas .stage');
    const scale = stage.getBoundingClientRect().width / window.store.get().deck.canvas.w;
    const body = document.querySelector('.slide-layer [data-element-id="${elementId}"] .text-content');
    const rows = [...body.querySelectorAll(${JSON.stringify(selector)})].map((node) => node.getBoundingClientRect());
    return rows.slice(1).map((row, i) => Math.round((row.top - rows[i].bottom) / scale));
  })()`);
}

async function setField(selector: string, value: number): Promise<void> {
  await session.cdp.evaluate(`(() => {
    const input = document.querySelector(${JSON.stringify(selector)});
    input.value = '${value}';
    input.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  })()`);
}

describe.skipIf(!electronBinary)('paragraph spacing from the Design tab', () => {
  it("spaces paragraphs and list items deck-wide, under each box's own value", async () => {
    await session.reset();
    expect(await gaps(PARA, ':scope > p')).toEqual([0]);

    await session.cdp.click('#side-tabs button[data-panel="themePanel"]', 'Design tab');
    await wait(150);
    await session.cdp.click('.theme-edit-button', 'Edit theme');
    await wait(150);
    await setField('.theme-paragraph-spacing input', 30);
    await session.cdp.clickByText('.theme-editor-actions button', 'Done');
    await session.cdp.click('#side-tabs button[data-panel="inspector"]', 'Props tab');
    await wait(400);

    expect(await gaps(PARA, ':scope > p')).toEqual([30]);
    expect(await gaps(LIST, 'li')).toEqual([30, 30]);

    // A box's own spacing still decides that box.
    await session.click(PARA);
    await wait(150);
    await session.cdp.evaluate(`(() => {
      const label = [...document.querySelectorAll('#inspector label')].find((l) => /^Paragraph spacing/i.test(l.textContent.trim()));
      const input = label.querySelector('input');
      input.value = '8';
      input.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    })()`);
    await wait(300);
    expect(await gaps(PARA, ':scope > p')).toEqual([8]);
    expect(await gaps(LIST, 'li')).toEqual([30, 30]);
  }, 180_000);
});
