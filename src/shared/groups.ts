import type { SlideElement } from './deck.js';

/**
 * Object groups.
 *
 * A group is not an object of its own: each member carries `groups`, the ids
 * of the groups it belongs to from the outermost in. A slide stays a flat list
 * of elements, so paint order, builds, Morph, the diff, collaboration and the
 * HTML round-trip all keep working on ordinary elements; a group is simply
 * every element whose path names it.
 *
 * What a click picks is a *unit*: the outermost group under the cursor, or,
 * once the author has gone into a group, the next thing down inside it. Which
 * group the author is in is read off the selection rather than kept as state:
 * it is the innermost group holding everything selected without being wholly
 * selected itself (see `selectionContext`).
 */

type Grouped = Pick<SlideElement, 'id' | 'groups'>;

export function groupPath(element: Grouped): readonly string[] {
  return element.groups ?? [];
}

/** Ids of every element in `groupId`, in slide order. */
export function groupMemberIds(elements: readonly Grouped[], groupId: string): string[] {
  return elements.filter((element) => groupPath(element).includes(groupId)).map((element) => element.id);
}

/** The group immediately holding `groupId`, or null at the top level. */
export function parentGroup(elements: readonly Grouped[], groupId: string): string | null {
  for (const element of elements) {
    const path = groupPath(element);
    const at = path.indexOf(groupId);
    if (at !== -1) return at > 0 ? path[at - 1] : null;
  }
  return null;
}

/**
 * The group the author is working inside: the innermost group that holds
 * every selected element but is not itself wholly selected. Null at the top
 * level, which is also where an empty selection leaves you.
 */
export function selectionContext(elements: readonly Grouped[], selection: ReadonlySet<string>): string | null {
  const selected = elements.filter((element) => selection.has(element.id));
  if (selected.length === 0) return null;
  const common = [...groupPath(selected[0])];
  for (const element of selected.slice(1)) {
    const path = groupPath(element);
    let shared = 0;
    while (shared < common.length && common[shared] === path[shared]) shared += 1;
    common.length = shared;
  }
  for (let at = common.length - 1; at >= 0; at--) {
    if (groupMemberIds(elements, common[at]).length > selected.length) return common[at];
  }
  return null;
}

/**
 * What a click on `element` picks while the author is inside `context`: the
 * outermost group below `context` that holds it, or the element itself.
 * Inside a group the author is not in, the click picks from the top level.
 */
export function unitGroup(element: Grouped, context: string | null): string | null {
  const path = groupPath(element);
  const inside = context === null ? -1 : path.indexOf(context);
  return path[inside + 1] ?? null;
}

/** Element ids a click on `element` selects while inside `context`. */
export function unitIds(elements: readonly Grouped[], element: Grouped, context: string | null): string[] {
  const group = unitGroup(element, context);
  return group ? groupMemberIds(elements, group) : [element.id];
}

/**
 * The groups that are wholly selected and are not inside another wholly
 * selected group: what Ungroup takes apart and what the canvas frames.
 */
export function selectedGroups(elements: readonly Grouped[], selection: ReadonlySet<string>): string[] {
  const whole = new Map<string, boolean>();
  for (const element of elements) {
    for (const group of groupPath(element)) {
      whole.set(group, (whole.get(group) ?? true) && selection.has(element.id));
    }
  }
  const out: string[] = [];
  for (const element of elements) {
    if (!selection.has(element.id)) continue;
    const top = groupPath(element).find((group) => whole.get(group));
    if (top && !out.includes(top)) out.push(top);
  }
  return out;
}

/** The pieces a group is made of, one level down: its own groups and its loose elements. */
export type GroupChild = { kind: 'group'; id: string; memberIds: string[] } | { kind: 'element'; id: string };

export function groupChildren(elements: readonly Grouped[], groupId: string | null): GroupChild[] {
  const children: GroupChild[] = [];
  const seen = new Set<string>();
  for (const element of elements) {
    const path = groupPath(element);
    const at = groupId === null ? -1 : path.indexOf(groupId);
    if (groupId !== null && at === -1) continue;
    const next = path[at + 1];
    if (!next) {
      children.push({ kind: 'element', id: element.id });
    } else if (!seen.has(next)) {
      seen.add(next);
      children.push({ kind: 'group', id: next, memberIds: groupMemberIds(elements, next) });
    }
  }
  return children;
}

function setPath(element: Grouped, path: string[]): void {
  if (path.length > 0) element.groups = path;
  else delete element.groups;
}

/**
 * Dissolve every group with fewer than two pieces in it: one left behind by a
 * delete, or one that only wraps another group. Repeats until nothing changes,
 * since removing one can leave its parent wrapping a single piece.
 */
export function pruneGroups(elements: Grouped[]): void {
  for (;;) {
    const groups = new Set(elements.flatMap((element) => [...groupPath(element)]));
    const lone = [...groups].filter((group) => groupChildren(elements, group).length < 2);
    if (lone.length === 0) return;
    for (const element of elements) {
      const path = groupPath(element);
      if (path.some((group) => lone.includes(group))) setPath(element, path.filter((group) => !lone.includes(group)));
    }
  }
}

/**
 * Put the selected pieces in a new group `groupId`, inside the group they
 * share (so grouping inside a group nests), and gather them into one run of
 * the paint order at the height of the topmost, as design tools do.
 *
 * Returns false when there is nothing to group: fewer than two pieces, or a
 * selection that is already exactly one group.
 */
export function groupSelection(
  elements: Array<Grouped & Pick<SlideElement, 'z'>>,
  selection: ReadonlySet<string>,
  groupId: string,
): boolean {
  const selected = elements.filter((element) => selection.has(element.id));
  if (selected.length < 2) return false;
  const context = selectionContext(elements, selection);
  const pieces = new Set(selected.map((element) => unitGroup(element, context) ?? element.id));
  if (pieces.size < 2) return false;
  for (const element of selected) {
    const path = [...groupPath(element)];
    const at = context === null ? 0 : path.indexOf(context) + 1;
    path.splice(at, 0, groupId);
    setPath(element, path);
  }
  const order = elements
    .map((element, index) => ({ element, index }))
    .sort((a, b) => a.element.z - b.element.z || a.index - b.index)
    .map(({ element }) => element);
  let top = order.length - 1;
  while (!selection.has(order[top].id)) top -= 1;
  const below = order.slice(0, top + 1).filter((element) => !selection.has(element.id));
  const above = order.slice(top + 1);
  const restacked = [...below, ...order.filter((element) => selection.has(element.id)), ...above];
  // Only renumber when the run was actually broken: grouping objects that are
  // already adjacent leaves every z alone.
  if (restacked.some((element, index) => element !== order[index])) {
    const base = Math.min(...elements.map((element) => element.z));
    restacked.forEach((element, index) => { element.z = base + index; });
  }
  return true;
}

/** Take the selected groups apart one level, leaving their pieces selected. */
export function ungroupSelection(elements: Grouped[], selection: ReadonlySet<string>): string[] {
  const groups = selectedGroups(elements, selection);
  for (const element of elements) {
    const path = groupPath(element);
    if (path.some((group) => groups.includes(group))) setPath(element, path.filter((group) => !groups.includes(group)));
  }
  return groups;
}

/**
 * Give copied elements groups of their own. A group copied whole becomes a
 * new group (`fresh` mints its id) so the copy moves apart from the original;
 * a group only partly copied is kept when `keepPartial` (a duplicate inside a
 * group stays in it) and dropped otherwise (a paste lands outside any group).
 */
export function remapCopiedGroups(
  copies: Grouped[],
  sources: readonly Grouped[],
  fresh: () => string,
  keepPartial: boolean,
): void {
  const renamed = new Map<string, string | null>();
  const sourceCount = (group: string) => groupMemberIds(sources, group).length;
  for (const copy of copies) {
    const path = groupPath(copy);
    if (path.length === 0) continue;
    const next: string[] = [];
    for (const group of path) {
      if (!renamed.has(group)) {
        const copiedMembers = copies.filter((other) => groupPath(other).includes(group)).length;
        renamed.set(group, copiedMembers >= sourceCount(group) && copiedMembers > 0 ? fresh() : keepPartial ? group : null);
      }
      const name = renamed.get(group);
      if (name) next.push(name);
    }
    setPath(copy, next);
  }
}
