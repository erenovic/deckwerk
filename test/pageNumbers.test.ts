// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { emptyDeck, parseDeck, type Deck, type PageNumbers } from '../src/shared/deck.js';
import { diffDecks } from '../src/shared/deckDiff.js';
import { applyAgentOperations } from '../src/shared/agent.js';
import { DEFAULT_PAGE_NUMBERS, pageNumberLabel } from '../src/shared/pageNumbers.js';
import { renderPageNumber } from '../src/renderer/player/render.js';
import { buildPrintPages } from '../src/renderer/print/pages.js';

/**
 * Page numbers count the slides the audience sees. A hidden slide is not
 * counted; a title slide (and, if asked, the first slide) is counted but shows
 * no number, so the slide after a title page still reads 2.
 */

function deckOf(
  slides: Array<{ layout?: 'title' | 'standard'; skipped?: boolean }>,
  settings: Partial<PageNumbers> | null = {},
): Deck {
  const deck = parseDeck({
    ...emptyDeck('Numbers'),
    slides: slides.map((slide, index) => ({ id: `s${index + 1}`, ...slide })),
  });
  deck.pageNumbers = settings === null ? null : { ...DEFAULT_PAGE_NUMBERS, ...settings };
  return deck;
}

const labels = (deck: Deck) => deck.slides.map((_, index) => pageNumberLabel(deck, index));

describe('page number labels', () => {
  it('shows nothing when the deck has no numbering', () => {
    expect(labels(deckOf([{}, {}], null))).toEqual([null, null]);
    expect(emptyDeck().pageNumbers).toBeNull();
  });

  it('counts a title slide but hides its number', () => {
    expect(labels(deckOf([{ layout: 'title' }, {}, {}]))).toEqual([null, '2', '3']);
    expect(labels(deckOf([{ layout: 'title' }, {}], { hideOnTitle: false }))).toEqual(['1', '2']);
  });

  it('skips hidden slides without leaving a gap', () => {
    expect(labels(deckOf([{}, { skipped: true }, {}]))).toEqual(['1', null, '2']);
  });

  it('can hide the first slide, start elsewhere, and show the total', () => {
    expect(labels(deckOf([{}, {}, {}], { hideOnFirst: true }))).toEqual([null, '2', '3']);
    expect(labels(deckOf([{}, {}, {}], { startAt: 0 }))).toEqual(['0', '1', '2']);
    expect(labels(deckOf([{}, { skipped: true }, {}, {}], { format: 'number-of-total' })))
      .toEqual(['1 / 3', null, '2 / 3', '3 / 3']);
  });
});

describe('the page number on a slide', () => {
  it('sits in the chosen corner, at the margin, in the chosen size and colour', () => {
    const deck = deckOf([{}, {}], { position: 'top-left', margin: 30, fontSize: 36, color: '#ff0000' });
    const node = renderPageNumber(deck, 1)!;
    expect(node.textContent).toBe('2');
    expect(node.classList.contains('role-caption')).toBe(true);
    expect(node.style.top).toBe('30px');
    expect(node.style.left).toBe('30px');
    expect(node.style.bottom).toBe('');
    expect(node.style.fontSize).toBe('36px');
    expect(node.style.color).toBe('rgb(255, 0, 0)');
    expect(node.style.pointerEvents).toBe('none');
  });

  it('spans the slide and centres its text for a centre position, and follows the theme colour', () => {
    const node = renderPageNumber(deckOf([{}], { position: 'bottom-center' }), 0)!;
    expect(node.style.bottom).toBe('40px');
    expect([node.style.left, node.style.right, node.style.textAlign]).toEqual(['0px', '0px', 'center']);
    expect(node.style.color).toBe('');
  });

  it('is absent where the slide shows no number', () => {
    expect(renderPageNumber(deckOf([{ layout: 'title' }]), 0)).toBeNull();
    expect(renderPageNumber(deckOf([{}], null), 0)).toBeNull();
  });

  it('is printed on every PDF page that shows one', () => {
    const deck = deckOf([{ layout: 'title' }, {}, { skipped: true }, {}]);
    const container = document.createElement('div');
    buildPrintPages(container, { deck, mode: 'final', resolveSrc: (src) => src });
    expect([...container.querySelectorAll('.pdf-page')]
      .map((page) => page.querySelector('.page-number')?.textContent ?? null)).toEqual([null, '2', '3']);
  });
});

describe('page numbers in the deck history', () => {
  it('diff, undo and collaboration carry the settings', () => {
    const before = deckOf([{}], null);
    const after = structuredClone(before);
    after.pageNumbers = { ...DEFAULT_PAGE_NUMBERS, position: 'top-right' };
    const forward = diffDecks(before, after);
    expect(forward).toEqual([{ op: 'updateDeck', pageNumbers: after.pageNumbers }]);
    expect(applyAgentOperations(before, forward).pageNumbers).toEqual(after.pageNumbers);
    expect(applyAgentOperations(after, diffDecks(after, before)).pageNumbers).toBeNull();
  });
});
