import type { Deck } from '@shared/deck.js';
import type { PresentationCommand, PresentationState } from '@shared/ipc.js';
import { renderNotesMarkdown } from '@shared/notesMarkdown.js';
import { resolveState } from '@shared/timeline.js';
import { revealImagesWhenDecoded } from '../player/imageDecode.js';
import { freezePreviewVideos, releasePreviewVideos } from '../player/previewPoster.js';
import { applyStageScale, renderPageNumber, renderSlide, rewriteCssAssetUrls } from '../player/render.js';
import { applyStaticSlideState } from '../player/staticState.js';
import { makePanelResizable } from '../editor/panelResize.js';
import { formatElapsed, formatWallClock, presentationLabel } from './model.js';

/**
 * Speaker View: current and next slide, speaker notes, build position, presentation and slide
 * timers, wall clock, and the presenter's controls.
 *
 * One component, two shells. The desktop opens it in its own Electron window
 * on the presenter's display and talks to the audience window over IPC; the
 * browser opens it in a second tab and talks to the audience tab over the
 * presentation bus. Everything above the transport — markup, previews, clocks,
 * key map — lives here so a control added for one client is never missing from
 * the other.
 */

export interface SpeakerViewOptions {
  host: HTMLElement;
  resolveSrc: (src: string) => string;
  onCommand: (command: PresentationCommand) => void;
  /**
   * Whether to offer the audience/presenter role swap. The desktop moves its
   * two windows between displays; the browser cannot place windows, so it
   * swaps the roles of the two surfaces in place instead. A shell with only
   * one surface passes false and the control is absent rather than inert.
   */
  canSwapDisplays?: boolean;
  /** Label for the swap control, which differs between window and tab shells. */
  swapLabel?: string;
  swapTitle?: string;
  /** Injectable clock, so timer formatting is testable without waiting. */
  now?: () => number;
}

export interface SpeakerView {
  setDeck(deck: Deck | null): void;
  setTheme(css: string): void;
  setState(state: PresentationState): void;
  /** Re-scale the previews; call on resize. */
  refresh(): void;
  /** Advance the clocks. Called on a timer internally; exposed for tests. */
  tick(): void;
  destroy(): void;
}

const MARKUP = `
  <section class="speaker-layout">
    <div class="preview-panel current-panel">
      <div class="panel-heading"><h2>Current slide</h2><div class="speaker-position">Slide 1</div></div>
      <div class="speaker-current preview"></div>
    </div>
    <aside class="speaker-sidebar">
      <div class="preview-panel next-panel">
        <h2>Next slide</h2>
        <div class="speaker-next preview"></div>
      </div>
      <section class="timers" aria-label="Presentation timing">
        <div class="speaker-size speaker-timers-size" role="group" aria-label="Timer text size">
          <button type="button" class="speaker-timers-smaller" aria-label="Smaller timers" title="Smaller timers">A−</button>
          <button type="button" class="speaker-timers-larger" aria-label="Larger timers" title="Larger timers">A+</button>
        </div>
        <div class="presenter-clock presentation-clock"><span>Presentation elapsed</span><strong class="speaker-presentation-timer">00:00</strong></div>
        <div class="presenter-clock slide-clock"><span>Current slide</span><strong class="speaker-slide-timer">00:00</strong></div>
        <div class="presenter-clock wall-clock"><span>Local time</span><strong class="speaker-wall-clock">--:--</strong></div>
      </section>
      <section class="notes-panel" aria-label="Speaker notes">
        <div class="panel-heading">
          <h2>Notes</h2>
          <div class="speaker-size speaker-notes-size" role="group" aria-label="Notes text size">
            <button type="button" class="speaker-notes-smaller" aria-label="Smaller notes text" title="Smaller notes text">A−</button>
            <button type="button" class="speaker-notes-larger" aria-label="Larger notes text" title="Larger notes text">A+</button>
          </div>
        </div>
        <div class="speaker-notes"></div>
      </section>
    </aside>
  </section>
  <footer>
    <button class="speaker-prev">← Previous</button>
    <button class="speaker-blank">Blank</button>
    <button class="speaker-next-button primary">Next →</button>
    <button class="speaker-swap">Switch displays</button>
    <button class="speaker-end danger">End show</button>
  </footer>
`;

/** Notes text sizes, as multiples of the panel's default size. */
export const NOTES_SCALES = [0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1, 1.15, 1.3, 1.5, 1.75, 2, 2.5] as const;
/** Timer sizes, as multiples of their default size; the default is already large. */
export const TIMER_SCALES = [0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1, 1.15, 1.3, 1.5] as const;
const SIDEBAR_SIZE_KEY = 'deckwerk.presenter.sidebar';
const NOTES_SIZE_KEY = 'deckwerk.presenter.notes';

function readScale(key: string, scales: readonly number[]): number {
  try {
    const stored = Number(window.localStorage.getItem(key));
    return scales.includes(stored) ? stored : 1;
  } catch {
    return 1;
  }
}

function storeScale(key: string, scale: number): void {
  try {
    window.localStorage.setItem(key, String(scale));
  } catch {
    // Storage can be unavailable; the size still applies for this session.
  }
}

/**
 * An A-/A+ pair stepping `property` on `host` through `scales`. Sizes are the
 * presenter's own preference, so they live in this viewer's storage rather
 * than in the deck.
 */
function bindTextSize(
  host: HTMLElement,
  buttons: { smaller: HTMLButtonElement; larger: HTMLButtonElement },
  scales: readonly number[],
  config: { property: string; storageKey: string; noun: string },
): void {
  const { smaller, larger } = buttons;
  let scale = readScale(config.storageKey, scales);
  const apply = () => {
    host.style.setProperty(config.property, String(scale));
    const at = scales.indexOf(scale);
    smaller.disabled = at <= 0;
    larger.disabled = at >= scales.length - 1;
    const percent = `${Math.round(scale * 100)}%`;
    smaller.title = `Smaller ${config.noun} (${percent})`;
    larger.title = `Larger ${config.noun} (${percent})`;
  };
  const step = (delta: number) => {
    const next = scales[Math.min(Math.max(scales.indexOf(scale) + delta, 0), scales.length - 1)];
    if (next === scale) return;
    scale = next;
    storeScale(config.storageKey, scale);
    apply();
  };
  for (const button of [smaller, larger]) {
    // Space and Enter advance the talk; a focused button would take them.
    button.addEventListener('pointerdown', (event) => event.preventDefault());
  }
  smaller.addEventListener('click', () => step(-1));
  larger.addEventListener('click', () => step(1));
  apply();
}

export function createSpeakerView(options: SpeakerViewOptions): SpeakerView {
  const { host, resolveSrc, onCommand, now = () => Date.now() } = options;
  const openedAt = now();
  host.classList.add('speaker-view');
  host.innerHTML = MARKUP;

  const pick = <T extends HTMLElement>(selector: string): T => {
    const node = host.querySelector<T>(selector);
    if (!node) throw new Error(`speaker view: missing ${selector}`);
    return node;
  };

  const currentHost = pick('.speaker-current');
  const nextHost = pick('.speaker-next');
  const position = pick('.speaker-position');
  const presentationTimer = pick('.speaker-presentation-timer');
  const slideTimer = pick('.speaker-slide-timer');
  const wallClock = pick('.speaker-wall-clock');
  const notes = pick('.speaker-notes');
  const swap = pick<HTMLButtonElement>('.speaker-swap');
  const layout = pick('.speaker-layout');
  const sidebar = pick('.speaker-sidebar');
  const notesPanel = pick('.notes-panel');

  bindTextSize(host, {
    smaller: pick<HTMLButtonElement>('.speaker-notes-smaller'),
    larger: pick<HTMLButtonElement>('.speaker-notes-larger'),
  }, NOTES_SCALES, { property: '--speaker-notes-scale', storageKey: 'deckwerk.presenter.notes-scale', noun: 'notes text' });
  bindTextSize(host, {
    smaller: pick<HTMLButtonElement>('.speaker-timers-smaller'),
    larger: pick<HTMLButtonElement>('.speaker-timers-larger'),
  }, TIMER_SCALES, { property: '--speaker-timers-scale', storageKey: 'deckwerk.presenter.timers-scale', noun: 'timers' });

  // Drag the border between the current slide and the sidebar, and the one
  // above the notes. Before the window is laid out there is nothing to bound
  // the size by, so the limits wait for real dimensions.
  const bounded = (size: number, reserve: number) => (size > 0 ? size - reserve : Number.POSITIVE_INFINITY);
  const unbindSidebar = makePanelResizable(sidebar, {
    storageKey: SIDEBAR_SIZE_KEY,
    sizeTarget: host,
    width: {
      property: '--speaker-sidebar-width',
      // Close to the proportions the view had before it was resizable.
      initial: Math.round((window.innerWidth || 1470) * 0.3),
      min: 280,
      // Keep a usable current-slide preview, and its heading, beside it.
      max: () => bounded(layout.clientWidth, 420),
      edge: 'left',
    },
  });
  const unbindNotes = makePanelResizable(notesPanel, {
    storageKey: NOTES_SIZE_KEY,
    sizeTarget: host,
    height: {
      property: '--speaker-notes-height',
      initial: Math.round((window.innerHeight || 930) * 0.3),
      min: 90,
      // Leave the timers and a sliver of next-slide preview above it.
      max: () => bounded(sidebar.clientHeight, pick('.timers').offsetHeight + 100),
      edge: 'top',
    },
  });

  // A border drag resizes the previews without a new slide: re-fit the stages
  // already there instead of rebuilding them (and re-decoding their media).
  let refitQueued = false;
  const refit = () => {
    if (refitQueued) return;
    refitQueued = true;
    requestAnimationFrame(() => {
      refitQueued = false;
      if (!deck) return;
      for (const target of [currentHost, nextHost]) {
        const stage = target.querySelector<HTMLElement>(':scope > .stage');
        const bounds = target.getBoundingClientRect();
        if (stage && bounds.width > 0) applyStageScale(stage, deck, { w: bounds.width, h: bounds.height });
      }
    });
  };
  const previewObserver = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(refit);
  previewObserver?.observe(currentHost);
  previewObserver?.observe(nextHost);

  if (options.canSwapDisplays === false) {
    swap.remove();
  } else {
    if (options.swapLabel) swap.textContent = options.swapLabel;
    swap.title = options.swapTitle ?? 'Swap the audience and speaker displays';
  }

  let deck: Deck | null = null;
  let theme: HTMLStyleElement | null = null;
  let state: PresentationState = {
    cursor: { slide: 0, step: 0 },
    steps: 1,
    startedAt: openedAt,
    slideStartedAt: openedAt,
  };

  function preview(target: HTMLElement, slideIndex: number, step = 0): void {
    // Every advance throws this preview away and builds another. A video still
    // waiting for its poster frame is held by the module's global capture map,
    // which would keep the whole discarded subtree alive — one leaked stage per
    // step, for the length of the talk. Hand them back before dropping them.
    releasePreviewVideos(target);
    target.replaceChildren();
    const slide = deck?.slides[slideIndex];
    if (!slide) return;
    const stage = document.createElement('div');
    stage.className = 'stage';
    stage.appendChild(renderSlide(slide, { resolveSrc, mediaPreload: 'metadata', deferVideoSrc: true }));
    const pageNumber = deck ? renderPageNumber(deck, slideIndex) : null;
    if (pageNumber) stage.appendChild(pageNumber);
    target.appendChild(stage);
    applyStaticSlideState(stage, slide, resolveState(slide, step));
    const bounds = target.getBoundingClientRect();
    applyStageScale(stage, deck!, { w: bounds.width, h: bounds.height });
    for (const video of stage.querySelectorAll('video')) video.pause();
    // Large JPEGs otherwise paint their first decoded scanlines as a thin strip
    // before the complete bitmap is ready. Keep both current and next previews
    // atomic just like the audience Player.
    revealImagesWhenDecoded(stage);
    // Speaker View is a pair of still previews, not a playback surface. Capture
    // one decoded frame per source/in-point and reuse it across re-renders. In
    // particular, the next slide is warm before it becomes current, so moving
    // through a video-heavy deck never opens on an undecoded black frame.
    freezePreviewVideos(stage);
  }

  function render(): void {
    if (!deck) return;
    preview(currentHost, state.cursor.slide, state.cursor.step);
    const lastSlide = state.range?.end ?? deck.slides.length - 1;
    let nextSlide = state.cursor.slide + 1;
    while (nextSlide <= lastSlide && deck.slides[nextSlide]?.skipped) nextSlide += 1;
    preview(nextHost, nextSlide <= lastSlide ? nextSlide : -1);
    position.textContent = presentationLabel(state, deck.slides.length);
    const note = deck.slides[state.cursor.slide]?.notes ?? '';
    // Builds re-render the view on the same slide; keep the reader's scroll.
    if (notes.dataset.source !== note) {
      notes.dataset.source = note;
      notes.innerHTML = renderNotesMarkdown(note);
    }
  }

  function tick(): void {
    const stamp = now();
    presentationTimer.textContent = formatElapsed(stamp, state.startedAt);
    slideTimer.textContent = formatElapsed(stamp, state.slideStartedAt);
    wallClock.textContent = formatWallClock(new Date(stamp));
  }

  const send = (command: PresentationCommand) => () => onCommand(command);
  pick('.speaker-prev').addEventListener('click', send({ type: 'prev' }));
  pick('.speaker-next-button').addEventListener('click', send({ type: 'next' }));
  pick('.speaker-blank').addEventListener('click', send({ type: 'toggleBlank' }));
  pick('.speaker-end').addEventListener('click', send({ type: 'exit' }));
  if (swap.isConnected) swap.addEventListener('click', send({ type: 'swapDisplays' }));

  tick();
  const clock = setInterval(tick, 250);

  return {
    setDeck(next) {
      deck = next;
      render();
    },
    setTheme(css) {
      if (!theme) {
        theme = document.createElement('style');
        document.head.appendChild(theme);
      }
      theme.textContent = rewriteCssAssetUrls(css, resolveSrc);
    },
    setState(next) {
      state = next;
      render();
      tick();
    },
    refresh: render,
    tick,
    destroy() {
      clearInterval(clock);
      previewObserver?.disconnect();
      unbindSidebar();
      unbindNotes();
      host.style.removeProperty('--speaker-notes-scale');
      host.style.removeProperty('--speaker-timers-scale');
      host.style.removeProperty('--speaker-sidebar-width');
      host.style.removeProperty('--speaker-notes-height');
      theme?.remove();
      theme = null;
      host.replaceChildren();
      host.classList.remove('speaker-view');
    },
  };
}

/**
 * The presenter key map. Deliberately narrower than the audience player's: a
 * speaker surface only ever forwards commands, so it never needs the player's
 * overview or home keys.
 */
export function bindSpeakerKeys(
  target: Window | HTMLElement,
  onCommand: (command: PresentationCommand) => void,
): () => void {
  const onKey = (event: Event) => {
    const key = (event as KeyboardEvent).key;
    if (['ArrowRight', 'ArrowDown', ' ', 'PageDown', 'Enter'].includes(key)) {
      onCommand({ type: 'next' });
    } else if (['ArrowLeft', 'ArrowUp', 'PageUp', 'Backspace'].includes(key)) {
      onCommand({ type: 'prev' });
    } else if (key === 'b' || key === 'B') {
      onCommand({ type: 'toggleBlank' });
    } else if (key === 'Escape') {
      onCommand({ type: 'exit' });
    } else {
      return;
    }
    event.preventDefault();
  };
  target.addEventListener('keydown', onKey);
  return () => target.removeEventListener('keydown', onKey);
}
