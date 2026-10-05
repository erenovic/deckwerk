import { z } from 'zod';
import { DeckSchema, emptyDeck, parseDeck, type Deck } from './deck.js';
import { applySlideLayout, defaultLayoutMasters, installLayouts, isTitleLayout } from './layoutMasters.js';
import {
  THEME_BLOCK_END,
  THEME_BLOCK_START,
  adoptThemeStyles,
  deckTheme,
  themeStyleCss,
  themeStyleLabel,
  withThemeBlock,
  type ThemeAdoption,
} from './themes.js';

/**
 * Deck templates: a deck's design, kept apart from any one talk.
 *
 * A template is the part of a deck that says how slides look rather than what
 * they say: its theme and the type and colour choices made on it, its own
 * themes, the layouts and layout masters, page numbers, the slide size and the
 * colours picked along the way, plus the deck's stylesheet. Slides, notes and
 * history stay behind. A new deck starts from one; an existing deck can take
 * one on.
 *
 * Everything here is pure: reading and writing template folders belongs to
 * the main process and the CLI (see main/templateStore.ts).
 */

export const DeckTemplateDesignSchema = DeckSchema.pick({
  canvas: true,
  themePreset: true,
  themeStyle: true,
  themeSelection: true,
  customThemes: true,
  recentColors: true,
  pageNumbers: true,
  layoutMasters: true,
  customLayouts: true,
  morphEasing: true,
});

export type DeckTemplateDesign = z.infer<typeof DeckTemplateDesignSchema>;

export const DeckTemplateSchema = z.object({
  version: z.literal(1),
  id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
  name: z.string().min(1),
  /** The title of the deck it was saved from. */
  source: z.string().default(''),
  /** ISO time it was saved. */
  savedAt: z.string(),
  design: DeckTemplateDesignSchema,
  /** The whole stylesheet, generated block included. */
  css: z.string(),
  /** Deck-relative files the design refers to, copied alongside it. */
  assets: z.array(z.string()).default([]),
});

export type DeckTemplate = z.infer<typeof DeckTemplateSchema>;

/** A file-safe id for a template name: "Looped Transformer" → "looped-transformer". */
export function templateId(name: string): string {
  const slug = name.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return slug || 'template';
}

/** The stylesheet minus its generated theme block: what the author wrote. */
export function handWrittenCss(css: string): string {
  const start = css.indexOf(THEME_BLOCK_START);
  const end = css.indexOf(THEME_BLOCK_END, start);
  if (start === -1 || end === -1) return css.trim();
  return `${css.slice(0, start)}${css.slice(end + THEME_BLOCK_END.length)}`.trim();
}

/** `assets/…` paths a design and stylesheet refer to, so they travel with it. */
export function designAssets(design: DeckTemplateDesign, css: string): string[] {
  const found = new Set<string>();
  const scan = (text: string) => {
    for (const match of text.matchAll(/(?:^|["'(\s])(assets\/[^"'()\s\\]+)/g)) found.add(match[1]);
  };
  scan(JSON.stringify({ layoutMasters: design.layoutMasters, customLayouts: design.customLayouts }));
  scan(css);
  return [...found].sort();
}

export function templateFromDeck(
  deck: Deck,
  css: string,
  name: string,
  savedAt = new Date().toISOString(),
): DeckTemplate {
  const design = DeckTemplateDesignSchema.parse(structuredClone({
    canvas: deck.canvas,
    themePreset: deck.themePreset,
    themeStyle: deck.themeStyle,
    themeSelection: deck.themeSelection,
    customThemes: deck.customThemes,
    recentColors: deck.recentColors,
    pageNumbers: deck.pageNumbers,
    layoutMasters: deck.layoutMasters,
    customLayouts: deck.customLayouts,
    morphEasing: deck.morphEasing,
  }));
  return {
    version: 1,
    id: templateId(name),
    name: name.trim(),
    source: deck.title,
    savedAt,
    design,
    css,
    assets: designAssets(design, css),
  };
}

/** The layout a template's first slide is born on: its own title layout if it has one. */
export function templateTitleLayout(design: DeckTemplateDesign): string {
  const own = design.customLayouts.find((layout) => layout.titleSlide);
  if (own) return own.id;
  return design.layoutMasters || design.customLayouts.length > 0 ? 'title' : 'freeform';
}

/**
 * A new deck wearing the template: its design, its stylesheet, and one slide
 * on its title layout, ready to type into.
 */
export function deckFromTemplate(template: DeckTemplate, title: string): { deck: Deck; css: string } {
  const deck = parseDeck({ ...emptyDeck(title), ...structuredClone(template.design), title });
  const slide = deck.slides[0];
  slide.layout = templateTitleLayout(template.design);
  applySlideLayout(slide, slide.layout, deck.layoutMasters, deck.customLayouts);
  return { deck, css: template.css };
}

/**
 * Dress an existing deck in the template, in place.
 *
 * Its theme is applied to every slide the way the Design tab's deck-wide
 * Apply does, so the slides follow the template's type and colours. Its
 * layouts join the deck's own (one with the same id replaces the deck's), its
 * layout masters and page numbers replace the deck's, and every slide on a
 * layout is laid out again. The slide size is kept: changing it would leave
 * every object where it was on the old canvas.
 *
 * Returns the stylesheet to save: the deck's own rules first, then the
 * template's (so where they disagree the template wins), then the generated
 * block for the theme now installed.
 */
export function applyTemplateToDeck(deck: Deck, template: DeckTemplate, currentCss: string): string {
  const design = structuredClone(template.design);
  const ownThemes = new Set(design.customThemes.map((theme) => theme.id));
  deck.customThemes = [...deck.customThemes.filter((theme) => !ownThemes.has(theme.id)), ...design.customThemes];

  // The template's look, with its own edits folded in, resolved through a deck
  // that wears it exactly as the template's source deck did.
  const wearer = parseDeck({ ...emptyDeck('template'), ...structuredClone(design) });
  const theme = deckTheme(wearer);
  if (theme) {
    adoptThemeStyles(deck, theme, {
      scope: 'deck',
      roles: ['title', 'heading', 'body', 'caption', 'base'],
      fontFamily: true,
      fontWeight: true,
      typeScale: true,
      textColor: true,
      background: true,
      objectColors: true,
      replaceOverrides: true,
      detectRoles: false,
    } as ThemeAdoption, 0, new Set(), new Set(), currentCss);
  }
  // Exactly the template's defaults, whatever the adoption composed on the way.
  deck.themePreset = design.themePreset;
  deck.themeStyle = design.themeStyle;
  deck.themeSelection = design.themeSelection;
  deck.pageNumbers = design.pageNumbers;
  deck.morphEasing = design.morphEasing;
  deck.recentColors = [...new Set([...design.recentColors, ...deck.recentColors])].slice(0, 12);

  const incoming = new Set(design.customLayouts.map((layout) => layout.id));
  const layouts = [...deck.customLayouts.filter((layout) => !incoming.has(layout.id)), ...design.customLayouts];
  // A template with no layouts of any kind leaves the deck's alone.
  if (design.layoutMasters || design.customLayouts.length > 0) {
    installLayouts(deck, design.layoutMasters ?? deck.layoutMasters ?? defaultLayoutMasters(), layouts);
  }
  // A title slide on a plain layout moves onto the template's own title layout.
  const titleLayout = templateTitleLayout(design);
  if (titleLayout !== 'title') {
    for (const slide of deck.slides) {
      if (slide.layout && isTitleLayout(deck, slide.layout) && slide.layout !== titleLayout) {
        applySlideLayout(slide, titleLayout, deck.layoutMasters, deck.customLayouts);
        slide.layout = titleLayout;
      }
    }
  }

  const own = [handWrittenCss(currentCss), handWrittenCss(template.css)]
    .filter((part, index, parts) => part && parts.indexOf(part) === index)
    .join('\n\n');
  const block = deck.themeStyle ? themeStyleCss(deck.themeStyle, themeStyleLabel(deck)) : '';
  return block ? withThemeBlock(`${own}\n`, block) : `${own}\n`;
}
