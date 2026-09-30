// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { emptyDeck } from '../src/shared/deck.js';
import { RECENT_COLORS_LIMIT, withRecentColor } from '../src/shared/recentColors.js';
import { colorField, connectRecentColors, setRecentColorSource } from '../src/renderer/editor/colorPicker.js';
import { EditorStore } from '../src/renderer/editor/store.js';
import { closePopover } from '../src/renderer/editor/ui.js';

/**
 * Every colour picker offers back the colours this deck has used. Picking a
 * colour remembers it for the deck without taking an undo step of its own.
 */

describe('recent colors list', () => {
  it('puts the latest color first, dedupes by spelling, and caps the list', () => {
    expect(withRecentColor(['#112233', '#abcdef'], '#ABCDEF')).toEqual(['#abcdef', '#112233']);
    expect(withRecentColor([], 'rgba(0,  0, 0, 0.5)')).toEqual(['rgba(0, 0, 0, 0.5)']);
    const full = Array.from({ length: RECENT_COLORS_LIMIT }, (_, i) => `#0000${i.toString(16).padStart(2, '0')}`);
    const next = withRecentColor(full, '#ff0000');
    expect(next).toHaveLength(RECENT_COLORS_LIMIT);
    expect(next[0]).toBe('#ff0000');
    expect(next).not.toContain(full.at(-1));
  });

  it('defaults to empty on decks saved before it existed', () => {
    expect(emptyDeck().recentColors).toEqual([]);
  });
});

describe('recent colors in the picker', () => {
  let store: EditorStore;

  beforeEach(() => {
    document.body.replaceChildren();
    store = new EditorStore(emptyDeck('Colors'), '/decks/colors');
    connectRecentColors(store);
  });

  afterEach(() => {
    closePopover();
    setRecentColorSource(null);
  });

  /** A fill field whose change is a real, undoable deck edit (the title stands in). */
  function openPicker(): HTMLElement {
    const field = colorField('Fill', null, (value) => {
      store.commit((deck) => { deck.title = value ?? 'none'; }, { label: 'Change fill' });
    });
    document.body.appendChild(field);
    field.querySelector<HTMLButtonElement>('.color-picker-trigger')!.click();
    return document.querySelector<HTMLElement>('.color-picker-popover')!;
  }

  function setHex(picker: HTMLElement, hex: string): void {
    const input = picker.querySelector<HTMLInputElement>('input[aria-label="Hex color"]')!;
    input.value = hex;
    input.dispatchEvent(new Event('change'));
  }

  const recentTitles = (picker: HTMLElement) =>
    [...picker.querySelectorAll<HTMLButtonElement>('.color-picker-recent button')].map((b) => b.title);

  it('shows no Recent row until a color has been picked', () => {
    expect(openPicker().querySelector('.color-picker-recent')).toBeNull();
  });

  it('remembers a picked color and offers it first next time', () => {
    setHex(openPicker(), '#ff8800');
    closePopover();
    setHex(openPicker(), '#0055aa');
    closePopover();
    expect(store.get().deck.recentColors).toEqual(['#0055aa', '#ff8800']);
    expect(recentTitles(openPicker())).toEqual(['#0055aa', '#ff8800']);
  });

  it('keeps only where one picking session ended, not every color passed through', () => {
    store.commit((deck) => { deck.recentColors = ['#112233']; }, { history: false });
    const picker = openPicker();
    for (const hex of ['#aa0000', '#bb0000', '#cc0000']) setHex(picker, hex);
    expect(store.get().deck.recentColors).toEqual(['#cc0000', '#112233']);
  });

  it('takes no undo step: undo reverts the recolor and keeps the memory', () => {
    setHex(openPicker(), '#ff8800');
    expect(store.get().deck.title).toBe('#ff8800');
    store.undo();
    expect(store.get().deck.title).toBe('Colors');
    expect(store.canUndo()).toBe(false);
    expect(store.get().deck.recentColors).toEqual(['#ff8800']);
  });

  it('applies a recent color with the opacity it was picked at', () => {
    store.commit((deck) => { deck.recentColors = ['rgba(255, 0, 0, 0.5)']; }, { history: false });
    const picker = openPicker();
    picker.querySelector<HTMLButtonElement>('.color-picker-recent button')!.click();
    expect(store.get().deck.title).toBe('rgba(255, 0, 0, 0.5)');
  });

  it('does not remember clearing a color', () => {
    const picker = openPicker();
    picker.querySelector<HTMLButtonElement>('.color-picker-clear')!.click();
    expect(store.get().deck.recentColors).toEqual([]);
  });
});
