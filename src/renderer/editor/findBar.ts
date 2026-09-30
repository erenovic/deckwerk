import { matchKey, rangesIn, searchDeck, type SearchMatch } from './deckSearch.js';
import type { SpeakerNotesDrawer } from './speakerNotesDrawer.js';
import type { EditorStore } from './store.js';

/**
 * Cmd/Ctrl+F: find words across every slide and the speaker notes.
 *
 * A small bar floats in the canvas's top-right corner, styled like the zoom
 * pill. It is deliberately not modal: the editor's shortcuts stay live while
 * it is open, and the slide it lands on is ordinary, editable content.
 * Enter and Shift+Enter step through matches in deck order, selecting the
 * slide (and the object holding the match); a match in the notes opens the
 * notes drawer on its rendered preview. Every match on the slide in view is
 * highlighted with the CSS Custom Highlight API, which paints ranges without
 * touching the slide's DOM, so nothing here can leave the canvas stale.
 */

const HIGHLIGHT_ALL = 'deck-find';
const HIGHLIGHT_CURRENT = 'deck-find-current';

export interface FindBarOptions {
  /** The notes drawer, when this host has one, for matches in the notes. */
  notes?: SpeakerNotesDrawer;
}

export class FindBar {
  readonly element: HTMLElement;
  readonly input: HTMLInputElement;
  private readonly count: HTMLElement;
  private readonly prevButton: HTMLButtonElement;
  private readonly nextButton: HTMLButtonElement;
  private matches: SearchMatch[] = [];
  private current = -1;
  private open = false;
  private refreshQueued = false;
  /** Deck object the matches were computed from, so selection changes skip the search. */
  private searchedDeck: unknown = null;
  private searchedQuery = '';

  constructor(
    private readonly host: HTMLElement,
    private readonly store: EditorStore,
    private readonly options: FindBarOptions = {},
  ) {
    this.element = document.createElement('div');
    this.element.className = 'find-bar deck-only';
    this.element.setAttribute('role', 'search');
    this.element.hidden = true;

    this.input = document.createElement('input');
    this.input.type = 'text';
    this.input.className = 'find-input';
    this.input.placeholder = 'Find in slides and notes';
    this.input.spellcheck = false;
    this.input.setAttribute('aria-label', 'Find in slides and notes');
    this.input.addEventListener('input', () => this.search(true));
    this.input.addEventListener('keydown', (event) => {
      // Typing here is for the query: keep the window's slide and object
      // shortcuts (Backspace deletes, arrows move) from acting on the deck.
      const mod = event.metaKey || event.ctrlKey;
      if (!(mod && ['z', 'f'].includes(event.key.toLowerCase()))) event.stopPropagation();
      if (event.key === 'Enter') {
        event.preventDefault();
        this.step(event.shiftKey ? -1 : 1);
      } else if (event.key === 'Escape') {
        event.preventDefault();
        this.close();
      } else if (mod && event.key.toLowerCase() === 'g') {
        event.preventDefault();
        this.step(event.shiftKey ? -1 : 1);
      }
    });

    this.count = document.createElement('span');
    this.count.className = 'find-count';
    this.count.setAttribute('aria-live', 'polite');

    this.prevButton = this.button('find-prev', 'Previous match (Shift+Enter)', 'M4 10l4-4 4 4', () => this.step(-1));
    this.nextButton = this.button('find-next', 'Next match (Enter)', 'M4 6l4 4 4-4', () => this.step(1));
    const close = this.button('find-close', 'Close (Escape)', 'M4.5 4.5l7 7M11.5 4.5l-7 7', () => this.close());

    this.element.append(this.input, this.count, this.prevButton, this.nextButton, close);
    host.append(this.element);

    store.subscribe(() => {
      if (this.open) this.queueRefresh();
    });
    this.renderCount();
  }

  isOpen(): boolean {
    return this.open;
  }

  /** Show the bar with the query selected, ready to type over. */
  show(): void {
    if (!this.open) {
      this.open = true;
      this.element.hidden = false;
      this.host.classList.add('find-open');
      this.search(false);
    }
    this.input.focus();
    this.input.select();
  }

  close(): void {
    if (!this.open) return;
    this.open = false;
    this.element.hidden = true;
    this.host.classList.remove('find-open');
    this.clearHighlights();
    if (this.element.contains(document.activeElement)) (document.activeElement as HTMLElement).blur();
  }

  /** The matches for the current query, in deck order (for tests and tools). */
  results(): readonly SearchMatch[] {
    return this.matches;
  }

  currentIndex(): number {
    return this.current;
  }

  private button(className: string, title: string, path: string, action: () => void): HTMLButtonElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `find-button ${className}`;
    button.title = title;
    button.setAttribute('aria-label', title);
    button.innerHTML = '<svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true" fill="none"'
      + ` stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="${path}"/></svg>`;
    // Keep focus in the query so Enter keeps stepping after a click.
    button.addEventListener('pointerdown', (event) => event.preventDefault());
    button.addEventListener('click', action);
    return button;
  }

  /**
   * Re-run the query. On new input the first match at or after the slide in
   * view becomes current, so searching never throws the author back to the
   * start of the deck; otherwise the current match is kept by identity.
   */
  private search(fromInput: boolean): void {
    const deck = this.store.get().deck;
    const query = this.input.value;
    const previous = this.matches[this.current];
    this.matches = searchDeck(deck, query);
    this.searchedDeck = deck;
    this.searchedQuery = query;
    if (this.matches.length === 0) {
      this.current = -1;
    } else if (fromInput || !previous) {
      const here = this.store.get().slideIndex;
      const at = this.matches.findIndex((match) => match.slideIndex >= here);
      this.current = at === -1 ? 0 : at;
      if (fromInput) this.reveal();
    } else {
      const key = matchKey(previous);
      const kept = this.matches.findIndex((match) => matchKey(match) === key);
      this.current = kept === -1 ? Math.min(this.current, this.matches.length - 1) : kept;
    }
    this.renderCount();
    this.paintHighlights();
  }

  private step(delta: number): void {
    if (this.searchedQuery !== this.input.value || this.searchedDeck !== this.store.get().deck) {
      this.search(false);
    }
    if (this.matches.length === 0) return;
    this.current = (this.current + delta + this.matches.length) % this.matches.length;
    this.renderCount();
    this.reveal();
  }

  /** Go to the current match: its slide, its object or the notes, then paint. */
  private reveal(): void {
    const match = this.matches[this.current];
    if (!match) return;
    const { slideIndex, selection } = this.store.get();
    if (slideIndex !== match.slideIndex) this.store.selectSlide(match.slideIndex);
    if (match.source === 'element' && match.elementId) {
      if (!(selection.size === 1 && selection.has(match.elementId))) this.store.select([match.elementId]);
    } else if (match.source === 'notes' && this.options.notes) {
      // The preview is what can be highlighted without taking focus from the query.
      this.options.notes.setMode('preview');
      this.options.notes.show();
    }
    this.queueRefresh();
  }

  /** Coalesce store changes and wait for the canvas to draw the slide before painting. */
  private queueRefresh(): void {
    if (this.refreshQueued) return;
    this.refreshQueued = true;
    requestAnimationFrame(() => requestAnimationFrame(() => {
      this.refreshQueued = false;
      if (!this.open) return;
      if (this.searchedDeck !== this.store.get().deck) this.search(false);
      else this.paintHighlights();
    }));
  }

  private renderCount(): void {
    const has = this.matches.length > 0;
    this.count.textContent = !this.input.value.trim()
      ? ''
      : has ? `${this.current + 1} of ${this.matches.length}` : 'No results';
    this.count.classList.toggle('find-count-empty', this.input.value.trim() !== '' && !has);
    this.prevButton.disabled = !has;
    this.nextButton.disabled = !has;
  }

  private clearHighlights(): void {
    if (typeof CSS === 'undefined' || !('highlights' in CSS)) return;
    CSS.highlights.delete(HIGHLIGHT_ALL);
    CSS.highlights.delete(HIGHLIGHT_CURRENT);
  }

  /** Highlight every match on the slide in view, and the current one apart. */
  private paintHighlights(): void {
    if (typeof CSS === 'undefined' || !('highlights' in CSS) || typeof Highlight === 'undefined') return;
    const query = this.input.value;
    const slideIndex = this.store.get().slideIndex;
    const currentMatch = this.matches[this.current];
    const all: Range[] = [];
    let currentRange: Range | null = null;
    const roots = new Map<string, Node>();
    for (const match of this.matches) {
      if (match.slideIndex !== slideIndex) continue;
      const key = match.source === 'notes' ? 'notes' : match.elementId!;
      if (!roots.has(key)) {
        const root = this.rootFor(match);
        if (!root) continue;
        roots.set(key, root);
      }
    }
    for (const [key, root] of roots) {
      const ranges = rangesIn(root, query);
      all.push(...ranges);
      const isCurrent = currentMatch && currentMatch.slideIndex === slideIndex
        && (currentMatch.source === 'notes' ? key === 'notes' : key === currentMatch.elementId);
      if (isCurrent) currentRange = ranges[currentMatch.occurrence] ?? null;
    }
    CSS.highlights.set(HIGHLIGHT_ALL, new Highlight(...all));
    if (currentRange) {
      CSS.highlights.set(HIGHLIGHT_CURRENT, new Highlight(currentRange));
      if (currentMatch?.source === 'notes') {
        currentRange.startContainer.parentElement?.scrollIntoView({ block: 'nearest' });
      }
    } else {
      CSS.highlights.delete(HIGHLIGHT_CURRENT);
    }
  }

  private rootFor(match: SearchMatch): Node | null {
    if (match.source === 'notes') {
      const notes = this.options.notes;
      return notes?.isOpen() && notes.getMode() === 'preview' ? notes.preview : null;
    }
    const node = this.host.querySelector<HTMLElement>(
      `.slide-layer [data-element-id="${CSS.escape(match.elementId!)}"]`,
    );
    return node?.querySelector('.text-content') ?? node;
  }
}
