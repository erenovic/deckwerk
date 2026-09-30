// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { emptyDeck, parseDeck, type Deck } from '../src/shared/deck.js';
import { collectText, occurrences, rangesIn, searchDeck } from '../src/renderer/editor/deckSearch.js';

function deckOf(slides: Array<{ id: string; notes?: string; texts?: string[]; html?: string }>): Deck {
  const base = emptyDeck('Search');
  return parseDeck({
    ...base,
    slides: slides.map((slide) => ({
      id: slide.id,
      notes: slide.notes ?? '',
      elements: [
        ...(slide.texts ?? []).map((html, i) => ({
          id: `${slide.id}-t${i}`, type: 'text', x: 0, y: 0, w: 100, h: 100, html,
        })),
        ...(slide.html ? [{ id: `${slide.id}-h`, type: 'html', x: 0, y: 0, w: 100, h: 100, html: slide.html }] : []),
        { id: `${slide.id}-shape`, type: 'shape', shape: 'rect', x: 0, y: 0, w: 10, h: 10 },
      ],
    })),
  });
}

describe('deck search', () => {
  it('finds words across formatting, case-insensitively, in reading order', () => {
    const deck = deckOf([
      { id: 's1', texts: ['<p>Scaling <b>Law</b>s</p>', '<p>nothing here</p>'], notes: 'Mention the scaling laws twice: laws.' },
      { id: 's2', texts: ['<p>More LAWS</p>'] },
    ]);
    const matches = searchDeck(deck, 'laws');
    expect(matches.map((m) => [m.slideId, m.source, m.elementId ?? null, m.occurrence])).toEqual([
      ['s1', 'element', 's1-t0', 0],
      ['s1', 'notes', null, 0],
      ['s1', 'notes', null, 1],
      ['s2', 'element', 's2-t0', 0],
    ]);
  });

  it('searches tables and HTML regions but never across two cells or paragraphs', () => {
    const deck = deckOf([{
      id: 's1',
      texts: ['<table><tr><td>alpha</td><td>beta</td></tr></table>', '<p>end</p><p>ing</p>'],
      html: '<style>.x { color: red }</style><div>gamma <span>delta</span></div>',
    }]);
    expect(searchDeck(deck, 'beta')).toHaveLength(1);
    expect(searchDeck(deck, 'alphabeta')).toHaveLength(0);
    expect(searchDeck(deck, 'ending')).toHaveLength(0);
    expect(searchDeck(deck, 'gamma delta')).toHaveLength(1);
    // Stylesheet text is not words on the slide.
    expect(searchDeck(deck, 'color')).toHaveLength(0);
  });

  it('finds nothing for an empty or blank query', () => {
    const deck = deckOf([{ id: 's1', texts: ['<p>text</p>'], notes: 'notes' }]);
    expect(searchDeck(deck, '')).toEqual([]);
    expect(searchDeck(deck, '   ')).toEqual([]);
  });

  it('counts non-overlapping occurrences', () => {
    expect(occurrences('aaaa', 'aa')).toEqual([0, 2]);
    expect(occurrences('Hello hello', 'HELLO')).toEqual([0, 6]);
  });

  it('maps occurrences back to DOM ranges, including one split across inline tags', () => {
    const root = document.createElement('div');
    root.innerHTML = '<p>Scaling <b>Law</b>s and laws</p><p>laws</p>';
    const ranges = rangesIn(root, 'laws');
    expect(ranges.map((range) => range.toString())).toEqual(['Laws', 'laws', 'laws']);
    expect(collectText(root).text).toBe('Scaling Laws and laws\nlaws');
  });

  it('skips the hidden MathML copy KaTeX renders beside the visible math', () => {
    const root = document.createElement('div');
    root.innerHTML = '<span class="katex"><span class="katex-mathml">x squared</span>'
      + '<span class="katex-html">x2</span></span> squared';
    expect(rangesIn(root, 'squared')).toHaveLength(1);
  });
});
