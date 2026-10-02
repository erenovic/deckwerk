import { describe, expect, it } from 'vitest';
import {
  groupChildren,
  groupSelection,
  pruneGroups,
  remapCopiedGroups,
  selectedGroups,
  selectionContext,
  ungroupSelection,
  unitIds,
} from '../src/shared/groups.js';

/**
 * Groups are paths on ordinary elements; these are the rules every gesture
 * (click, ⌘G, ⇧⌘G, Escape, duplicate, paste) is built from.
 */

type Piece = { id: string; z: number; groups?: string[] };

const piece = (id: string, z: number, groups?: string[]): Piece => (groups ? { id, z, groups } : { id, z });

/** a, b in group G; c, d in group H inside G; e loose. */
function slide(): Piece[] {
  return [
    piece('a', 0, ['G']),
    piece('b', 1, ['G']),
    piece('c', 2, ['G', 'H']),
    piece('d', 3, ['G', 'H']),
    piece('e', 4),
  ];
}

describe('what a click picks', () => {
  it('takes the outermost group at the top level, and a loose object alone', () => {
    const elements = slide();
    expect(unitIds(elements, elements[2], null)).toEqual(['a', 'b', 'c', 'd']);
    expect(unitIds(elements, elements[4], null)).toEqual(['e']);
  });

  it('goes one level down inside a group', () => {
    const elements = slide();
    expect(unitIds(elements, elements[0], 'G')).toEqual(['a']);
    expect(unitIds(elements, elements[3], 'G')).toEqual(['c', 'd']);
    expect(unitIds(elements, elements[3], 'H')).toEqual(['d']);
  });

  it('reads which group the author is in off the selection', () => {
    const elements = slide();
    expect(selectionContext(elements, new Set())).toBeNull();
    expect(selectionContext(elements, new Set(['a', 'b', 'c', 'd']))).toBeNull();
    expect(selectionContext(elements, new Set(['a']))).toBe('G');
    expect(selectionContext(elements, new Set(['c', 'd']))).toBe('G');
    expect(selectionContext(elements, new Set(['c']))).toBe('H');
    expect(selectionContext(elements, new Set(['a', 'e']))).toBeNull();
  });

  it('names the groups selected whole, outermost only', () => {
    const elements = slide();
    expect(selectedGroups(elements, new Set(['a', 'b', 'c', 'd', 'e']))).toEqual(['G']);
    expect(selectedGroups(elements, new Set(['c', 'd']))).toEqual(['H']);
    expect(selectedGroups(elements, new Set(['a', 'c']))).toEqual([]);
  });

  it('lists a group one level down, its own groups as single entries', () => {
    expect(groupChildren(slide(), 'G')).toEqual([
      { kind: 'element', id: 'a' },
      { kind: 'element', id: 'b' },
      { kind: 'group', id: 'H', memberIds: ['c', 'd'] },
    ]);
  });
});

describe('grouping and ungrouping', () => {
  it('groups loose objects into one run of the paint order at the topmost', () => {
    const elements = [piece('x', 0), piece('y', 1), piece('z', 2)];
    expect(groupSelection(elements, new Set(['x', 'z']), 'N')).toBe(true);
    expect(elements.map((element) => element.groups)).toEqual([['N'], undefined, ['N']]);
    const order = [...elements].sort((a, b) => a.z - b.z).map((element) => element.id);
    expect(order).toEqual(['y', 'x', 'z']);
  });

  it('leaves the paint order alone when the pieces are already adjacent', () => {
    const elements = [piece('x', 5), piece('y', 7), piece('z', 9)];
    groupSelection(elements, new Set(['y', 'z']), 'N');
    expect(elements.map((element) => element.z)).toEqual([5, 7, 9]);
  });

  it('nests a group made inside a group, and groups a group with an object', () => {
    const inside = slide();
    groupSelection(inside, new Set(['a', 'b']), 'N');
    expect(inside[0].groups).toEqual(['G', 'N']);
    expect(inside[2].groups).toEqual(['G', 'H']);

    const outside = slide();
    groupSelection(outside, new Set(['a', 'b', 'c', 'd', 'e']), 'N');
    expect(outside.map((element) => element.groups)).toEqual([
      ['N', 'G'], ['N', 'G'], ['N', 'G', 'H'], ['N', 'G', 'H'], ['N'],
    ]);
  });

  it('refuses a single object and a selection that is already one group', () => {
    expect(groupSelection(slide(), new Set(['e']), 'N')).toBe(false);
    expect(groupSelection(slide(), new Set(['a', 'b', 'c', 'd']), 'N')).toBe(false);
  });

  it('ungroups one level, keeping the groups inside', () => {
    const elements = slide();
    expect(ungroupSelection(elements, new Set(['a', 'b', 'c', 'd']))).toEqual(['G']);
    expect(elements.map((element) => element.groups)).toEqual([undefined, undefined, ['H'], ['H'], undefined]);
  });

  it('dissolves a group left with one piece, and one that only wraps another', () => {
    const lone = slide().filter((element) => element.id !== 'b' && element.id !== 'a');
    pruneGroups(lone);
    // G now holds only H, so G goes and H stands on its own.
    expect(lone.map((element) => element.groups)).toEqual([['H'], ['H'], undefined]);
    const single = [piece('a', 0, ['G']), piece('e', 1)];
    pruneGroups(single);
    expect(single[0].groups).toBeUndefined();
  });
});

describe('copies of grouped objects', () => {
  let next = 0;
  const fresh = () => `new${++next}`;

  it('gives a group copied whole a group of its own', () => {
    next = 0;
    const sources = slide();
    const copies = sources.filter((element) => ['c', 'd'].includes(element.id))
      .map((element) => ({ ...element, id: `${element.id}2`, groups: [...element.groups!] }));
    remapCopiedGroups(copies, sources, fresh, true);
    expect(copies.map((copy) => copy.groups)).toEqual([['G', 'new1'], ['G', 'new1']]);
  });

  it('drops a partly copied group from a paste', () => {
    next = 0;
    const sources = slide();
    const copies = [{ ...sources[0], id: 'a2', groups: ['G'] }];
    remapCopiedGroups(copies, sources, fresh, false);
    expect(copies[0].groups).toBeUndefined();
  });
});
