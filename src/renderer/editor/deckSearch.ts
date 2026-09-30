import type { Deck, SlideElement } from '@shared/deck.js';

/**
 * Find across the deck: the words on every slide (text boxes, tables and
 * HTML regions) and every slide's speaker notes.
 *
 * A match is found in the deck model, so slides that are not on screen are
 * searched too, and highlighted in the rendered DOM once its slide is shown.
 * Both sides read text through `collectText`, which walks text nodes and puts
 * a line break between blocks (paragraphs, list items, table cells). Using one
 * walk for both is what makes "the second match in this box" name the same
 * words in the model and on the canvas; the break keeps a query from matching
 * across two cells or two paragraphs.
 */

export type SearchSource = 'element' | 'notes';

export interface SearchMatch {
  slideIndex: number;
  slideId: string;
  source: SearchSource;
  /** The element holding the match; absent for notes. */
  elementId?: string;
  /** Which occurrence in that element (or note) this is, from 0. */
  occurrence: number;
}

const BLOCKS = new Set([
  'ADDRESS', 'ARTICLE', 'ASIDE', 'BLOCKQUOTE', 'BR', 'DD', 'DIV', 'DL', 'DT', 'FIGCAPTION',
  'FIGURE', 'FOOTER', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'HEADER', 'HR', 'LI', 'OL', 'P',
  'PRE', 'SECTION', 'TABLE', 'TD', 'TH', 'TR', 'UL',
]);

/** Subtrees whose text is never read as words: code, and KaTeX's hidden MathML twin. */
const SKIPPED = 'style, script, template, .katex-mathml';

interface TextRun {
  node: Text;
  /** Offset of this node's first character in the collected string. */
  start: number;
}

export interface CollectedText {
  text: string;
  runs: TextRun[];
}

function blockOf(node: Node, root: Node): Node {
  for (let at = node.parentNode; at && at !== root; at = at.parentNode) {
    if (at.nodeType === 1 && BLOCKS.has((at as Element).tagName)) return at;
  }
  return root;
}

/** The searchable text of a DOM subtree, with where each text node sits in it. */
export function collectText(root: Node): CollectedText {
  const runs: TextRun[] = [];
  let text = '';
  let lastBlock: Node | null = null;
  const doc = root.ownerDocument ?? (root as Document);
  const walker = doc.createTreeWalker(root, 4 /* NodeFilter.SHOW_TEXT */, {
    acceptNode: (node) => (node.parentElement?.closest(SKIPPED) ? 2 /* REJECT */ : 1 /* ACCEPT */),
  });
  for (let node = walker.nextNode() as Text | null; node; node = walker.nextNode() as Text | null) {
    const block = blockOf(node, root);
    if (lastBlock !== null && block !== lastBlock && !text.endsWith('\n')) text += '\n';
    lastBlock = block;
    runs.push({ node, start: text.length });
    text += node.data;
  }
  return { text, runs };
}

/** Start offsets of every case-insensitive occurrence of `query` in `text`. */
export function occurrences(text: string, query: string): number[] {
  const needle = query.toLowerCase();
  if (!needle) return [];
  const haystack = text.toLowerCase();
  const found: number[] = [];
  for (let at = haystack.indexOf(needle); at !== -1; at = haystack.indexOf(needle, at + needle.length)) {
    found.push(at);
  }
  return found;
}

function elementText(element: SlideElement): string | null {
  if (element.type !== 'text' && element.type !== 'html') return null;
  if (!element.html) return null;
  const template = document.createElement('template');
  template.innerHTML = element.html;
  return collectText(template.content).text;
}

/** Every match in the deck, in reading order: slide by slide, objects then notes. */
export function searchDeck(deck: Deck, query: string): SearchMatch[] {
  if (!query.trim()) return [];
  const matches: SearchMatch[] = [];
  deck.slides.forEach((slide, slideIndex) => {
    for (const element of slide.elements) {
      const text = elementText(element);
      if (text === null) continue;
      occurrences(text, query).forEach((_, occurrence) => {
        matches.push({ slideIndex, slideId: slide.id, source: 'element', elementId: element.id, occurrence });
      });
    }
    occurrences(slide.notes ?? '', query).forEach((_, occurrence) => {
      matches.push({ slideIndex, slideId: slide.id, source: 'notes', occurrence });
    });
  });
  return matches;
}

/** DOM ranges for every occurrence of `query` under `root`, in order. */
export function rangesIn(root: Node, query: string): Range[] {
  const { text, runs } = collectText(root);
  const doc = root.ownerDocument ?? (root as Document);
  const locate = (offset: number, end: boolean): { node: Text; offset: number } | null => {
    // A match ending exactly where a node ends belongs to that node, not the next.
    for (let i = runs.length - 1; i >= 0; i--) {
      const run = runs[i];
      if (end ? run.start < offset : run.start <= offset) {
        const local = offset - run.start;
        if (local <= run.node.data.length) return { node: run.node, offset: local };
        return null;
      }
    }
    return null;
  };
  const ranges: Range[] = [];
  for (const start of occurrences(text, query)) {
    const from = locate(start, false);
    const to = locate(start + query.length, true);
    if (!from || !to) continue;
    const range = doc.createRange();
    range.setStart(from.node, from.offset);
    range.setEnd(to.node, to.offset);
    ranges.push(range);
  }
  return ranges;
}

/** Stable identity of a match, to keep the current one across a re-search. */
export function matchKey(match: SearchMatch): string {
  return `${match.slideId}|${match.source}|${match.elementId ?? ''}|${match.occurrence}`;
}
