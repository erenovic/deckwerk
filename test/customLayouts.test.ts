// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { emptyDeck, parseDeck, type CustomLayout, type Deck, type TextEl } from '../src/shared/deck.js';
import {
  defaultLayoutMasters,
  isTitleLayout,
  layoutChoices,
  layoutGeometryFor,
  layoutName,
  promptCopy,
  resolveLayoutMaster,
  slotKind,
  syncDeckWithLayoutMasters,
} from '../src/shared/layoutMasters.js';
import { diffDecks } from '../src/shared/deckDiff.js';
import { applyAgentOperations } from '../src/shared/agent.js';
import { DEFAULT_PAGE_NUMBERS, pageNumberLabel } from '../src/shared/pageNumbers.js';
import { applySlideLayout } from '../src/renderer/editor/slideLayouts.js';

/**
 * Layouts the author makes, beside the three built-in ones: named, with any
 * mix of title, subtitle, body (several, for columns) and caption slots.
 */

function slotBox(id: string, slot: string, x: number): TextEl {
  return {
    id, type: 'text', x, y: 300, w: 700, h: 500, rot: 0, z: 10, opacity: 1,
    class: [`role-${slotKind(slot) === 'subtitle' ? 'heading' : slotKind(slot)}`, 'placeholder'],
    style: {}, html: promptCopy(slot), align: 'left', valign: 'top', autoFit: true, layoutPlaceholder: slot,
  };
}

function twoColumns(): CustomLayout {
  return {
    id: 'layout-two-columns',
    name: 'Two columns',
    basedOn: 'standard',
    titleSlide: false,
    background: { color: '#fafafa', image: null },
    elements: [
      { ...slotBox('two-title', 'title', 120), y: 60, w: 1680, h: 140 },
      slotBox('two-left', 'body', 120),
      slotBox('two-right', 'body-2', 1000),
      { ...slotBox('two-caption', 'caption', 120), y: 950, h: 60 },
    ],
  };
}

function deckWith(...layouts: CustomLayout[]): Deck {
  const deck = emptyDeck('Custom');
  deck.layoutMasters = defaultLayoutMasters();
  deck.customLayouts = layouts;
  return deck;
}

const texts = (deck: Deck) => deck.slides[0].elements
  .filter((element): element is TextEl => element.type === 'text')
  .map((element) => [element.layoutPlaceholder, element.html, element.class.filter((name) => name.startsWith('role-')).join(' ')]);

describe('slots', () => {
  it('names the kinds, roles and prompts of numbered slots', () => {
    expect(['title', 'subtitle', 'body', 'body-2', 'caption-3'].map(slotKind))
      .toEqual(['title', 'subtitle', 'body', 'body', 'caption']);
    expect(['title', 'subtitle', 'body', 'body-2', 'caption'].map(promptCopy))
      .toEqual(['Slide title', 'Subtitle', 'Body text', 'Body text 2', 'Caption']);
  });

  it('accepts only known slot names in a deck', () => {
    const deck = emptyDeck('Slots');
    deck.slides[0].elements.push(slotBox('ok', 'body-2', 0));
    expect(() => parseDeck(deck)).not.toThrow();
    deck.slides[0].elements.push(slotBox('bad', 'sidebar', 0));
    expect(() => parseDeck(deck)).toThrow();
  });
});

describe('a layout of the deck\'s own', () => {
  it('puts a slide on it: every slot, prompt and role, and the layout background', () => {
    const deck = deckWith(twoColumns());
    applySlideLayout(deck.slides[0], 'layout-two-columns', deck.layoutMasters, deck.customLayouts);
    expect(deck.slides[0].layout).toBe('layout-two-columns');
    expect(texts(deck)).toEqual([
      ['title', 'Slide title', 'role-title'],
      ['body', 'Body text', 'role-body'],
      ['body-2', 'Body text 2', 'role-body'],
      ['caption', 'Caption', 'role-caption'],
    ]);
    expect(deck.slides[0].background.color).toBe('#fafafa');
  });

  it('carries written content between its layout and a built-in, dropping only unwritten prompts', () => {
    const deck = deckWith(twoColumns());
    applySlideLayout(deck.slides[0], 'layout-two-columns', deck.layoutMasters, deck.customLayouts);
    const right = deck.slides[0].elements.find((element) => element.type === 'text' && element.layoutPlaceholder === 'body-2') as TextEl;
    right.html = 'Right column';
    right.class = right.class.filter((name) => name !== 'placeholder');

    applySlideLayout(deck.slides[0], 'standard', deck.layoutMasters, deck.customLayouts);
    expect(texts(deck).map(([slot, html]) => [slot, html])).toEqual([
      ['title', 'Slide title'], ['body', 'Body text'], ['body-2', 'Right column'],
    ]);
  });

  it('is listed, named and found; an unknown id falls back to freeform', () => {
    const deck = deckWith(twoColumns());
    expect(layoutChoices(deck).map((choice) => choice.name)).toEqual(['Freeform', 'Title + Body', 'Title', 'Two columns']);
    expect(layoutName(deck, 'layout-two-columns')).toBe('Two columns');
    expect(resolveLayoutMaster(deck, 'layout-gone')).toEqual(deck.layoutMasters!.freeform);
  });

  it('snaps a body box back to its own slot, and a slot it lacks to the built-in it is based on', () => {
    const deck = deckWith(twoColumns());
    applySlideLayout(deck.slides[0], 'layout-two-columns', deck.layoutMasters, deck.customLayouts);
    const right = deck.slides[0].elements.find((element) => element.type === 'text' && element.layoutPlaceholder === 'body-2')!;
    expect(layoutGeometryFor(deck.slides[0], right, deck.layoutMasters, deck.customLayouts)?.x).toBe(1000);
  });

  it('follows edits to it on every slide that uses it', () => {
    const deck = deckWith(twoColumns());
    applySlideLayout(deck.slides[0], 'layout-two-columns', deck.layoutMasters, deck.customLayouts);
    deck.customLayouts[0].elements[2].x = 1100;
    syncDeckWithLayoutMasters(deck);
    const right = deck.slides[0].elements.find((element) => element.type === 'text' && element.layoutPlaceholder === 'body-2')!;
    expect(right.x).toBe(1100);
  });

  it('can count as a title slide, hiding its page number', () => {
    const titled = { ...twoColumns(), id: 'layout-cover', name: 'Cover', titleSlide: true };
    const deck = deckWith(twoColumns(), titled);
    deck.slides.push({ ...structuredClone(deck.slides[0]), id: 'second' });
    deck.slides[0].layout = 'layout-cover';
    deck.slides[1].layout = 'layout-two-columns';
    deck.pageNumbers = DEFAULT_PAGE_NUMBERS;
    expect(isTitleLayout(deck, 'layout-cover')).toBe(true);
    expect([pageNumberLabel(deck, 0), pageNumberLabel(deck, 1)]).toEqual([null, '2']);
  });

  it('travels through diff, undo and collaboration', () => {
    const before = deckWith();
    const after = structuredClone(before);
    after.customLayouts = [twoColumns()];
    const forward = diffDecks(before, after);
    expect(forward).toEqual([{ op: 'updateDeck', customLayouts: after.customLayouts }]);
    expect(applyAgentOperations(before, forward).customLayouts).toEqual(after.customLayouts);
    expect(applyAgentOperations(after, diffDecks(after, before)).customLayouts).toEqual([]);
  });

  it('defaults to none on decks saved before layouts of their own existed', () => {
    expect(emptyDeck().customLayouts).toEqual([]);
  });
});
