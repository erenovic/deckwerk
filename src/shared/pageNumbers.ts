import { PageNumbersSchema, type Deck, type PageNumbers } from './deck.js';

/**
 * What a slide's page number reads, from the deck's numbering settings.
 *
 * Numbers follow the slides the audience sees: a hidden slide is skipped by
 * the presentation, so it is not counted and the slide after it does not
 * jump a number. A title slide and the first slide are still counted when
 * their number is hidden, as in PowerPoint and Keynote, so the slide after a
 * title page reads "2". `startAt` renumbers from the first counted slide on.
 */

/** Settings for a deck that turns numbering on without choosing anything else. */
export const DEFAULT_PAGE_NUMBERS: PageNumbers = PageNumbersSchema.parse({});

/** The label for the slide at `slideIndex`, or null when it shows none. */
export function pageNumberLabel(deck: Deck, slideIndex: number): string | null {
  const settings = deck.pageNumbers;
  const slide = deck.slides[slideIndex];
  if (!settings || !slide || slide.skipped) return null;
  let ordinal = 0;
  let total = 0;
  for (let index = 0; index < deck.slides.length; index++) {
    if (deck.slides[index].skipped) continue;
    total += 1;
    if (index <= slideIndex) ordinal = total;
  }
  if (settings.hideOnFirst && ordinal === 1) return null;
  if (settings.hideOnTitle && slide.layout === 'title') return null;
  const number = settings.startAt + ordinal - 1;
  return settings.format === 'number-of-total'
    ? `${number} / ${settings.startAt + total - 1}`
    : String(number);
}
