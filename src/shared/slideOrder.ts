/**
 * Move a set of slides, as one block in their current relative order, to an
 * insertion point in the rail.
 *
 * `insertAt` is a gap in the *current* order: 0 is before the first slide,
 * `slides.length` after the last. The moving slides may be scattered; they
 * land contiguously at that gap, so dropping a Cmd-picked set gathers it.
 * Returns null when the result is the order the deck already has — a drop
 * inside or beside the block itself — so the caller records no edit.
 */
export function reorderSlides<T extends { id: string }>(
  slides: readonly T[],
  moving: ReadonlySet<string>,
  insertAt: number,
): T[] | null {
  const gap = Math.max(0, Math.min(insertAt, slides.length));
  const block = slides.filter((slide) => moving.has(slide.id));
  if (block.length === 0) return null;
  const before = slides.slice(0, gap).filter((slide) => !moving.has(slide.id));
  const after = slides.slice(gap).filter((slide) => !moving.has(slide.id));
  const next = [...before, ...block, ...after];
  return next.every((slide, i) => slide === slides[i]) ? null : next;
}
