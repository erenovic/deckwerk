import katex from 'katex';
import type { SlideElement } from '@shared/deck.js';
import type { EditorStore } from './store.js';

/**
 * Problems on the slide in view, at the foot of the right sidebar.
 *
 * Two kinds of broken equation come out of KaTeX differently: a formula it
 * cannot parse at all (an unclosed brace) becomes a `.katex-error`, while an
 * unknown command (`\frakk`) is drawn in red inside an otherwise normal
 * formula with no error mark at all. So every rendered formula is checked
 * again, strictly, from the TeX source it carries; KaTeX's own message names
 * the problem.
 *
 * An equation that cannot render used to show its raw source on the slide
 * with nothing saying why. KaTeX marks a formula it cannot parse
 * (`.katex-error`, its message in `title`) and the renderer marks a box whose
 * `$` never closed (`data-math-unclosed`, see mathRuns.ts); this lists each,
 * in plain words, and selects the box on click. The box being edited is left
 * out: it shows its source on purpose.
 */

export interface SlideWarning {
  elementId: string;
  /** Which box: its role, else its kind. */
  box: string;
  message: string;
  /** The formula as written, when there is one to show. */
  source: string | null;
}

/** KaTeX's error, minus its class name and the underline marks it adds. */
export function cleanKatexMessage(raw: string): string {
  return raw
    .replace(/^ParseError:\s*/, '')
    .replace(/^KaTeX parse error:\s*/, '')
    .replace(/̲/g, '')
    // The formula is shown beside the message; its echo of the source is noise.
    .replace(/ at position (\d+): [\s\S]*$/, ' (at character $1)')
    .trim();
}

function boxName(element: SlideElement | undefined): string {
  if (!element || element.type !== 'text') return 'Text box';
  const slot = element.layoutPlaceholder;
  if (slot) {
    const kind = slot.replace(/-\d+$/, '');
    const number = /-(\d+)$/.exec(slot)?.[1];
    const name = kind.charAt(0).toUpperCase() + kind.slice(1);
    return number ? `${name} ${number}` : name;
  }
  if (element.class.includes('role-title')) return 'Title';
  if (element.class.includes('role-body')) return 'Body';
  if (element.class.includes('role-caption')) return 'Caption';
  return element.table ? 'Table' : 'Text box';
}

/** KaTeX's complaint about a formula when read strictly, or null when it reads cleanly. */
function strictKatexProblem(source: string, displayMode: boolean): string | null {
  try {
    katex.renderToString(source, { throwOnError: true, strict: 'ignore', displayMode });
    return null;
  } catch (error) {
    return cleanKatexMessage(error instanceof Error ? error.message : String(error));
  }
}

/** The equation problems in a rendered slide layer. */
export function slideWarnings(
  slideLayer: ParentNode,
  elements: readonly SlideElement[],
  skipElementId: string | null,
): SlideWarning[] {
  const warnings: SlideWarning[] = [];
  for (const node of slideLayer.querySelectorAll<HTMLElement>('[data-element-id]')) {
    const elementId = node.dataset.elementId!;
    if (elementId === skipElementId) continue;
    const box = boxName(elements.find((element) => element.id === elementId));
    for (const formula of node.querySelectorAll<HTMLElement>('.katex')) {
      const source = formula.querySelector('annotation[encoding="application/x-tex"]')?.textContent;
      if (!source) continue;
      const problem = strictKatexProblem(source, Boolean(formula.closest('.katex-display')));
      if (problem) {
        warnings.push({ elementId, box, message: `This equation has a LaTeX error: ${problem}`, source });
      }
    }
    for (const error of node.querySelectorAll<HTMLElement>('.katex-error')) {
      warnings.push({
        elementId,
        box,
        message: `This equation has a LaTeX error: ${cleanKatexMessage(error.title || 'it could not be read')}`,
        source: error.textContent,
      });
    }
    if (node.querySelector('.text-content[data-math-unclosed]')) {
      warnings.push({
        elementId,
        box,
        message: 'An equation starts with $ but never closes. Add the closing $, or write \\$ for a dollar sign.',
        source: null,
      });
    }
  }
  return warnings;
}

export class SlideWarnings {
  readonly element: HTMLElement;
  private queued = false;
  private shownKey = '';

  constructor(
    host: HTMLElement,
    private readonly store: EditorStore,
    private readonly canvasHost: HTMLElement,
    private readonly editingElementId: () => string | null,
  ) {
    this.element = document.createElement('section');
    this.element.className = 'slide-warnings deck-only';
    this.element.setAttribute('role', 'status');
    this.element.setAttribute('aria-live', 'polite');
    this.element.hidden = true;
    host.appendChild(this.element);
    store.subscribe(() => this.queue());
    this.queue();
  }

  /** Read the slide after the canvas has drawn it. */
  private queue(): void {
    if (this.queued) return;
    this.queued = true;
    requestAnimationFrame(() => {
      this.queued = false;
      this.refresh();
    });
  }

  refresh(): void {
    const layer = this.canvasHost.querySelector('.slide-layer');
    const warnings = layer
      ? slideWarnings(layer, this.store.slide?.elements ?? [], this.editingElementId())
      : [];
    const key = JSON.stringify(warnings);
    if (key === this.shownKey) return;
    this.shownKey = key;
    this.element.hidden = warnings.length === 0;
    if (warnings.length === 0) {
      this.element.replaceChildren();
      return;
    }
    const heading = document.createElement('header');
    heading.textContent = warnings.length === 1
      ? '1 equation on this slide can’t render'
      : `${warnings.length} equations on this slide can’t render`;
    const list = document.createElement('div');
    list.className = 'slide-warning-list';
    for (const warning of warnings) {
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'slide-warning';
      row.title = 'Select this text box';
      const box = document.createElement('strong');
      box.textContent = warning.box;
      const message = document.createElement('span');
      message.textContent = warning.message;
      row.append(box, message);
      if (warning.source) {
        const source = document.createElement('code');
        source.textContent = warning.source;
        row.appendChild(source);
      }
      row.addEventListener('click', () => this.store.select([warning.elementId]));
      list.appendChild(row);
    }
    this.element.replaceChildren(heading, list);
  }
}
