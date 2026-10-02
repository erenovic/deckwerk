import { joinMathAcrossRuns } from '../player/mathRuns.js';

/**
 * Leftovers a text edit should not save.
 *
 * Chromium's editing wraps text it moves (a deletion that merges two runs, a
 * retyped word) in spans carrying the computed style it had, and pasting
 * brings runs from elsewhere. Two kinds of leftover do harm:
 *
 * - A formula cut across runs. KaTeX then cannot find its `$…$` and the slide
 *   shows source. The renderer copes (mathRuns.ts), but the stored text should
 *   be one run per formula, so agents, search and exports read it whole.
 * - Spacing nobody chose: `letter-spacing: 0px` on a run whose box already
 *   has that spacing. The editor never sets spacing per run, so a run whose
 *   spacing equals what it would inherit is noise; it goes, and a span left
 *   with nothing on it is unwrapped by the caller's span normalisation.
 *
 * Runs on the live editing surface when the session ends, while computed
 * styles are available to tell inherited spacing from chosen spacing.
 */

const SPACING = ['letter-spacing', 'word-spacing'] as const;

/** `normal` spacing is zero; compare the two spellings as one. */
function spacingValue(value: string): string {
  return value === 'normal' ? '0px' : value;
}

function dropInheritedSpacing(body: HTMLElement): void {
  for (const node of body.querySelectorAll<HTMLElement>('[style]')) {
    for (const property of SPACING) {
      const declared = node.style.getPropertyValue(property);
      if (!declared) continue;
      const priority = node.style.getPropertyPriority(property);
      const own = spacingValue(getComputedStyle(node).getPropertyValue(property));
      node.style.removeProperty(property);
      const inherited = spacingValue(getComputedStyle(node).getPropertyValue(property));
      if (own !== inherited) node.style.setProperty(property, declared, priority);
    }
    if (!node.getAttribute('style')?.trim()) node.removeAttribute('style');
  }
}

/** Tidy a text body in place; true when anything changed. */
export function tidyTextRuns(body: HTMLElement): boolean {
  const before = body.innerHTML;
  joinMathAcrossRuns(body);
  dropInheritedSpacing(body);
  return body.innerHTML !== before;
}
