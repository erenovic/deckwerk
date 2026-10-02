import type { Deck, Slide } from '@shared/deck.js';
import {
  resolveLayoutMaster,
  resolvedLayoutId,
  syncSlideWithLayoutMaster,
} from '@shared/layoutMasters.js';

/** A built-in layout id ('freeform', 'standard', 'title') or one of the deck's own. */
export type SlideLayout = string;

/** Apply layout geometry without consulting or mutating the installed theme. */
export function applySlideLayout(
  slide: Slide,
  layout: SlideLayout,
  masters: Deck['layoutMasters'] = null,
  customLayouts: Deck['customLayouts'] = [],
): void {
  const source = { layoutMasters: masters, customLayouts };
  const id = resolvedLayoutId(source, layout);
  syncSlideWithLayoutMaster(slide, id, resolveLayoutMaster(source, id), {
    forceBackground: Boolean(masters) || customLayouts.some((custom) => custom.id === id),
    replaceStyle: true,
  });
}

export const LAYOUT_LABELS: Array<[SlideLayout, string]> = [
  ['freeform', 'Freeform'],
  ['standard', 'Title + body'],
  ['title', 'Title slide'],
];
