import {
  LIST_MARKER_COLOR_ATTRIBUTE,
  LIST_MARKER_COLOR_PROPERTY,
} from '@shared/paragraphs.js';

/**
 * Taking the bullet off one paragraph of a list.
 *
 * Keynote treats the marker as a property of a single paragraph: un-bulleting
 * a paragraph in the middle of a list leaves the items above and below it as
 * lists and puts a plain paragraph between them. That one operation is behind
 * the List dropdown's "None", Return on an empty bullet, and Backspace at the
 * start of an item — the three ways an author asks to stop being in a list.
 *
 * DOM-in, DOM-out on purpose: the live contenteditable surface is the thing
 * being edited, and the caret has to survive the surgery.
 */

const LIST_TAGS = /^(?:UL|OL)$/;

/** Is this element a list item of a list that is a paragraph of `content`? */
export function isTopLevelListItem(content: HTMLElement, item: HTMLElement): boolean {
  const list = item.parentElement;
  return item.tagName === 'LI' && Boolean(list)
    && LIST_TAGS.test(list!.tagName) && list!.parentElement === content;
}

/** A paragraph carrying an item's own attributes, minus list-only paint. */
function paragraphFrom(source: HTMLElement): HTMLElement {
  const doc = source.ownerDocument ?? document;
  const paragraph = doc.createElement('p');
  for (const attr of [...source.attributes]) {
    if (attr.name !== LIST_MARKER_COLOR_ATTRIBUTE) paragraph.setAttribute(attr.name, attr.value);
  }
  paragraph.style.removeProperty(LIST_MARKER_COLOR_PROPERTY);
  paragraph.style.removeProperty('list-style-type');
  if (!paragraph.getAttribute('style')?.trim()) paragraph.removeAttribute('style');
  return paragraph;
}

/**
 * Every paragraph one list item's content becomes, in document order.
 *
 * A sub-list or a block written inside the item (Google Docs and Word both do
 * this) becomes its own paragraph exactly where it was, rather than being
 * appended after the item it was nested in. An empty item stays one empty
 * paragraph — that is the case the caret lands in most often.
 */
export function listItemParagraphs(item: HTMLElement): HTMLElement[] {
  const doc = item.ownerDocument ?? document;
  const out: HTMLElement[] = [];
  let current = paragraphFrom(item);
  const flush = () => {
    if (current.childNodes.length > 0) out.push(current);
    current = paragraphFrom(item);
  };
  for (const node of [...item.childNodes]) {
    if (node instanceof HTMLElement && LIST_TAGS.test(node.tagName)) {
      flush();
      for (const nested of [...node.children] as HTMLElement[]) {
        if (nested.tagName === 'LI') out.push(...listItemParagraphs(nested));
      }
      continue;
    }
    if (node instanceof HTMLElement && node.tagName === 'LI') {
      // Chromium's Return inside an item that holds a sub-list can leave an
      // item nested straight inside an item. It is a paragraph of its own,
      // exactly like a sub-list's items — never a paragraph's content.
      flush();
      out.push(...listItemParagraphs(node));
      continue;
    }
    if (node instanceof HTMLElement && /^(?:P|DIV|H[1-6])$/.test(node.tagName)) {
      flush();
      const paragraph = paragraphFrom(node);
      while (node.firstChild) paragraph.appendChild(node.firstChild);
      out.push(paragraph);
      continue;
    }
    current.appendChild(node);
  }
  flush();
  if (out.length === 0) {
    const empty = paragraphFrom(item);
    empty.appendChild(doc.createElement('br'));
    out.push(empty);
  }
  return out;
}

/**
 * Turn one whole list into plain paragraphs, in place.
 *
 * Sub-lists, blocks written inside an item, and the malformed shapes
 * contenteditable leaves behind all become paragraphs exactly where they
 * stood, so nothing is reordered and nothing is dropped.
 */
export function flattenListToParagraphs(list: HTMLElement): HTMLElement[] {
  const doc = list.ownerDocument ?? document;
  const fragment = doc.createDocumentFragment();
  const paragraphs: HTMLElement[] = [];
  const take = (item: HTMLElement) => {
    for (const paragraph of listItemParagraphs(item)) {
      fragment.appendChild(paragraph);
      paragraphs.push(paragraph);
    }
  };
  for (const child of [...list.children] as HTMLElement[]) {
    if (child.tagName === 'LI') {
      take(child);
      continue;
    }
    // A sub-list Chromium wrote as a sibling of the items rather than inside
    // one of them. Its items are paragraphs too, where they stand.
    if (LIST_TAGS.test(child.tagName)) {
      for (const nested of [...child.children] as HTMLElement[]) {
        if (nested.tagName === 'LI') take(nested);
      }
    }
  }
  list.replaceWith(fragment);
  return paragraphs;
}

/**
 * Replace the given list items with plain paragraphs where they stand,
 * splitting each list around them, and return the paragraphs in document
 * order.
 *
 * Numbering runs through the whole original list: un-bulleting the second of
 * four numbered items leaves 1., the paragraph, then 2. and 3. — the gap does
 * not restart the count, which is what Keynote does and what makes a
 * mid-list edit look local.
 */
export function unbulletListItems(items: HTMLElement[]): HTMLElement[] {
  const groups = new Map<HTMLElement, Set<HTMLElement>>();
  for (const item of items) {
    const list = item.parentElement;
    if (!list || !LIST_TAGS.test(list.tagName)) continue;
    const group = groups.get(list) ?? new Set<HTMLElement>();
    group.add(item);
    groups.set(list, group);
  }
  const inserted: HTMLElement[] = [];
  for (const [list, group] of groups) {
    const doc = list.ownerDocument ?? document;
    const ordered = list.tagName === 'OL';
    const declared = Number.parseInt(list.getAttribute('start') ?? '1', 10);
    let number = Number.isFinite(declared) && declared > 0 ? declared : 1;
    const fragment = doc.createDocumentFragment();
    let chunk: HTMLElement | null = null;
    const newChunk = (): HTMLElement => {
      const next = doc.createElement(list.tagName.toLowerCase());
      for (const attr of [...list.attributes]) {
        if (attr.name === 'start') continue;
        next.setAttribute(attr.name, attr.value);
      }
      if (ordered && number > 1) next.setAttribute('start', String(number));
      fragment.appendChild(next);
      return next;
    };
    for (const child of [...list.childNodes]) {
      const el = child instanceof HTMLElement ? child : null;
      if (el && group.has(el)) {
        // The next kept item starts a new list after the gap.
        chunk = null;
        for (const paragraph of listItemParagraphs(el)) {
          fragment.appendChild(paragraph);
          inserted.push(paragraph);
        }
        continue;
      }
      if (el?.tagName === 'LI') {
        if (!chunk) chunk = newChunk();
        chunk.appendChild(el);
        number += 1;
        continue;
      }
      if (el && LIST_TAGS.test(el.tagName)) {
        // A sub-list Chromium wrote as a sibling of a list's items belongs to
        // the item before it. That item keeps it — unless the item was the one
        // being freed, in which case its sub-items are freed with it.
        if (chunk) {
          chunk.appendChild(el);
        } else {
          for (const nested of [...el.children] as HTMLElement[]) {
            if (nested.tagName !== 'LI') continue;
            for (const paragraph of listItemParagraphs(nested)) {
              fragment.appendChild(paragraph);
              inserted.push(paragraph);
            }
          }
          el.remove();
        }
        continue;
      }
      // Anything else inside a list is stray markup (whitespace, usually).
      // Keep it with the run it was written in, or drop it with the gap.
      if (chunk) chunk.appendChild(child);
    }
    list.replaceWith(fragment);
  }
  return inserted;
}

/**
 * Is the caret before this block's first character?
 *
 * Measured as text, so a caret sitting after an empty inline wrapper — the
 * span a pending style run leaves, a stray `<b></b>` from a paste — still
 * counts as the start of the block.
 */
export function caretAtBlockStart(block: HTMLElement, range: Range): boolean {
  if (!block.contains(range.startContainer)) return false;
  const before = range.cloneRange();
  before.selectNodeContents(block);
  before.setEnd(range.startContainer, range.startOffset);
  return before.toString().replace(/[\u200b\u2060]/g, '').length === 0;
}

/**
 * Lift an item out of the item that wrongly contains it.
 *
 * Chromium's Return inside an item that holds a sub-list can leave an item
 * nested straight inside another item. Moving that node up one level is what
 * outdenting it means, and moving the node itself keeps the caret in it —
 * `execCommand('outdent')` from this shape drops the text out of the list
 * altogether, leaving a bare line at the top of the box.
 */
export function liftItemOutOfItem(item: HTMLElement): boolean {
  const host = item.parentElement;
  if (!host || host.tagName !== 'LI') return false;
  const list = host.parentElement;
  if (!list || !LIST_TAGS.test(list.tagName)) return false;
  host.after(item);
  return true;
}

/**
 * Move an indented item out one level, the way shift-Tab means it.
 *
 * Two shapes hold an indented item: the saved one, where the sub-list sits
 * inside the parent item (`li > ul > li`), and the one Chromium's indent
 * command writes while editing, where the sub-list is a *sibling* of its item
 * (`ul > ul > li`). `execCommand('outdent')` handles only the second; from
 * the saved shape it leaves the item inside the parent item (`li > li`),
 * which still paints indented, so the key appeared to do nothing.
 *
 * The item lands directly after the item (or list) that held it. Items that
 * followed it at the deeper level stay deeper: they become its own sub-list,
 * so the list reads the same order as before with one item promoted.
 * Moving the node itself keeps the caret in it.
 */
export function outdentListItem(item: HTMLElement): boolean {
  if (item.tagName !== 'LI') return false;
  const list = item.parentElement;
  if (!list || !LIST_TAGS.test(list.tagName)) return false;
  const host = list.parentElement;
  if (!host || !(host.tagName === 'LI' || LIST_TAGS.test(host.tagName))) return false;
  const following: Element[] = [];
  for (let next = item.nextElementSibling; next; next = next.nextElementSibling) {
    following.push(next);
  }
  if (following.length > 0) {
    const carry = list.cloneNode(false) as HTMLElement;
    carry.removeAttribute('start');
    carry.append(...following);
    item.append(carry);
  }
  if (host.tagName === 'LI') host.after(item);
  else list.after(item);
  if (list.childElementCount === 0) list.remove();
  return true;
}

/** Does this item hold no text and no media — an empty bullet? */
export function isEmptyListItem(item: HTMLElement): boolean {
  if (item.querySelector('img, video, svg, embed, li')) return false;
  // `\u2060` is the sentinel a pending collapsed-caret style run leaves
  // behind; it is not typed text, so a run holding only it is still empty.
  return (item.textContent ?? '').replace(/[\s\u00a0\u200b\u2060]+/g, '') === '';
}

/**
 * Merge a paragraph into the last item of the list directly above it, and
 * report where the caret belongs — the junction between the two texts.
 *
 * This is what Backspace at the start of a paragraph that follows a list
 * means: the line joins the bullet above it. Chromium's own merge drops the
 * text outside the list at the top level of the box, where it is not a
 * paragraph anything can be aligned, spaced or bulleted.
 */
export function mergeParagraphIntoList(
  paragraph: HTMLElement,
): { node: Node; offset: number } | null {
  const list = paragraph.previousElementSibling;
  if (!list || !LIST_TAGS.test(list.tagName)) return null;
  let target: HTMLElement | null = null;
  for (const child of [...list.children] as HTMLElement[]) {
    if (child.tagName === 'LI') target = child;
  }
  if (!target) return null;
  // The line above is the last item of the deepest sub-list, not the outer
  // item that contains it.
  for (;;) {
    const nested = [...target.children].reverse()
      .find((child) => LIST_TAGS.test(child.tagName)) as HTMLElement | undefined;
    const deeper = nested
      ? [...nested.children].reverse().find((child) => child.tagName === 'LI') as HTMLElement | undefined
      : undefined;
    if (!deeper) break;
    target = deeper;
  }
  // A trailing `<br>` is how an empty item holds its line open; it must not
  // survive between the two texts.
  const trailing = target.lastChild;
  if (trailing instanceof HTMLElement && trailing.tagName === 'BR') trailing.remove();
  const moved = [...paragraph.childNodes]
    .filter((node) => !(node instanceof HTMLElement && node.tagName === 'BR'));
  const at = target.lastChild;
  const caret = at instanceof Text
    ? { node: at as Node, offset: at.data.length }
    : { node: target as Node, offset: target.childNodes.length };
  for (const node of moved) target.appendChild(node);
  const following = paragraph.nextElementSibling;
  paragraph.remove();
  // The paragraph was the only thing keeping the two halves apart, and a list
  // beside a list of the same kind is one list.
  if (following?.tagName === list.tagName) {
    while (following.firstChild) list.appendChild(following.firstChild);
    following.remove();
  }
  return caret;
}

/**
 * Move an item in one level, the way Tab means it.
 *
 * The item hangs under the item before it: into that item's own sub-list
 * (created if it has none), or into the sub-list Chromium's indent left as
 * the item's *sibling*. A sub-list that followed the item in that sibling
 * shape belongs to it and moves with it, one level deeper and still beside
 * it. The first item of a list has nothing to hang under; it is wrapped in a
 * sub-list of its own, the shape Chromium writes for the same gesture, which
 * normalisation repairs on the way to the deck.
 *
 * This replaces `execCommand('indent')`, whose handling of a *selection* was
 * Chromium's own: two items at different levels indented together came back
 * with an empty first-level bullet between them. Moving the nodes ourselves
 * keeps the caret and the selection in the items they were in.
 */
export function indentListItem(item: HTMLElement): boolean {
  if (item.tagName !== 'LI') return false;
  const list = item.parentElement;
  if (!list || !LIST_TAGS.test(list.tagName)) return false;
  const doc = item.ownerDocument ?? document;
  const trailing = item.nextElementSibling;
  const carried = trailing && LIST_TAGS.test(trailing.tagName) ? trailing : null;
  const newList = (): HTMLElement => {
    const created = doc.createElement(list.tagName.toLowerCase());
    for (const attr of [...list.attributes]) {
      if (attr.name !== 'start') created.setAttribute(attr.name, attr.value);
    }
    return created;
  };
  const previous = item.previousElementSibling;
  let target: HTMLElement;
  if (!previous) {
    target = newList();
    list.insertBefore(target, item);
  } else if (LIST_TAGS.test(previous.tagName)) {
    target = previous as HTMLElement;
  } else if (previous.tagName === 'LI') {
    const own = [...previous.children].reverse()
      .find((child) => LIST_TAGS.test(child.tagName)) as HTMLElement | undefined;
    target = own ?? newList();
    if (!own) previous.appendChild(target);
  } else {
    return false;
  }
  target.appendChild(item);
  if (carried) target.appendChild(carried);
  return true;
}

/**
 * The item this item hangs under, in either shape an indented item takes:
 * the saved one (`li > ul > li`, the parent item) and the one Chromium's
 * indent writes while editing (`li, ul > li`, the item before the sub-list).
 * Null for an item of the outermost list.
 */
export function parentListItem(item: HTMLElement): HTMLElement | null {
  const list = item.parentElement;
  if (!list || !LIST_TAGS.test(list.tagName)) return null;
  const host = list.parentElement;
  if (host?.tagName === 'LI') return host;
  const before = list.previousElementSibling;
  return before?.tagName === 'LI' ? before as HTMLElement : null;
}

/**
 * Switching one level of a list between bullets and numbers.
 *
 * A list's kind belongs to each level on its own: numbered steps can hold
 * bulleted details and a bulleted list can hold numbered steps. The List
 * control, the typed `1.` / `-` marker and Cmd+Shift+7/8 all act on the
 * levels the caret or selection is actually in, and never reach into the
 * sub-lists of those levels.
 */

/** Is this text node part of `item`'s own line, rather than one of its sub-lists? */
function isOwnText(node: Node, item: HTMLElement): boolean {
  return node.parentElement?.closest('li') === item;
}

/**
 * The lists whose own items the caret or selection is in, outermost first.
 *
 * An item counts when the caret is on its own line, or when the selection
 * covers any of its own text. Its sub-items do not make it count: selecting
 * only the details under a step leaves the steps' level alone. An empty item
 * (a placeholder `<br>`) counts when the selection spans it.
 */
export function listsAtSelection(content: HTMLElement, range: Range, collapsed = range.collapsed): HTMLElement[] {
  const items = new Set<HTMLElement>();
  if (collapsed) {
    const at = range.startContainer instanceof Element ? range.startContainer : range.startContainer.parentElement;
    const item = at?.closest<HTMLElement>('li');
    if (item && content.contains(item)) items.add(item);
  } else {
    for (const item of content.querySelectorAll<HTMLElement>('li')) {
      const doc = item.ownerDocument ?? document;
      const walker = doc.createTreeWalker(item, NodeFilter.SHOW_TEXT);
      let ownText = false;
      let touched = false;
      for (let node = walker.nextNode(); node && !touched; node = walker.nextNode()) {
        if (!isOwnText(node, item)) continue;
        ownText = true;
        try {
          touched = range.intersectsNode(node) && (node as Text).data.length > 0;
        } catch {
          touched = false;
        }
      }
      if (!touched && !ownText) {
        try {
          touched = range.intersectsNode(item);
        } catch {
          touched = false;
        }
      }
      if (touched) items.add(item);
    }
  }
  const lists: HTMLElement[] = [];
  for (const item of items) {
    const list = item.parentElement;
    if (list && LIST_TAGS.test(list.tagName) && !lists.includes(list)) lists.push(list);
  }
  // Document order puts an outer list before the lists nested in it.
  return lists.sort((a, b) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1));
}

/**
 * Give one list the other tag, keeping its items, attributes and sub-lists
 * exactly as they are. A numbered list's `start` has no meaning on bullets
 * and is dropped. Returns the list now in the document.
 */
export function retagList(list: HTMLElement, ordered: boolean): HTMLElement {
  const tag = ordered ? 'OL' : 'UL';
  if (list.tagName === tag) return list;
  const doc = list.ownerDocument ?? document;
  const replacement = doc.createElement(tag.toLowerCase());
  for (const attr of [...list.attributes]) {
    if (!ordered && attr.name === 'start') continue;
    replacement.setAttribute(attr.name, attr.value);
  }
  while (list.firstChild) replacement.appendChild(list.firstChild);
  list.replaceWith(replacement);
  return replacement;
}

/** A `1.`, `1)`, `-` or `*` typed as the whole of a list item's own line. */
export interface TypedLevelMarker {
  item: HTMLElement;
  ordered: boolean;
  /** The number typed, for a numbered list that starts somewhere else. */
  start: string | null;
}

/**
 * Typing `1.` or `-` (then a space) into an otherwise empty item asks for that
 * level to be numbered or bulleted. Only a marker of the *other* kind counts:
 * `- ` in a bulleted item is just text the author is writing.
 *
 * `ownLine` is the item's own text with the caret at its end, as the caller
 * read it (editor-only characters already stripped).
 */
export function typedLevelMarker(item: HTMLElement, ownLine: string): TypedLevelMarker | null {
  const list = item.parentElement;
  if (!list || !LIST_TAGS.test(list.tagName)) return null;
  const match = /^\s*(?:[*-]|(\d+)[.)])$/.exec(ownLine);
  if (!match) return null;
  const ordered = match[1] !== undefined;
  if ((list.tagName === 'OL') === ordered) return null;
  return { item, ordered, start: match[1] ?? null };
}

/**
 * Switch the item's level to the kind its typed marker asked for and take the
 * marker's characters off the item's own line. `keep` decides which characters
 * are not the marker's (an editor-only sentinel holding a pending style).
 */
export function applyTypedLevelMarker(
  marker: TypedLevelMarker,
  markerLength: number,
  keep: (character: string) => boolean = () => false,
): HTMLElement {
  const { item, ordered, start } = marker;
  const doc = item.ownerDocument ?? document;
  let remaining = markerLength;
  const walker = doc.createTreeWalker(item, NodeFilter.SHOW_TEXT);
  const texts: Text[] = [];
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (isOwnText(node, item)) texts.push(node as Text);
  }
  for (const text of texts) {
    if (remaining <= 0) break;
    let kept = '';
    for (const character of text.data) {
      if (keep(character) || remaining <= 0) kept += character;
      else remaining -= 1;
    }
    text.data = kept;
  }
  const list = retagList(item.parentElement as HTMLElement, ordered);
  // A typed `3.` on the first item starts the numbering there, as it does
  // when a paragraph becomes a list.
  if (ordered && start && start !== '1' && list.firstElementChild === item) list.setAttribute('start', start);
  return list;
}

/** A measured font size, as opposed to one relative to its surroundings. */
const ABSOLUTE_FONT_SIZE = /^\d*\.?\d+(?:px|pt)$/;

/** The nearest measured font size declared between `node` and `stop` (exclusive). */
function measuredSizeBelow(node: Node, stop: HTMLElement): HTMLElement | null {
  for (let at = node.parentElement; at && at !== stop; at = at.parentElement) {
    if (ABSOLUTE_FONT_SIZE.test(at.style.fontSize)) return at;
  }
  return null;
}

/**
 * Give a list item the size its text was set to, so its marker follows.
 *
 * Bullets and numbers are drawn by the item itself and sized in `em` of the
 * item, while a size set on selected text lands on runs inside it: the text
 * grew and the marker stayed small. When every character of an item's own
 * line carries one measured size, that size moves onto the item and off the
 * runs — the text looks the same and the marker (and the hanging indent it
 * sets) now matches it. An item is left alone when its line mixes sizes, when
 * a size is proportional only, or when a sub-list under it inherits its size
 * from it and would change with it.
 */
export function hoistListItemFontSizes(content: HTMLElement): void {
  // Deepest first: a nested item settles its own size before its parent asks
  // whether the sub-list depends on the parent's.
  const items = [...content.querySelectorAll<HTMLElement>('li')].reverse();
  for (const item of items) {
    const doc = item.ownerDocument ?? document;
    const walker = doc.createTreeWalker(item, NodeFilter.SHOW_TEXT);
    const own: Text[] = [];
    const nested: Text[] = [];
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const text = node as Text;
      if (!text.data.replace(/[\s⁠​]/g, '')) continue;
      if (text.parentElement?.closest('li') === item) own.push(text);
      else nested.push(text);
    }
    if (own.length === 0) continue;
    const holders = own.map((text) => measuredSizeBelow(text, item));
    if (holders.some((holder) => holder === null)) continue;
    const size = holders[0]!.style.fontSize;
    if (holders.some((holder) => holder!.style.fontSize !== size)) continue;
    if (holders.some((holder) => holder!.querySelector('ul, ol'))) continue;
    if (item.style.fontSize !== size && nested.some((text) => measuredSizeBelow(text, item) === null)) continue;
    item.style.fontSize = size;
    for (const holder of new Set(holders)) {
      holder!.style.removeProperty('font-size');
      if (!holder!.getAttribute('style')?.trim()) holder!.removeAttribute('style');
    }
  }
}
