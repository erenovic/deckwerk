// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { emptyDeck } from '../src/shared/deck.js';
import { defaultLayoutMasters } from '../src/shared/layoutMasters.js';
import {
  layoutEditingDeck,
  layoutsFromEditingDeck,
  newLayoutSlide,
  nextSlot,
  placeholderFor,
  tileBodyPlaceholders,
} from '../src/renderer/editor/layoutEditorModel.js';

describe('the layout editor model', () => {
  it('round-trips the built-ins and the deck’s own layouts through the editing deck', () => {
    const deck = emptyDeck('Model');
    deck.layoutMasters = defaultLayoutMasters();
    deck.customLayouts = [{
      id: 'layout-a', name: 'A', basedOn: 'standard', titleSlide: false,
      background: { color: null, image: null }, elements: [],
    }];
    const { deck: editing, meta } = layoutEditingDeck(deck);
    expect(editing.slides.map((slide) => slide.name)).toEqual(['Freeform', 'Title + Body', 'Title', 'A']);
    const { masters, customLayouts } = layoutsFromEditingDeck(editing, meta);
    expect(masters).toEqual(deck.layoutMasters);
    expect(customLayouts).toEqual(deck.customLayouts);
  });

  it('copies a layout under fresh element ids', () => {
    const source = layoutEditingDeck(emptyDeck('Copy')).deck.slides[1];
    const { slide } = newLayoutSlide(source, 'Copy');
    expect(slide.elements.map((element) => element.id)).not.toEqual(source.elements.map((element) => element.id));
    expect(slide.elements.map((element) => element.type === 'text' ? element.layoutPlaceholder : null))
      .toEqual(['title', 'body']);
  });

  it('finds the next free slot of a kind and places a new placeholder', () => {
    const elements = [placeholderFor('title', { w: 1920, h: 1080 }, 10), placeholderFor('body', { w: 1920, h: 1080 }, 11)];
    expect(nextSlot(elements, 'title')).toBeNull();
    expect(nextSlot(elements, 'body')).toBe('body-2');
    expect(nextSlot(elements, 'caption')).toBe('caption');
    const second = placeholderFor('body-2', { w: 1920, h: 1080 }, 12);
    expect(second).toMatchObject({ html: 'Body text 2', class: ['role-body', 'placeholder'], layoutPlaceholder: 'body-2' });
    expect(second.x).toBe(elements[1].x + 40);
  });
});

describe('columns', () => {
  it('shares the first body\u2019s space between the bodies, side by side', () => {
    const canvas = { w: 1920, h: 1080 };
    const body = { ...placeholderFor('body', canvas, 11), x: 120, y: 252, w: 1680, h: 700 };
    const elements = [body, placeholderFor('body-2', canvas, 12)];
    tileBodyPlaceholders(elements, canvas);
    expect(elements.map(({ x, y, w, h }) => ({ x, y, w, h }))).toEqual([
      { x: 120, y: 252, w: 810, h: 700 },
      { x: 990, y: 252, w: 810, h: 700 },
    ]);
    elements.push(placeholderFor('body-3', canvas, 13));
    tileBodyPlaceholders(elements, canvas);
    expect(elements.map(({ x, w }) => [x, w])).toEqual([[120, 520], [700, 520], [1280, 520]]);
  });
});
