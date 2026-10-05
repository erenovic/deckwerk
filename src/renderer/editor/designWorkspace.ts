import { type Slide, type SlideElement, type TextEl } from '@shared/deck.js';
import {
  defaultLayoutMasters,
  isBuiltInLayout,
  layoutChoices,
  resolveLayoutMaster,
  slotKind,
  type FixedLayout,
  type SlotKind,
} from '@shared/layoutMasters.js';
import { deckTheme, themeCss, type ThemePreset } from '@shared/themes.js';
import { renderSlide } from '../player/render.js';
import {
  applyThemeInline,
  previewSlide,
  revealPlaceholders,
} from './layoutPreview.js';
import { EditorCanvas } from './canvas.js';
import { colorField } from './colorPicker.js';
import { createShapeInsertPicker, insertText } from './elementCreation.js';
import { createToolbarPicker } from './exportPicker.js';
import { Inspector } from './inspector.js';
import {
  editingSlideId,
  installLayouts,
  isCustomEditingSlide,
  layoutEditingDeck,
  layoutIdOfEditingSlide,
  layoutUsage,
  layoutsFromEditingDeck,
  newLayoutSlide,
  nextSlot,
  placeholderFor,
  tileBodyPlaceholders,
  uniqueLayoutName,
} from './layoutEditorModel.js';
import { barButton, wireCanvasInspector } from './shellWiring.js';
import { EditorStore, copySelectionToClipboard, pasteFromClipboard } from './store.js';
import { openMenu, type MenuItem } from './ui.js';

export interface DesignWorkspaceDeps {
  canvasHost: HTMLElement;
  store: EditorStore;
  save: () => Promise<void> | void;
  setStatusMessage: (text: string) => void;
}

/**
 * Read-only theme preview plus the explicit editor for the three fixed masters.
 * Previewing owns no deck state: it renders clones under a temporary stylesheet.
 */
export class DesignWorkspace {
  private deps: DesignWorkspaceDeps;
  private preview: HTMLElement;
  private previewGrid: HTMLElement;
  private previewStyle: HTMLStyleElement;
  private theme: ThemePreset | null = null;
  private editingOverlay: HTMLElement | null = null;
  private closeLayoutEditor: ((save: boolean) => void) | null = null;
  private previewObservers: ResizeObserver[] = [];
  private layoutSummaryObserver: ResizeObserver | null = null;

  constructor(deps: DesignWorkspaceDeps) {
    this.deps = deps;
    this.preview = document.createElement('section');
    this.preview.className = 'design-preview-workspace';
    this.preview.hidden = true;
    const header = document.createElement('header');
    const copy = document.createElement('div');
    const eyebrow = document.createElement('span');
    eyebrow.textContent = 'Design preview';
    const title = document.createElement('h2');
    title.textContent = 'Theme × layouts';
    const note = document.createElement('p');
    note.textContent = 'Theme choices preview here without changing slide content.';
    copy.append(eyebrow, title, note);
    const edit = barButton('Edit layouts…', () => this.openLayoutEditor(
      (this.deps.store.slide?.layout ?? 'freeform') as FixedLayout,
    ));
    edit.classList.add('primary');
    header.append(copy, edit);
    this.previewGrid = document.createElement('div');
    this.previewGrid.className = 'design-preview-grid';
    this.preview.append(header, this.previewGrid);
    this.deps.canvasHost.appendChild(this.preview);

    this.previewStyle = document.createElement('style');
    this.previewStyle.dataset.designThemePreview = 'true';
    document.head.appendChild(this.previewStyle);
  }

  show(theme: ThemePreset | null): void {
    this.theme = theme;
    this.preview.hidden = false;
    this.deps.canvasHost.classList.add('design-preview-active');
    this.render();
  }

  hide(): void {
    if (this.editingOverlay) return;
    this.preview.hidden = true;
    this.deps.canvasHost.classList.remove('design-preview-active');
    this.previewStyle.textContent = '';
  }

  /** Leave the foremost design mode. Layout edits are cancelled on Escape. */
  escape(): 'layout' | 'theme' | null {
    if (this.closeLayoutEditor) {
      this.closeLayoutEditor(false);
      return 'layout';
    }
    if (this.preview.hidden) return null;
    this.hide();
    return 'theme';
  }

  setTheme(theme: ThemePreset | null): void {
    this.theme = theme;
    if (!this.preview.hidden || this.editingOverlay) this.render();
  }

  /**
   * The theme the master surfaces render under.
   *
   * The layout editor opens from places that never went through a preview
   * session — the sidebar summary, the inspector — so fall back to the deck's
   * chosen theme rather than showing masters in a voice the deck is not using.
   */
  private effectiveTheme(): ThemePreset | null {
    return this.theme ?? deckTheme(this.deps.store.get().deck);
  }

  /** The compact Title + Body master shown in the sidebar's Layouts section. */
  createLayoutSummary(theme: ThemePreset | null, onActivate: () => void): HTMLElement {
    this.layoutSummaryObserver?.disconnect();
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'theme-layout-summary';
    button.setAttribute('aria-label', 'Edit Title + Body layout');
    const frame = document.createElement('span');
    frame.className = 'design-preview-frame';
    const master = this.deps.store.get().deck.layoutMasters?.standard ?? defaultLayoutMasters().standard;
    const slide = previewSlide('standard', master);
    slide.elements = slide.elements.filter((element) => element.id !== 'preview-standard-caption');
    const active = theme ?? deckTheme(this.deps.store.get().deck);
    if (active) applyThemeInline(slide, active);
    frame.appendChild(renderSlide(slide, {
      resolveSrc: (src) => window.api.assetUrl(src),
      mediaPreload: 'metadata',
    }));
    const label = document.createElement('span');
    label.className = 'theme-layout-summary-label';
    label.innerHTML = '<strong>Title + Body</strong><small>Edit layout…</small>';
    button.append(frame, label);
    button.addEventListener('click', onActivate);
    const observer = new ResizeObserver(([entry]) => {
      frame.style.setProperty('--design-preview-scale', String(entry.contentRect.width / 1920));
    });
    observer.observe(frame);
    this.layoutSummaryObserver = observer;
    return button;
  }

  private render(): void {
    const theme = this.effectiveTheme();
    this.previewStyle.textContent = theme ? themeCss(theme) : '';
    if (this.preview.hidden) return;
    this.previewObservers.forEach((observer) => observer.disconnect());
    this.previewObservers = [];
    this.previewGrid.replaceChildren();
    const deck = this.deps.store.get().deck;
    for (const { id: layout, name, custom } of layoutChoices(deck)) {
      const master = resolveLayoutMaster(deck, layout);
      const item = document.createElement('button');
      item.type = 'button';
      item.className = `design-preview-item design-preview-${custom ? 'custom' : layout}`;
      item.setAttribute('aria-label', `Edit ${name} layout`);
      const frame = document.createElement('span');
      frame.className = 'design-preview-frame';
      const slide = previewSlide(layout, master, name);
      frame.appendChild(renderSlide(slide, {
        resolveSrc: (src) => window.api.assetUrl(src),
        mediaPreload: 'metadata',
      }));
      const observer = new ResizeObserver(([entry]) => {
        frame.style.setProperty('--design-preview-scale', String(entry.contentRect.width / 1920));
      });
      observer.observe(frame);
      this.previewObservers.push(observer);
      const label = document.createElement('span');
      label.className = 'design-preview-label';
      const placeholders = master.elements.filter((element) => (
        element.type === 'text' && element.layoutPlaceholder
      )).length;
      const title = document.createElement('strong');
      title.textContent = name;
      const detail = document.createElement('small');
      detail.textContent = `${custom ? 'Your layout · ' : ''}${placeholders === 0
        ? 'No placeholders'
        : `${placeholders} placeholder${placeholders === 1 ? '' : 's'}`}`;
      label.append(title, detail);
      item.append(frame, label);
      item.addEventListener('click', () => this.openLayoutEditor(layout));
      this.previewGrid.appendChild(item);
    }
  }

  /**
   * Show `slide` on the canvas in place of the real one, or clear the preview.
   *
   * Hover previews from the Props layout picker and the Design tab's Apply
   * render a dry-run clone inside the scaled stage, over the live slide and
   * under the selection overlay, so the author sees the result at the real
   * size without anything being committed. A banner names what is shown.
   */
  previewSlideOnCanvas(slide: Slide | null, label = ''): void {
    const stage = this.deps.canvasHost.querySelector<HTMLElement>(':scope > .stage');
    const existing = this.deps.canvasHost.querySelector<HTMLElement>('.design-slide-preview');
    const banner = this.deps.canvasHost.querySelector<HTMLElement>('.design-slide-preview-banner');
    existing?.remove();
    banner?.remove();
    this.deps.canvasHost.classList.toggle('design-slide-previewing', Boolean(slide));
    if (!slide || !stage) return;
    const layer = document.createElement('div');
    layer.className = 'design-slide-preview';
    const clone = structuredClone(slide);
    layer.appendChild(renderSlide(clone, {
      resolveSrc: (src) => window.api.assetUrl(src),
      mediaPreload: 'metadata',
    }));
    stage.appendChild(layer);
    const note = document.createElement('div');
    note.className = 'design-slide-preview-banner';
    note.textContent = label ? `Preview · ${label}` : 'Preview';
    this.deps.canvasHost.appendChild(note);
  }

  /**
   * Preview a theme draft: theme.css for `theme` is laid over the editor so
   * every box that follows the stylesheet shows the draft. Boxes carrying
   * their own values stay put, which is exactly what Done would do to them.
   */
  previewThemeDraft(theme: ThemePreset | null): void {
    this.previewStyle.textContent = theme ? themeCss(theme) : '';
    this.deps.canvasHost.classList.toggle('design-theme-previewing', Boolean(theme));
  }

  openLayoutEditor(initialLayout: string): void {
    if (this.editingOverlay) return;
    const sourceDeck = this.deps.store.get().deck;
    const { deck: masterDeck, meta } = layoutEditingDeck(sourceDeck);
    const usage = layoutUsage(sourceDeck);
    const masterStore = new EditorStore(masterDeck);
    const initialIndex = masterDeck.slides.findIndex((slide) => slide.id === editingSlideId(initialLayout));
    masterStore.selectSlide(Math.max(0, initialIndex));

    const overlay = document.createElement('div');
    overlay.className = 'layout-editor-overlay';
    const top = document.createElement('header');
    top.className = 'layout-editor-header';
    const heading = document.createElement('div');
    const kicker = document.createElement('span');
    kicker.textContent = 'Design';
    const title = document.createElement('strong');
    title.textContent = 'Editing layouts';
    heading.append(kicker, title);
    const tools = document.createElement('div');
    tools.className = 'layout-editor-tools';
    const placeholderPicker = createToolbarPicker('Placeholder', []);
    tools.append(
      barButton('Text', () => insertText(masterStore)),
      createShapeInsertPicker(masterStore),
      placeholderPicker,
      barButton('Duplicate', () => duplicateUnlocked(masterStore)),
      barButton('Delete', () => deleteUnlocked(masterStore)),
    );
    const actions = document.createElement('div');
    actions.className = 'layout-editor-actions';
    actions.append(
      barButton('Cancel', () => close(false)),
      barButton('Done', () => close(true), 'primary'),
    );
    top.append(heading, tools, actions);

    const body = document.createElement('div');
    body.className = 'layout-editor-body';
    const rail = document.createElement('aside');
    rail.className = 'layout-editor-rail';
    const canvasHost = document.createElement('main');
    canvasHost.className = 'layout-editor-canvas';
    const inspectorHost = document.createElement('aside');
    inspectorHost.className = 'layout-editor-inspector';
    const settingsHost = document.createElement('div');
    settingsHost.className = 'layout-settings';
    const inspectorInner = document.createElement('div');
    inspectorInner.className = 'layout-editor-inspector-inner';
    inspectorHost.append(settingsHost, inspectorInner);
    body.append(rail, canvasHost, inspectorHost);
    overlay.append(top, body);
    document.body.appendChild(overlay);
    this.editingOverlay = overlay;
    const overlayTheme = this.effectiveTheme();
    this.previewStyle.textContent = overlayTheme ? themeCss(overlayTheme) : '';

    const masterCanvas = new EditorCanvas(canvasHost, masterStore);
    const masterInspector = new Inspector(inspectorInner, masterStore);
    masterInspector.editsLayoutMasters = true;
    wireCanvasInspector(masterCanvas, masterInspector);
    masterInspector.onEditLayouts = (layout) => {
      const index = masterStore.get().deck.slides.findIndex((slide) => slide.id === editingSlideId(layout));
      if (index !== -1) masterStore.selectSlide(index);
    };

    const currentSlide = (): Slide => masterStore.get().deck.slides[masterStore.get().slideIndex];
    const isCustom = (): boolean => isCustomEditingSlide(currentSlide()?.id ?? '');

    /** A new layout of the deck's own, copied from the slide at `index`. */
    const addLayout = (index: number, name?: string): void => {
      const deck = masterStore.get().deck;
      const from = deck.slides[index];
      if (!from) return;
      const fromId = layoutIdOfEditingSlide(from.id);
      const basedOn: FixedLayout = isBuiltInLayout(fromId) ? fromId : meta.get(fromId)?.basedOn ?? 'standard';
      const { slide, layoutId } = newLayoutSlide(from, uniqueLayoutName(deck, name ?? `Copy of ${from.name}`));
      meta.set(layoutId, { basedOn, titleSlide: isBuiltInLayout(fromId) ? fromId === 'title' : meta.get(fromId)?.titleSlide ?? false });
      masterStore.commit((next) => { next.slides.push(slide); }, { label: 'Add layout' });
      masterStore.selectSlide(masterStore.get().deck.slides.length - 1);
    };
    const deleteLayout = (index: number): void => {
      const slide = masterStore.get().deck.slides[index];
      if (!slide || !isCustomEditingSlide(slide.id)) return;
      masterStore.commit((next) => { next.slides.splice(index, 1); }, { label: 'Delete layout' });
      masterStore.selectSlide(Math.min(index, masterStore.get().deck.slides.length - 1));
    };
    const renameLayout = (index: number, name: string): void => {
      const trimmed = name.trim();
      if (!trimmed) return;
      masterStore.commit((next) => { next.slides[index].name = trimmed; }, { label: 'Rename layout' });
    };
    const addPlaceholder = (kind: SlotKind): void => {
      const slide = currentSlide();
      if (!slide) return;
      const slot = nextSlot(slide.elements, kind);
      if (!slot) return;
      const z = Math.max(9, ...slide.elements.map((element) => element.z)) + 1;
      const element = placeholderFor(slot, masterStore.get().deck.canvas, z);
      masterStore.commit((next) => {
        const target = next.slides[masterStore.get().slideIndex];
        target.elements.push(element);
        // Another body makes columns: share the bodies' space side by side.
        if (kind === 'body') tileBodyPlaceholders(target.elements, masterStore.get().deck.canvas);
      }, { label: kind === 'body' && slot !== 'body' ? 'Add column' : 'Add placeholder' });
      masterStore.select([element.id]);
    };
    const PLACEHOLDER_KINDS: Array<[SlotKind, string]> = [
      ['title', 'Title'], ['subtitle', 'Subtitle'], ['body', 'Body'], ['caption', 'Caption'],
    ];
    let pickerKey = '';
    const renderPlaceholderPicker = (): void => {
      const slide = currentSlide();
      const addable = isCustom() && slide
        ? PLACEHOLDER_KINDS.filter(([kind]) => nextSlot(slide.elements, kind) !== null)
        : [];
      const key = JSON.stringify([isCustom(), addable.map(([kind]) => kind)]);
      if (key === pickerKey) return;
      pickerKey = key;
      // A built-in layout's placeholders are fixed: offer the way to a copy instead.
      const fresh = createToolbarPicker('Placeholder', isCustom()
        ? addable.map(([kind, label]) => ({ label, action: () => addPlaceholder(kind) }))
        : [{ label: 'Duplicate this layout to add placeholders', action: () => addLayout(masterStore.get().slideIndex) }]);
      fresh.classList.add('layout-editor-placeholder-picker');
      tools.replaceChild(fresh, tools.querySelector('.layout-editor-placeholder-picker') ?? tools.children[2]);
    };

    const openLayoutMenu = (anchor: HTMLElement, index: number): void => {
      const slide = masterStore.get().deck.slides[index];
      const custom = isCustomEditingSlide(slide.id);
      const items: MenuItem[] = [
        { label: 'Duplicate', action: () => addLayout(index) },
        { label: 'Rename', action: () => startRename(index), disabled: !custom },
        'separator',
        { label: 'Delete', action: () => deleteLayout(index), danger: true, disabled: !custom },
      ];
      openMenu(anchor, items);
    };

    let renaming: number | null = null;
    const startRename = (index: number): void => {
      renaming = index;
      renderRail();
    };

    const railItem = (slide: Slide, index: number): HTMLElement => {
      const state = masterStore.get();
      const item = document.createElement('div');
      item.className = `layout-editor-rail-item${state.slideIndex === index ? ' active' : ''}`;
      item.tabIndex = 0;
      item.setAttribute('role', 'button');
      const thumb = document.createElement('span');
      thumb.className = 'layout-editor-rail-thumb';
      const railSlide = structuredClone(slide);
      revealPlaceholders(railSlide.elements);
      thumb.appendChild(renderSlide(railSlide, {
        resolveSrc: (src) => window.api.assetUrl(src),
        mediaPreload: 'metadata',
      }));
      // Scale the full-size slide to the thumbnail's real width, which the
      // rail's breakpoints change.
      if (typeof ResizeObserver !== 'undefined') {
        const observer = new ResizeObserver(([entry]) => {
          thumb.style.setProperty('--layout-thumb-scale', String(entry.contentRect.width / masterStore.get().deck.canvas.w));
        });
        observer.observe(thumb);
        thumbObservers.push(observer);
      }
      const footer = document.createElement('span');
      footer.className = 'layout-editor-rail-footer';
      const custom = isCustomEditingSlide(slide.id);
      if (renaming === index && custom) {
        const input = document.createElement('input');
        input.type = 'text';
        input.className = 'layout-editor-rename';
        input.value = slide.name;
        input.setAttribute('aria-label', 'Layout name');
        const finish = (save: boolean) => {
          if (renaming !== index) return;
          renaming = null;
          if (save) renameLayout(index, input.value);
          renderRail();
        };
        input.addEventListener('keydown', (event) => {
          event.stopPropagation();
          if (event.key === 'Enter') finish(true);
          else if (event.key === 'Escape') finish(false);
        });
        input.addEventListener('blur', () => finish(true));
        footer.append(input);
        queueMicrotask(() => { input.focus(); input.select(); });
      } else {
        const label = document.createElement('span');
        label.className = 'layout-editor-rail-name';
        label.textContent = slide.name;
        const count = usage.get(layoutIdOfEditingSlide(slide.id)) ?? 0;
        const uses = document.createElement('span');
        uses.className = 'layout-editor-rail-uses';
        uses.textContent = count > 0 ? String(count) : '';
        uses.title = count === 1 ? 'Used by 1 slide' : `Used by ${count} slides`;
        const more = document.createElement('button');
        more.type = 'button';
        more.className = 'layout-editor-rail-more';
        more.textContent = '⋯';
        more.title = 'Layout actions';
        more.setAttribute('aria-label', `Actions for ${slide.name}`);
        more.addEventListener('click', (event) => {
          event.stopPropagation();
          openLayoutMenu(more, index);
        });
        footer.append(label, uses, more);
        if (custom) {
          label.title = 'Double-click to rename';
          label.addEventListener('dblclick', (event) => {
            event.stopPropagation();
            startRename(index);
          });
        }
      }
      item.append(thumb, footer);
      item.addEventListener('click', () => masterStore.selectSlide(index));
      item.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' && renaming === null) masterStore.selectSlide(index);
      });
      item.addEventListener('contextmenu', (event) => {
        event.preventDefault();
        openLayoutMenu(item, index);
      });
      return item;
    };

    const thumbObservers: ResizeObserver[] = [];
    const renderRail = (): void => {
      const { deck } = masterStore.get();
      for (const observer of thumbObservers.splice(0)) observer.disconnect();
      rail.replaceChildren();
      const builtInTitle = document.createElement('h3');
      builtInTitle.textContent = 'Built-in';
      rail.appendChild(builtInTitle);
      deck.slides.forEach((slide, index) => {
        if (!isCustomEditingSlide(slide.id)) rail.appendChild(railItem(slide, index));
      });
      const ownTitle = document.createElement('h3');
      ownTitle.textContent = 'Your layouts';
      rail.appendChild(ownTitle);
      let own = 0;
      deck.slides.forEach((slide, index) => {
        if (!isCustomEditingSlide(slide.id)) return;
        own += 1;
        rail.appendChild(railItem(slide, index));
      });
      if (own === 0) {
        const none = document.createElement('p');
        none.textContent = 'None yet. Start one from the layout you are on.';
        rail.appendChild(none);
      }
      const add = barButton('+ New layout', () => addLayout(masterStore.get().slideIndex, 'New layout'));
      add.classList.add('layout-editor-add');
      add.title = 'A new layout, starting as a copy of the selected one';
      rail.appendChild(add);
    };

    /** The panel shown while nothing on the layout is selected. */
    let settingsKey = '';
    const renderSettings = (): void => {
      const state = masterStore.get();
      const slide = currentSlide();
      const showSettings = state.selection.size === 0 && Boolean(slide);
      const inspectorWasHidden = inspectorInner.hidden;
      settingsHost.hidden = !showSettings;
      inspectorInner.hidden = showSettings;
      // The inspector skips rendering while hidden, so it has to catch up the
      // moment a selection hands the panel back to it.
      if (!showSettings && inspectorWasHidden) masterInspector.render();
      if (!showSettings || !slide) return;
      const layoutId = layoutIdOfEditingSlide(slide.id);
      const custom = isCustomEditingSlide(slide.id);
      const extra = meta.get(layoutId);
      const key = JSON.stringify([slide.id, slide.name, slide.background, slide.elements.map((element) => [element.id, element.type === 'text' ? element.layoutPlaceholder : null]), extra]);
      if (key === settingsKey) return;
      settingsKey = key;
      settingsHost.replaceChildren(layoutSettingsPanel({
        slide,
        custom,
        builtInId: isBuiltInLayout(layoutId) ? layoutId : null,
        titleSlide: custom ? extra?.titleSlide ?? false : layoutId === 'title',
        usage: usage.get(layoutId) ?? 0,
        onRename: (name) => renameLayout(state.slideIndex, name),
        onBackground: (color) => masterStore.commit((next) => {
          next.slides[masterStore.get().slideIndex].background = { color, image: null };
        }, { label: color ? 'Set layout background' : 'Use theme background' }),
        onTitleSlide: (on) => {
          if (!extra) return;
          extra.titleSlide = on;
          settingsKey = '';
          renderSettings();
        },
        onAddPlaceholder: addPlaceholder,
        canAdd: (kind) => custom && nextSlot(slide.elements, kind) !== null,
        onSelect: (elementId) => masterStore.select([elementId]),
        onDuplicate: () => addLayout(state.slideIndex),
        onDelete: () => deleteLayout(state.slideIndex),
      }));
    };

    const refresh = (): void => {
      renderRail();
      renderSettings();
      renderPlaceholderPicker();
    };
    masterStore.subscribe(refresh);
    refresh();

    /*
     * The editor's shortcuts, aimed at the layout being edited. The shell's
     * own handler acts on the deck behind this overlay, so without this ⌘V
     * pasted onto a slide nobody could see and Delete removed objects from it.
     * Capture phase, so it answers first and the shell never sees the key.
     */
    const onKey = (event: KeyboardEvent): void => {
      // An overlay taken away without closing leaves nothing to aim keys at.
      if (!overlay.isConnected) {
        window.removeEventListener('keydown', onKey, true);
        return;
      }
      if (document.querySelector('[aria-modal="true"]')) return;
      const target = event.target instanceof HTMLElement ? event.target : null;
      // Typing in a box, a field or the name of a layout keeps its keys.
      if (masterCanvas.isEditing() || target?.isContentEditable
        || (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) return;
      const mod = event.metaKey || event.ctrlKey;
      const key = event.key.toLowerCase();
      const run = (action: () => unknown): void => {
        event.preventDefault();
        event.stopImmediatePropagation();
        void action();
      };
      if (mod && !event.altKey && key === 'v') {
        run(async () => {
          const pasted = await pasteFromClipboard(masterStore, undefined, { objectsOnly: true });
          if (!pasted) this.deps.setStatusMessage('Nothing to paste onto a layout: copy a picture or objects first.');
        });
      } else if (mod && key === 'c') {
        run(() => copySelectionToClipboard(masterStore));
      } else if (mod && key === 'x') {
        run(async () => {
          await copySelectionToClipboard(masterStore);
          deleteUnlocked(masterStore);
        });
      } else if (mod && key === 'd') {
        run(() => duplicateUnlocked(masterStore));
      } else if (mod && key === 'z') {
        run(() => (event.shiftKey ? masterStore.redo() : masterStore.undo()));
      } else if (mod && key === 'a') {
        run(() => masterStore.selectAllElements());
      } else if (mod && !event.altKey && event.code === 'KeyG') {
        run(() => (event.shiftKey ? masterStore.ungroupSelected() : masterStore.groupSelected()));
      } else if (!mod && (event.key === 'Backspace' || event.key === 'Delete')) {
        run(() => deleteUnlocked(masterStore));
      } else if (!mod && event.key.startsWith('Arrow')) {
        if (masterStore.get().selection.size === 0) {
          event.stopImmediatePropagation();
          return;
        }
        const step = event.shiftKey ? 10 : 1;
        const dx = event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0;
        const dy = event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0;
        run(() => masterStore.updateSelected((element) => {
          element.x += dx;
          element.y += dy;
          if (element.type === 'shape' && element.control) {
            element.control.x += dx;
            element.control.y += dy;
          }
        }, { label: 'Nudge' }));
      } else if (mod && key !== 's' && key !== 'q' && key !== 'w') {
        // Every other editor shortcut would reach the hidden deck; saving and
        // the app's own window keys still pass.
        event.stopImmediatePropagation();
      } else if (!mod && key === 'n') {
        event.stopImmediatePropagation();
      }
    };
    window.addEventListener('keydown', onKey, true);

    const close = (save: boolean): void => {
      if (save) {
        const { masters, customLayouts } = layoutsFromEditingDeck(masterStore.get().deck, meta);
        this.deps.store.commit((deck) => {
          installLayouts(deck, masters, customLayouts);
        }, { label: 'Edit layouts' });
        void this.deps.save();
        this.deps.setStatusMessage(customLayouts.length > 0
          ? `Updated the layouts: 3 built-in, ${customLayouts.length} of your own.`
          : 'Updated the built-in layouts.');
      }
      window.removeEventListener('keydown', onKey, true);
      overlay.remove();
      this.editingOverlay = null;
      this.closeLayoutEditor = null;
      if (!this.preview.hidden) this.render();
      else this.previewStyle.textContent = '';
    };
    this.closeLayoutEditor = close;
  }
}

interface LayoutSettingsOptions {
  slide: Slide;
  custom: boolean;
  builtInId: FixedLayout | null;
  titleSlide: boolean;
  usage: number;
  onRename: (name: string) => void;
  onBackground: (color: string | null) => void;
  onTitleSlide: (on: boolean) => void;
  onAddPlaceholder: (kind: SlotKind) => void;
  canAdd: (kind: SlotKind) => boolean;
  onSelect: (elementId: string) => void;
  onDuplicate: () => void;
  onDelete: () => void;
}

const SLOT_LABELS: Record<SlotKind, string> = {
  title: 'Title', subtitle: 'Subtitle', body: 'Body', caption: 'Caption',
};

/** "Body 2" for `body-2`. */
function slotLabel(slot: string): string {
  const number = /-(\d+)$/.exec(slot)?.[1];
  return number ? `${SLOT_LABELS[slotKind(slot)]} ${number}` : SLOT_LABELS[slotKind(slot)];
}

/**
 * The layout's own settings: name, background, whether its slides count as
 * title slides, its placeholders, and how many slides use it. Styled as the
 * inspector's sections so it reads as part of the same panel.
 */
function layoutSettingsPanel(options: LayoutSettingsOptions): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'layout-settings-panel';
  const section = (heading: string): HTMLElement => {
    const node = document.createElement('section');
    node.className = 'insp-option-section';
    const title = document.createElement('h4');
    title.className = 'insp-subtitle';
    title.textContent = heading;
    node.appendChild(title);
    wrap.appendChild(node);
    return node;
  };

  const about = section('Layout');
  const nameField = document.createElement('label');
  nameField.className = 'field';
  const nameLabel = document.createElement('span');
  nameLabel.textContent = 'Name';
  const name = document.createElement('input');
  name.type = 'text';
  name.value = options.slide.name;
  name.disabled = !options.custom;
  name.title = options.custom ? 'Rename this layout' : 'Built-in layouts keep their names';
  name.addEventListener('change', () => options.onRename(name.value));
  name.addEventListener('keydown', (event) => event.stopPropagation());
  nameField.append(nameLabel, name);
  const uses = document.createElement('p');
  uses.className = 'insp-hint';
  uses.textContent = options.usage === 0 ? 'No slides use this layout yet.'
    : options.usage === 1 ? 'Used by 1 slide.' : `Used by ${options.usage} slides.`;
  about.append(nameField, uses);
  if (!options.custom) {
    const note = document.createElement('p');
    note.className = 'insp-hint';
    note.textContent = 'A built-in layout. Edit it here, or duplicate it to make a layout of your own.';
    about.appendChild(note);
  }

  const look = section('Background');
  look.appendChild(colorField('Background', options.slide.background.color, options.onBackground, {
    clear: { kind: 'theme', label: 'Theme background' },
  }));

  const behaviour = section('Slides on this layout');
  const titleLabel = document.createElement('label');
  titleLabel.className = 'field field-check';
  const titleBox = document.createElement('input');
  titleBox.type = 'checkbox';
  titleBox.checked = options.titleSlide;
  titleBox.disabled = !options.custom;
  titleBox.addEventListener('change', () => options.onTitleSlide(titleBox.checked));
  const titleText = document.createElement('span');
  titleText.textContent = 'Title slide';
  const titleSub = document.createElement('small');
  titleSub.className = 'field-check-sub';
  titleSub.textContent = ' · no page number';
  titleText.appendChild(titleSub);
  titleLabel.append(titleBox, titleText);
  behaviour.appendChild(titleLabel);

  const slots = section('Placeholders');
  const placed = options.slide.elements
    .filter((element): element is TextEl => element.type === 'text' && Boolean(element.layoutPlaceholder))
    .sort((a, b) => a.y - b.y || a.x - b.x);
  const list = document.createElement('div');
  list.className = 'layout-settings-slots';
  if (placed.length === 0) {
    const none = document.createElement('p');
    none.className = 'insp-hint';
    none.textContent = 'None: slides on this layout start empty.';
    list.appendChild(none);
  }
  for (const element of placed) {
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'layout-settings-slot';
    row.textContent = slotLabel(element.layoutPlaceholder!);
    row.title = 'Select this placeholder';
    row.addEventListener('click', () => options.onSelect(element.id));
    list.appendChild(row);
  }
  slots.appendChild(list);
  const add = document.createElement('div');
  add.className = 'layout-settings-add';
  for (const [kind, label] of Object.entries(SLOT_LABELS) as Array<[SlotKind, string]>) {
    const button = barButton(`+ ${label}`, () => options.onAddPlaceholder(kind));
    button.disabled = !options.canAdd(kind);
    add.appendChild(button);
  }
  slots.appendChild(add);
  if (!options.custom) {
    const note = document.createElement('p');
    note.className = 'insp-hint';
    note.textContent = 'Placeholders of built-in layouts are fixed.';
    slots.appendChild(note);
  }

  if (options.custom) {
    const manage = section('Manage');
    const row = document.createElement('div');
    row.className = 'layout-settings-add';
    const remove = barButton('Delete layout', options.onDelete);
    remove.title = options.usage > 0
      ? `Its ${options.usage === 1 ? 'slide moves' : `${options.usage} slides move`} to the layout it was made from, content kept`
      : 'Delete this layout';
    row.append(barButton('Duplicate', options.onDuplicate), remove);
    manage.appendChild(row);
  }
  return wrap;
}

/**
 * What Delete and Duplicate may act on: anything but a built-in layout's
 * placeholders, which other features rely on. A layout of the author's own
 * may lose any placeholder; none is ever duplicated, as two boxes cannot
 * stand in one slot.
 */
function unlockedSelection(store: EditorStore, forDuplicate = false): SlideElement[] {
  const slide = store.get().deck.slides[store.get().slideIndex];
  const custom = isCustomEditingSlide(slide?.id ?? '');
  return store.selectedElements().filter((element) => !(
    element.type === 'text' && element.layoutPlaceholder && (forDuplicate || !custom)
  ));
}

function deleteUnlocked(store: EditorStore): void {
  const ids = new Set(unlockedSelection(store).map((element) => element.id));
  if (ids.size === 0) return;
  store.commit((deck) => {
    const slide = deck.slides[store.get().slideIndex];
    slide.elements = slide.elements.filter((element) => !ids.has(element.id));
  }, { label: ids.size === 1 ? 'Delete master object' : 'Delete master objects' });
  store.clearSelection();
}

function duplicateUnlocked(store: EditorStore): void {
  const allowed = unlockedSelection(store, true).map((element) => element.id);
  if (allowed.length === 0) return;
  store.select(allowed);
  store.duplicateSelection();
}
