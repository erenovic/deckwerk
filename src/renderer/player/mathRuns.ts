/**
 * Maths that the editor split across formatting runs.
 *
 * KaTeX's auto-render finds `$…$` and `$$…$$` within one text node at a time.
 * Editing leaves formatting runs behind (a `<span style="letter-spacing: 0">`
 * around part of a line, say), and a formula whose opening `$` is in one run
 * and closing `$` in another was never recognised: the slide showed its raw
 * source and nothing said why. Styling inside a formula has no effect on what
 * KaTeX draws anyway, so before rendering, each formula that crosses runs
 * within one paragraph is gathered back into a single text node.
 *
 * Run this after escaped dollars (`\$`) have been masked, as render.ts does,
 * so a literal dollar is never taken for a delimiter.
 */

const BLOCKS = new Set([
  'P', 'DIV', 'LI', 'UL', 'OL', 'TD', 'TH', 'TR', 'TABLE', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6',
  'BLOCKQUOTE', 'PRE',
]);

function blockOf(node: Node, root: Node): Node {
  for (let at = node.parentNode; at && at !== root; at = at.parentNode) {
    if (at.nodeType === 1 && BLOCKS.has((at as Element).tagName)) return at;
  }
  return root;
}

/** The next `$` (or `$$`) at or after `from` that a backslash does not escape. */
function nextDelimiter(text: string, needle: '$' | '$$', from: number): number {
  for (let at = text.indexOf(needle, from); at !== -1; at = text.indexOf(needle, at + 1)) {
    let slashes = 0;
    for (let back = at - 1; back >= 0 && text[back] === '\\'; back--) slashes += 1;
    if (slashes % 2 === 0) return at;
  }
  return -1;
}

/**
 * `[start, end)` of each formula in `text`, display maths first as auto-render
 * does. A `\$` is a written dollar sign, never a delimiter, so this reads the
 * editor's raw source as well as the renderer's (which masks them first).
 */
export function mathRanges(text: string): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  let at = 0;
  while (at < text.length) {
    const open = nextDelimiter(text, '$', at);
    if (open === -1) break;
    const display = text.startsWith('$$', open);
    const close = nextDelimiter(text, display ? '$$' : '$', open + (display ? 2 : 1));
    if (close === -1) break;
    const end = close + (display ? 2 : 1);
    ranges.push([open, end]);
    at = end;
  }
  return ranges;
}

/** Remove an emptied text node and any inline wrapper it leaves empty. */
function prune(node: Node, root: Node): void {
  let current: Node | null = node;
  while (current && current !== root && current.parentNode) {
    const parent: Node = current.parentNode;
    parent.removeChild(current);
    if (parent === root || parent.nodeType !== 1 || BLOCKS.has((parent as Element).tagName)) return;
    if (parent.childNodes.length > 0) return;
    current = parent;
  }
}

export function joinMathAcrossRuns(root: HTMLElement): void {
  const groups = new Map<Node, Text[]>();
  const walker = (root.ownerDocument ?? document).createTreeWalker(root, 4 /* SHOW_TEXT */);
  for (let node = walker.nextNode() as Text | null; node; node = walker.nextNode() as Text | null) {
    const block = blockOf(node, root);
    const group = groups.get(block);
    if (group) group.push(node);
    else groups.set(block, [node]);
  }
  for (const nodes of groups.values()) {
    if (nodes.length < 2) continue;
    const starts: number[] = [];
    let text = '';
    for (const node of nodes) {
      starts.push(text.length);
      text += node.data;
    }
    if (!text.includes('$')) continue;
    const nodeAt = (offset: number): number => {
      let index = 0;
      while (index + 1 < nodes.length && starts[index + 1] <= offset) index += 1;
      return index;
    };
    // Last formula first, so the offsets of earlier ones still hold.
    for (const [start, end] of mathRanges(text).reverse()) {
      const first = nodeAt(start);
      const last = nodeAt(end - 1);
      if (first === last) continue;
      const head = nodes[first];
      const tail = nodes[last];
      const before = head.data.slice(0, start - starts[first]);
      const after = tail.data.slice(end - starts[last]);
      head.data = before + text.slice(start, end);
      tail.data = after;
      for (let index = first + 1; index < last; index++) {
        nodes[index].data = '';
        prune(nodes[index], root);
      }
      if (!after) prune(tail, root);
    }
  }
}

/** Does the rendered text still hold a `$` that no formula claimed? */
export function hasUnclosedMath(root: HTMLElement): boolean {
  const walker = (root.ownerDocument ?? document).createTreeWalker(root, 4 /* SHOW_TEXT */);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (!(node as Text).data.includes('$')) continue;
    if (node.parentElement?.closest('.katex, .katex-error')) continue;
    return true;
  }
  return false;
}
