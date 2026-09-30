/**
 * The deck's recently used colours, offered back in every colour picker.
 *
 * The list is deck state (`Deck.recentColors`) so it travels with the folder
 * and reaches collaborators, but it is a memory of the author's choices, not
 * an edit: undoing a recolour does not un-remember the colour, just as it
 * would not in any other design tool. The editor records it with a
 * `history: false` commit for that reason.
 */

export const RECENT_COLORS_LIMIT = 12;

/** Canonical spelling for comparison: the picker emits lowercase hex or `rgba(…)`. */
function canonical(color: string): string {
  return color.trim().toLowerCase().replace(/\s+/g, ' ');
}

/** Return `list` with `color` moved (or added) to the front, capped. */
export function withRecentColor(list: readonly string[], color: string): string[] {
  const picked = canonical(color);
  const rest = list.filter((entry) => canonical(entry) !== picked);
  return [picked, ...rest].slice(0, RECENT_COLORS_LIMIT);
}
