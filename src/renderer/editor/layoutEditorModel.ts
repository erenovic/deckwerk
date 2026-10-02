import {
  emptyDeck,
  type CustomLayout,
  type Deck,
  type Slide,
  type SlideElement,
  type TextEl,
} from '@shared/deck.js';
import { makeId } from '@shared/geometry.js';
import {
  BUILT_IN_LAYOUTS,
  BUILT_IN_LAYOUT_NAMES,
  defaultLayoutMasters,
  isBuiltInLayout,
  promptCopy,
  slotKind,
  slotRoleClass,
  syncDeckWithLayoutMasters,
  type FixedLayout,
  type SlotKind,
} from '@shared/layoutMasters.js';
import { ROLE_TYPE_SCALE_PROPERTIES } from '@shared/themes.js';
import { applySlideLayout } from './slideLayouts.js';

/**
 * The layout editor edits every layout as a slide of a throwaway deck: the
 * three built-ins first, then the deck's own, in order. This module maps
 * between that editing deck and the real deck's layouts, so the editor's UI
 * deals only in slides and the mapping is testable on its own.
 */

const BUILT_IN_PREFIX = 'master-slide-';
const CUSTOM_PREFIX = 'master-slide-custom-';

/** What a layout of the deck's own carries beyond its slide. */
export interface CustomLayoutMeta {
  basedOn: FixedLayout;
  titleSlide: boolean;
}

export function editingSlideId(layoutId: string): string {
  return isBuiltInLayout(layoutId) ? `${BUILT_IN_PREFIX}${layoutId}` : `${CUSTOM_PREFIX}${layoutId}`;
}

/** The layout an editing-deck slide stands for. */
export function layoutIdOfEditingSlide(slideId: string): string {
  return slideId.startsWith(CUSTOM_PREFIX)
    ? slideId.slice(CUSTOM_PREFIX.length)
    : slideId.slice(BUILT_IN_PREFIX.length);
}

export function isCustomEditingSlide(slideId: string): boolean {
  return slideId.startsWith(CUSTOM_PREFIX);
}

/** The editing deck for `source`'s layouts, and the extra facts of its own ones. */
export function layoutEditingDeck(source: Deck): { deck: Deck; meta: Map<string, CustomLayoutMeta> } {
  const masters = structuredClone(source.layoutMasters ?? defaultLayoutMasters());
  const deck = emptyDeck('Layout masters');
  deck.canvas = structuredClone(source.canvas);
  // The masters are edited under the deck's own theme, so the editing deck has
  // to answer "which theme is this deck wearing" the same way the deck does.
  deck.themePreset = source.themePreset;
  deck.themeStyle = source.themeStyle ? structuredClone(source.themeStyle) : null;
  deck.themeSelection = source.themeSelection ? structuredClone(source.themeSelection) : null;
  deck.customThemes = structuredClone(source.customThemes ?? []);
  const meta = new Map<string, CustomLayoutMeta>();
  deck.slides = [
    ...BUILT_IN_LAYOUTS.map((layout): Slide => ({
      id: editingSlideId(layout),
      name: BUILT_IN_LAYOUT_NAMES[layout],
      background: structuredClone(masters[layout].background),
      notes: '',
      layout: 'freeform',
      elements: structuredClone(masters[layout].elements),
      timeline: [],
    })),
    ...(source.customLayouts ?? []).map((layout): Slide => {
      meta.set(layout.id, { basedOn: layout.basedOn, titleSlide: layout.titleSlide });
      return {
        id: editingSlideId(layout.id),
        name: layout.name,
        background: structuredClone(layout.background),
        notes: '',
        layout: 'freeform',
        elements: structuredClone(layout.elements),
        timeline: [],
      };
    }),
  ];
  return { deck, meta };
}

/**
 * A new layout of the deck's own, copied from an editing slide: same
 * background, objects and placeholders under fresh ids (ids are unique
 * across the editing deck, and later across every slide using the layout).
 */
export function newLayoutSlide(from: Slide, name: string): { slide: Slide; layoutId: string } {
  const layoutId = makeId('layout');
  const slide: Slide = {
    id: editingSlideId(layoutId),
    name,
    background: structuredClone(from.background),
    notes: '',
    layout: 'freeform',
    elements: structuredClone(from.elements).map((element) => ({ ...element, id: makeId(element.type) })),
    timeline: [],
  };
  return { slide, layoutId };
}

/** A name for a new layout that no other layout already has. */
export function uniqueLayoutName(deck: Deck, base: string): string {
  const taken = new Set(deck.slides.map((slide) => slide.name));
  if (!taken.has(base)) return base;
  for (let n = 2; ; n++) {
    if (!taken.has(`${base} ${n}`)) return `${base} ${n}`;
  }
}

/** The next free slot of a kind on a layout, or null when it has its one title. */
export function nextSlot(elements: readonly SlideElement[], kind: SlotKind): string | null {
  const used = new Set(elements
    .map((element) => (element.type === 'text' ? element.layoutPlaceholder : undefined))
    .filter((slot): slot is string => Boolean(slot)));
  if (kind === 'title') return used.has('title') ? null : 'title';
  if (!used.has(kind)) return kind;
  for (let n = 2; n <= 9; n++) if (!used.has(`${kind}-${n}`)) return `${kind}-${n}`;
  return null;
}

/** Where a new placeholder of each kind starts on a 1920×1080 canvas. */
const SLOT_BOXES: Record<SlotKind, Pick<TextEl, 'x' | 'y' | 'w' | 'h' | 'align' | 'valign'>> = {
  title: { x: 120, y: 58, w: 1680, h: 142, align: 'left', valign: 'middle' },
  subtitle: { x: 120, y: 210, w: 1680, h: 90, align: 'left', valign: 'middle' },
  body: { x: 120, y: 320, w: 1680, h: 620, align: 'left', valign: 'top' },
  caption: { x: 120, y: 960, w: 1680, h: 70, align: 'left', valign: 'middle' },
};

/** A fresh placeholder for `slot`, its prompt showing, offset when it is a second of its kind. */
export function placeholderFor(slot: string, canvas: { w: number; h: number }, z: number): TextEl {
  const kind = slotKind(slot);
  const box = SLOT_BOXES[kind];
  const sx = canvas.w / 1920;
  const sy = canvas.h / 1080;
  const offset = (Number(/-(\d+)$/.exec(slot)?.[1] ?? 1) - 1) * 40;
  return {
    id: makeId('text'),
    type: 'text',
    x: Math.round((box.x + offset) * sx),
    y: Math.round((box.y + offset) * sy),
    w: Math.round(box.w * sx),
    h: Math.round(box.h * sy),
    rot: 0,
    z,
    opacity: 1,
    class: [slotRoleClass(slot), 'placeholder'],
    style: {},
    html: promptCopy(slot),
    align: box.align,
    valign: box.valign,
    autoFit: true,
    layoutPlaceholder: slot,
  };
}

/**
 * Lay a layout's body placeholders out as equal columns across the space the
 * earlier bodies covered, in their left-to-right order, the newest last. One
 * body is left as it is.
 */
export function tileBodyPlaceholders(elements: SlideElement[], canvas: { w: number; h: number }): void {
  const bodies = elements.filter((element): element is TextEl => element.type === 'text'
    && Boolean(element.layoutPlaceholder) && slotKind(element.layoutPlaceholder!) === 'body');
  if (bodies.length < 2) return;
  const newest = bodies[bodies.length - 1];
  const earlier = bodies.slice(0, -1);
  const left = Math.min(...earlier.map((body) => body.x));
  const top = Math.min(...earlier.map((body) => body.y));
  const right = Math.max(...earlier.map((body) => body.x + body.w));
  const bottom = Math.max(...earlier.map((body) => body.y + body.h));
  const gap = Math.round(60 * canvas.w / 1920);
  const width = Math.round((right - left - gap * (bodies.length - 1)) / bodies.length);
  const ordered = [...earlier.sort((a, b) => a.x - b.x), newest];
  ordered.forEach((body, index) => {
    body.x = left + index * (width + gap);
    body.y = top;
    body.w = width;
    body.h = bottom - top;
  });
}

/** A master's elements as the deck stores them: no editor marks, no type scale, slot roles. */
function storedElements(elements: readonly SlideElement[]): SlideElement[] {
  const copy = structuredClone(elements) as SlideElement[];
  for (const element of copy) {
    delete element.layoutMasterId;
    element.class = element.class.filter((name) => name !== 'layout-master-element');
    if (element.type === 'text') {
      // Sizes are the deck's, not the layout's (see copyPlaceholderPresentation).
      for (const property of ROLE_TYPE_SCALE_PROPERTIES) {
        delete element.style[property];
        if (element.contentStyle) delete element.contentStyle[property];
      }
    }
    if (element.type === 'text' && element.layoutPlaceholder) {
      element.class = [
        ...element.class.filter((name) => !name.startsWith('role-') && name !== 'placeholder'),
        slotRoleClass(element.layoutPlaceholder),
        'placeholder',
      ];
    }
  }
  return copy;
}

/** The built-in masters and the deck's own layouts the editing deck now describes. */
export function layoutsFromEditingDeck(
  deck: Deck,
  meta: ReadonlyMap<string, CustomLayoutMeta>,
): { masters: NonNullable<Deck['layoutMasters']>; customLayouts: CustomLayout[] } {
  const defaults = defaultLayoutMasters();
  const masters = {} as NonNullable<Deck['layoutMasters']>;
  for (const layout of BUILT_IN_LAYOUTS) {
    const slide = deck.slides.find((candidate) => candidate.id === editingSlideId(layout));
    masters[layout] = {
      background: structuredClone(slide?.background ?? defaults[layout].background),
      elements: storedElements(slide?.elements ?? defaults[layout].elements),
    };
  }
  const customLayouts = deck.slides
    .filter((slide) => isCustomEditingSlide(slide.id))
    .map((slide): CustomLayout => {
      const id = layoutIdOfEditingSlide(slide.id);
      const extra = meta.get(id) ?? { basedOn: 'standard', titleSlide: false };
      return {
        id,
        name: slide.name.trim() || 'Untitled layout',
        basedOn: extra.basedOn,
        titleSlide: extra.titleSlide,
        background: structuredClone(slide.background),
        elements: storedElements(slide.elements),
      };
    });
  return { masters, customLayouts };
}

/**
 * Install edited layouts into the real deck: slides on a layout that was
 * deleted move to the built-in it was based on (their content kept), then
 * every slide follows its layout.
 */
export function installLayouts(
  deck: Deck,
  masters: NonNullable<Deck['layoutMasters']>,
  customLayouts: CustomLayout[],
): void {
  const previous = new Map((deck.customLayouts ?? []).map((layout) => [layout.id, layout]));
  deck.layoutMasters = masters;
  deck.customLayouts = customLayouts;
  const kept = new Set(customLayouts.map((layout) => layout.id));
  for (const slide of deck.slides) {
    const gone = slide.layout && !isBuiltInLayout(slide.layout) && !kept.has(slide.layout)
      ? previous.get(slide.layout)
      : undefined;
    if (gone) applySlideLayout(slide, gone.basedOn, masters, customLayouts);
  }
  syncDeckWithLayoutMasters(deck);
}

/** How many of the deck's slides use each layout. */
export function layoutUsage(deck: Deck): Map<string, number> {
  const usage = new Map<string, number>();
  for (const slide of deck.slides) {
    const layout = slide.layout ?? 'freeform';
    usage.set(layout, (usage.get(layout) ?? 0) + 1);
  }
  return usage;
}
