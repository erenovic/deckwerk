import { describe, expect, it } from 'vitest';
import { reorderSlides } from '../src/shared/slideOrder.js';

const slides = (...ids: string[]) => ids.map((id) => ({ id }));
const order = (result: Array<{ id: string }> | null) => result?.map((slide) => slide.id) ?? null;

describe('moving slides as a block', () => {
  const deck = slides('a', 'b', 'c', 'd', 'e');

  it('moves one slide down and up', () => {
    expect(order(reorderSlides(deck, new Set(['b']), 4))).toEqual(['a', 'c', 'd', 'b', 'e']);
    expect(order(reorderSlides(deck, new Set(['d']), 0))).toEqual(['d', 'a', 'b', 'c', 'e']);
    expect(order(reorderSlides(deck, new Set(['a']), 5))).toEqual(['b', 'c', 'd', 'e', 'a']);
  });

  it('moves a contiguous group in its own order', () => {
    expect(order(reorderSlides(deck, new Set(['b', 'c']), 5))).toEqual(['a', 'd', 'e', 'b', 'c']);
    expect(order(reorderSlides(deck, new Set(['d', 'e']), 1))).toEqual(['a', 'd', 'e', 'b', 'c']);
  });

  it('gathers a scattered selection at the drop point, keeping deck order', () => {
    // Set insertion order must not matter: the block follows the deck.
    expect(order(reorderSlides(deck, new Set(['e', 'a', 'c']), 2))).toEqual(['b', 'a', 'c', 'e', 'd']);
  });

  it('reports no change for a drop that leaves the order as it is', () => {
    expect(reorderSlides(deck, new Set(['b', 'c']), 1)).toBeNull();
    expect(reorderSlides(deck, new Set(['b', 'c']), 3)).toBeNull();
    expect(reorderSlides(deck, new Set(['b']), 2)).toBeNull();
    expect(reorderSlides(deck, new Set(), 0)).toBeNull();
  });

  it('clamps an out-of-range gap', () => {
    expect(order(reorderSlides(deck, new Set(['a']), 99))).toEqual(['b', 'c', 'd', 'e', 'a']);
    expect(order(reorderSlides(deck, new Set(['e']), -3))).toEqual(['e', 'a', 'b', 'c', 'd']);
  });
});
