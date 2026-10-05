// Applying a layout needs no DOM, so it lives with the layout model where the
// CLI and main process can reach it too.
export { applySlideLayout } from '@shared/layoutMasters.js';

/** A built-in layout id ('freeform', 'standard', 'title') or one of the deck's own. */
export type SlideLayout = string;

export const LAYOUT_LABELS: Array<[SlideLayout, string]> = [
  ['freeform', 'Freeform'],
  ['standard', 'Title + body'],
  ['title', 'Title slide'],
];
