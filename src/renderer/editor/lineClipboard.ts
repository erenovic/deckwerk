/**
 * Whole-line cut, copy and paste, as code editors do it.
 *
 * With nothing selected, Cmd/Ctrl+X and +C act on the line the caret is on —
 * its paragraph or list item — and Cmd/Ctrl+V of a line copied that way puts
 * it back as a whole line above the caret's, rather than splicing its text
 * into the middle of a sentence. A copied list item travels with its list's
 * kind and its sub-items; pasted among paragraphs it brings its list along,
 * and a paragraph pasted into a list becomes an item of it.
 *
 * The clipboard's HTML carries `data-deckwerk-line` on its root, which is
 * how a paste knows the copy was a whole line. Plain text gets the line and a
 * newline, so pasting elsewhere gives one line.
 */

export const LINE_CLIPBOARD_ATTRIBUTE = 'data-deckwerk-line';

const LINE_BLOCKS = 'li, p, div, h1, h2, h3, h4, h5, h6, blockquote, pre';
const LISTS = /^(?:UL|OL)$/;

/**
 * The line `node` (the caret's container) is on, or null where whole-line
 * editing does not apply: a table cell, or text not inside any block.
 */
export function lineAt(body: HTMLElement, node: Node | null): HTMLElement | null {
  const at = node instanceof Element ? node : node?.parentElement ?? null;
  if (!at || !body.contains(at) || at.closest('td, th')) return null;
  // A paragraph inside a list item is part of that item's line.
  const item = at.closest<HTMLElement>('li');
  if (item && body.contains(item)) return item;
  const line = at.closest<HTMLElement>(LINE_BLOCKS);
  return line && line !== body && body.contains(line) ? line : null;
}

/**
 * The clipboard payload for one line. `authored` turns a root holding the
 * line into the markup the deck stores (editor-only chrome removed).
 */
export function linePayload(
  line: HTMLElement,
  authored: (root: HTMLElement) => string,
): { html: string; text: string } {
  const doc = line.ownerDocument ?? document;
  const holder = doc.createElement('div');
  let root: HTMLElement;
  const list = line.parentElement;
  if (line.tagName === 'LI' && list && LISTS.test(list.tagName)) {
    // An item keeps its list's kind (and a numbered list's start) with it.
    root = doc.createElement(list.tagName.toLowerCase());
    for (const attr of [...list.attributes]) root.setAttribute(attr.name, attr.value);
    root.appendChild(line.cloneNode(true));
  } else {
    root = line.cloneNode(true) as HTMLElement;
  }
  root.setAttribute(LINE_CLIPBOARD_ATTRIBUTE, '');
  holder.appendChild(root);
  const text = (line.innerText ?? line.textContent ?? '')
    .replace(/[⁠​]/g, '')
    .replace(/\n+$/, '');
  return { html: authored(holder), text: `${text}\n` };
}

/**
 * Take a line out of the box whole. Returns the line the caret should go to
 * — the one after, else the one before — or null when the box is now empty.
 */
export function removeLine(line: HTMLElement): HTMLElement | null {
  const list = line.tagName === 'LI' ? line.parentElement : null;
  const next = (line.nextElementSibling ?? null) as HTMLElement | null;
  const previous = (line.previousElementSibling ?? null) as HTMLElement | null;
  line.remove();
  if (list && LISTS.test(list.tagName) && list.children.length === 0) {
    // The list held only this item: the line was the list.
    const after = (list.nextElementSibling ?? null) as HTMLElement | null;
    const before = (list.previousElementSibling ?? null) as HTMLElement | null;
    list.remove();
    return after ?? before;
  }
  return next ?? previous ?? (list && LISTS.test(list.tagName) ? list : null);
}

/** The root of a whole-line copy in clipboard HTML, or null for any other copy. */
export function copiedLine(html: string): HTMLElement | null {
  if (!html.includes(LINE_CLIPBOARD_ATTRIBUTE)) return null;
  const template = document.createElement('template');
  template.innerHTML = html;
  const root = template.content.querySelector<HTMLElement>(`[${LINE_CLIPBOARD_ATTRIBUTE}]`);
  root?.removeAttribute(LINE_CLIPBOARD_ATTRIBUTE);
  return root;
}

/** A block's content as a list item, keeping its inline markup. */
function asItem(block: HTMLElement): HTMLElement {
  if (block.tagName === 'LI') return block;
  const item = (block.ownerDocument ?? document).createElement('li');
  item.append(...block.childNodes);
  return item;
}

/**
 * Put a copied line in above `line` (or at the top of the box when there is
 * no line), fitted to where it lands: items into a list, a list among
 * paragraphs, a paragraph into a list as an item. Returns what was inserted.
 */
export function insertLineAbove(body: HTMLElement, line: HTMLElement | null, copied: HTMLElement): Node[] {
  const items = LISTS.test(copied.tagName)
    ? [...copied.children].filter((child): child is HTMLElement => child.tagName === 'LI')
    : null;
  if (line?.tagName === 'LI' && line.parentElement) {
    const nodes = items ?? [asItem(copied)];
    for (const node of nodes) line.parentElement.insertBefore(node, line);
    return nodes;
  }
  const parent = line?.parentElement ?? body;
  parent.insertBefore(copied, line ?? body.firstChild);
  // A list pasted right after a list of the same kind is more of that list.
  const before = copied.previousElementSibling;
  if (items && before?.tagName === copied.tagName) {
    const moved = [...copied.children];
    before.append(...moved);
    copied.remove();
    return moved;
  }
  return [copied];
}
