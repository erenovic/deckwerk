// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { emptyDeck, parseDeck } from '../src/shared/deck.js';
import { FindBar } from '../src/renderer/editor/findBar.js';
import { SpeakerNotesDrawer } from '../src/renderer/editor/speakerNotesDrawer.js';
import { EditorStore } from '../src/renderer/editor/store.js';

/**
 * The find bar steps through matches across the deck: each step selects the
 * slide holding the match and the object it is in, or opens the notes.
 */

function makeStore(): EditorStore {
  const base = emptyDeck('Find');
  const deck = parseDeck({
    ...base,
    slides: [
      { id: 's1', notes: '', elements: [{ id: 'a', type: 'text', x: 0, y: 0, w: 10, h: 10, html: '<p>one fish</p>' }] },
      { id: 's2', notes: 'say fish slowly', elements: [] },
      { id: 's3', notes: '', elements: [{ id: 'c', type: 'text', x: 0, y: 0, w: 10, h: 10, html: '<p>red fish, blue fish</p>' }] },
    ],
  });
  return new EditorStore(deck, '/decks/find');
}

describe('find bar', () => {
  let host: HTMLElement;

  beforeEach(() => {
    document.body.replaceChildren();
    try { localStorage.removeItem('deckwerk.editor.speaker-notes-mode'); } catch { // jsdom without storage
    }
    host = document.createElement('div');
    document.body.append(host);
  });

  function type(bar: FindBar, query: string): void {
    bar.input.value = query;
    bar.input.dispatchEvent(new Event('input'));
  }

  function key(bar: FindBar, keyName: string, shiftKey = false): void {
    bar.input.dispatchEvent(new KeyboardEvent('keydown', { key: keyName, shiftKey, bubbles: true }));
  }

  const count = () => host.querySelector('.find-count')!.textContent;

  it('opens focused, counts matches, and jumps to the first one', () => {
    const store = makeStore();
    const bar = new FindBar(host, store);
    bar.show();
    expect(bar.element.hidden).toBe(false);
    expect(document.activeElement).toBe(bar.input);

    type(bar, 'FISH');
    expect(bar.results()).toHaveLength(4);
    expect(count()).toBe('1 of 4');
    expect(store.get().slideIndex).toBe(0);
    expect([...store.get().selection]).toEqual(['a']);
  });

  it('steps forward and back through slides, objects and notes, wrapping at the ends', () => {
    const store = makeStore();
    const notes = new SpeakerNotesDrawer(host, store);
    const bar = new FindBar(host, store, { notes });
    bar.show();
    type(bar, 'fish');

    key(bar, 'Enter');
    expect(count()).toBe('2 of 4');
    expect(store.get().slideIndex).toBe(1);
    expect(notes.isOpen()).toBe(true);
    expect(notes.getMode()).toBe('preview');
    // The query keeps focus, so Enter keeps stepping.
    expect(document.activeElement).toBe(bar.input);

    key(bar, 'Enter');
    key(bar, 'Enter');
    expect(count()).toBe('4 of 4');
    expect(store.get().slideIndex).toBe(2);
    expect([...store.get().selection]).toEqual(['c']);

    key(bar, 'Enter');
    expect(count()).toBe('1 of 4');
    expect(store.get().slideIndex).toBe(0);

    key(bar, 'Enter', true);
    expect(count()).toBe('4 of 4');
  });

  it('starts from the slide in view rather than the top of the deck', () => {
    const store = makeStore();
    store.selectSlide(2);
    const bar = new FindBar(host, store);
    bar.show();
    type(bar, 'fish');
    expect(count()).toBe('3 of 4');
    expect(store.get().slideIndex).toBe(2);
  });

  it('says so when nothing matches and disables stepping', () => {
    const store = makeStore();
    const bar = new FindBar(host, store);
    bar.show();
    type(bar, 'whale');
    expect(count()).toBe('No results');
    expect(host.querySelector<HTMLButtonElement>('.find-next')!.disabled).toBe(true);
    key(bar, 'Enter');
    expect(store.get().slideIndex).toBe(0);
  });

  it('follows edits to the deck while open', async () => {
    const store = makeStore();
    const bar = new FindBar(host, store);
    bar.show();
    type(bar, 'fish');
    store.commit((deck) => {
      deck.slides[1].notes = '';
    }, { label: 'Edit speaker notes' });
    key(bar, 'Enter');
    expect(bar.results()).toHaveLength(3);
  });

  it('keeps typing in the query away from the deck shortcuts and closes on Escape', () => {
    const store = makeStore();
    const bar = new FindBar(host, store);
    let reachedWindow = false;
    const listener = () => { reachedWindow = true; };
    window.addEventListener('keydown', listener);
    bar.show();
    key(bar, 'Backspace');
    expect(reachedWindow).toBe(false);
    key(bar, 'Escape');
    expect(bar.isOpen()).toBe(false);
    expect(bar.element.hidden).toBe(true);
    window.removeEventListener('keydown', listener);
  });
});
