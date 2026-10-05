/**
 * Show or hide the slide list (left) and the sidebar (right), for a plain
 * view of the slide or a narrow window such as half a screen in Split View.
 *
 * Two small buttons sit in the canvas's bottom corners beside the speaker
 * notes and zoom controls; View › Show Slide List / Show Sidebar (⌥⌘1, ⌥⌘2)
 * do the same. Each choice is remembered for the next window.
 */

export type EditorPanel = 'rail' | 'side';

const STORAGE_KEY = 'deckwerk.editor.panels';

const LABELS: Record<EditorPanel, string> = { rail: 'slide list', side: 'sidebar' };

const ICONS: Record<EditorPanel, string> = {
  rail: '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.4">'
    + '<rect x="1.5" y="2.5" width="13" height="11" rx="1.5"/><path d="M6 2.5v11"/></svg>',
  side: '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.4">'
    + '<rect x="1.5" y="2.5" width="13" height="11" rx="1.5"/><path d="M10 2.5v11"/></svg>',
};

function readStored(): Record<EditorPanel, boolean> {
  try {
    const stored = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? '{}') as Partial<Record<EditorPanel, boolean>>;
    return { rail: stored.rail !== false, side: stored.side !== false };
  } catch {
    return { rail: true, side: true };
  }
}

export class PanelToggles {
  private shown = readStored();
  private readonly buttons = new Map<EditorPanel, HTMLButtonElement>();
  /** Told whenever a panel is shown or hidden, so the View menu can follow. */
  onChange: ((shown: Record<EditorPanel, boolean>) => void) | null = null;

  constructor(private readonly body: HTMLElement, canvasHost: HTMLElement) {
    for (const panel of ['rail', 'side'] as const) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `panel-toggle panel-toggle-${panel} deck-only`;
      button.dataset.panel = panel;
      button.innerHTML = ICONS[panel];
      button.addEventListener('click', () => this.toggle(panel));
      canvasHost.appendChild(button);
      this.buttons.set(panel, button);
    }

    this.apply();
  }

  isShown(panel: EditorPanel): boolean {
    return this.shown[panel];
  }

  state(): Record<EditorPanel, boolean> {
    return { ...this.shown };
  }

  toggle(panel: EditorPanel): void {
    this.set(panel, !this.shown[panel]);
  }

  set(panel: EditorPanel, shown: boolean): void {
    if (this.shown[panel] === shown) return;
    this.shown = { ...this.shown, [panel]: shown };
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(this.shown));
    } catch {
      // Remembering is a convenience; the toggle itself still works.
    }

    this.apply();
    this.onChange?.(this.state());
  }

  private apply(): void {
    for (const panel of ['rail', 'side'] as const) {
      const shown = this.shown[panel];
      this.body.classList.toggle(`${panel}-collapsed`, !shown);
      const button = this.buttons.get(panel)!;
      const label = `${shown ? 'Hide' : 'Show'} ${LABELS[panel]}`;
      button.title = `${label} (${panel === 'rail' ? '⌥⌘1' : '⌥⌘2'})`;
      button.setAttribute('aria-label', label);
      button.setAttribute('aria-pressed', String(!shown));
    }
  }
}
