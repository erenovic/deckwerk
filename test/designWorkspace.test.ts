// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DesignWorkspace } from '../src/renderer/editor/designWorkspace.js';
import { EditorStore } from '../src/renderer/editor/store.js';
import { applySlideLayout } from '../src/renderer/editor/slideLayouts.js';
import { emptyDeck, type Deck } from '../src/shared/deck.js';
import { defaultLayoutMasters } from '../src/shared/layoutMasters.js';
import { PLAYER_TYPE_CSS } from '../src/shared/playerTypeCss.js';
import { THEMES } from '../src/shared/themes.js';

class NoopResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

/** jsdom ships neither `CSS.escape` nor pointer capture, which the canvas uses. */
function installDomShims(): void {
  globalThis.ResizeObserver = NoopResizeObserver as unknown as typeof ResizeObserver;
  if (!globalThis.CSS) {
    (globalThis as unknown as { CSS: unknown }).CSS = {
      escape: (value: string) => value.replace(/["\\]/g, '\\$&'),
    };
  }
  for (const name of ['setPointerCapture', 'releasePointerCapture'] as const) {
    if (!(name in Element.prototype)) {
      Object.defineProperty(Element.prototype, name, { configurable: true, value: () => {} });
    }
  }
  (globalThis as unknown as { window: Window }).window.api = {
    assetUrl: (src: string) => src,
    pathForFile: () => '',
    importAssets: async () => [],
  } as never;
}

function build(deck: Deck = emptyDeck('Design')): {
  workspace: DesignWorkspace; store: EditorStore; save: ReturnType<typeof vi.fn>;
} {
  const canvasHost = document.createElement('main');
  document.body.appendChild(canvasHost);
  const store = new EditorStore(deck, '/tmp/design');
  const save = vi.fn();
  return {
    store,
    save,
    workspace: new DesignWorkspace({ canvasHost, store, save, setStatusMessage: vi.fn() }),
  };
}

/** Click a labelled button inside one of the layout editor's toolbars. */
function clickInOverlay(group: string, label: string): void {
  const button = [...document.querySelectorAll<HTMLButtonElement>(`${group} button`)]
    .find((candidate) => candidate.textContent === label);
  if (!button) throw new Error(`no ${label} button in ${group}`);
  button.click();
}

describe('design workspace dismissal', () => {
  beforeEach(() => {
    document.head.replaceChildren();
    document.body.replaceChildren();
    installDomShims();
  });

  function setup(): DesignWorkspace {
    return build().workspace;
  }

  it('escapes the theme preview', () => {
    const workspace = setup();
    workspace.show(THEMES[0]);

    expect(workspace.escape()).toBe('theme');
    expect(document.querySelector<HTMLElement>('.design-preview-workspace')!.hidden).toBe(true);
    expect(workspace.escape()).toBeNull();
  });

  it('cancels the layout editor before leaving the theme preview', () => {
    const workspace = setup();
    workspace.show(THEMES[0]);
    workspace.openLayoutEditor('standard');

    expect(document.querySelector('.layout-editor-overlay')).not.toBeNull();
    expect(workspace.escape()).toBe('layout');
    expect(document.querySelector('.layout-editor-overlay')).toBeNull();
    expect(document.querySelector<HTMLElement>('.design-preview-workspace')!.hidden).toBe(false);
  });
});

/**
 * Every design surface draws masters through the player's renderer, which
 * hides prompt copy the author has not replaced (`type.css`). The layout
 * gallery is nothing but prompt copy, so without an explicit opt-out the whole
 * design mode presented empty slides.
 */
describe('the layout gallery', () => {
  beforeEach(() => {
    document.head.replaceChildren();
    document.body.replaceChildren();
    const style = document.createElement('style');
    style.textContent = PLAYER_TYPE_CSS;
    document.head.appendChild(style);
    installDomShims();
  });

  const shownIn = (selector: string): string[] =>
    [...document.querySelectorAll<HTMLElement>(`${selector} .text-body`)]
      .filter((body) => getComputedStyle(body).visibility === 'visible')
      .map((body) => body.textContent ?? '');

  it('draws the sample copy in the preview grid rather than three empty frames', () => {
    build().workspace.show(THEMES[0]);
    expect(shownIn('.design-preview-grid')).toEqual([
      'The big idea', 'Readable body copy for the story.', 'Supporting detail',
      'The big idea', 'Readable body copy for the story.', 'Supporting detail',
      'The big idea',
    ]);
  });

  it('draws the sidebar summary', () => {
    const summary = build().workspace.createLayoutSummary(THEMES[0], vi.fn());
    document.body.appendChild(summary);
    expect(shownIn('.theme-layout-summary'))
      .toEqual(['The big idea', 'Readable body copy for the story.']);
  });

  it('dresses the sidebar summary in the chosen theme', () => {
    const theme = THEMES.find((candidate) => candidate.fonts.title.family !== THEMES[0].fonts.title.family)!;
    const summary = build().workspace.createLayoutSummary(theme, vi.fn());
    document.body.appendChild(summary);

    // The summary renders outside the preview stylesheet, so the theme reaches
    // it as inline CSS declarations or not at all.
    const title = document.querySelector<HTMLElement>('.theme-layout-summary .element-text')!;
    expect(title.style.getPropertyValue('font-family')).toBe(theme.fonts.title.family);
    expect(title.style.getPropertyValue('font-size')).toBe(`${theme.fonts.title.size}px`);
    const ground = document.querySelector<HTMLElement>('.theme-layout-summary .slide')!;
    expect(ground.style.background).not.toBe('');
  });

  it('draws the master being edited in the layout editor rail', () => {
    build().workspace.openLayoutEditor('standard');
    expect(shownIn('.layout-editor-rail-thumb')).toEqual(['Slide title', 'Body text', 'Slide title']);
  });
});

describe('leaving the layout editor', () => {
  beforeEach(() => {
    document.head.replaceChildren();
    document.body.replaceChildren();
    installDomShims();
  });

  /** A deck holding one authored Title + Body slide, masters already installed. */
  function authoredDeck(): Deck {
    const deck = emptyDeck('Design');
    deck.layoutMasters = defaultLayoutMasters();
    applySlideLayout(deck.slides[0], 'standard', deck.layoutMasters);
    for (const element of deck.slides[0].elements) {
      if (element.type !== 'text') continue;
      element.html = `Authored ${element.layoutPlaceholder}`;
      element.class = element.class.filter((name) => name !== 'placeholder');
    }
    return deck;
  }

  const titleOf = (store: EditorStore) => {
    const element = store.get().deck.slides[0].elements
      .find((candidate) => candidate.type === 'text' && candidate.layoutPlaceholder === 'title');
    if (!element || element.type !== 'text') throw new Error('no title placeholder');
    return element;
  };

  it('pushes a new master object onto the deck on Done, keeping authored copy', () => {
    const { workspace, store, save } = build(authoredDeck());
    workspace.openLayoutEditor('standard');
    clickInOverlay('.layout-editor-tools', 'Text');
    clickInOverlay('.layout-editor-actions', 'Done');

    const master = store.get().deck.layoutMasters!.standard;
    expect(master.elements.filter((element) => !(
      element.type === 'text' && element.layoutPlaceholder
    ))).toHaveLength(1);

    // Every slide on that layout gains a locked copy of it, and its own
    // authored title is untouched by the round trip.
    const copies = store.get().deck.slides[0].elements.filter((element) => element.layoutMasterId);
    expect(copies).toHaveLength(1);
    expect(copies[0].class).toContain('layout-master-element');
    expect(titleOf(store).html).toBe('Authored title');
    expect(titleOf(store).class).not.toContain('placeholder');

    expect(save).toHaveBeenCalled();
    expect(document.querySelector('.layout-editor-overlay')).toBeNull();
    // One undoable step for the whole layout edit.
    store.undo();
    expect(store.get().deck.slides[0].elements.some((element) => element.layoutMasterId)).toBe(false);
  });

  /**
   * A master carries geometry, not a type scale: the deck's title size is set
   * once in the theme. A size that reaches a master anyway (an older deck) is
   * dropped on Done rather than stamped onto every slide. The locked size
   * field itself is covered in textFormattingControls.test.ts.
   */
  it('keeps sizes with the theme, not the layout', () => {
    const deck = authoredDeck();
    const title = deck.layoutMasters!.standard.elements[0];
    if (title.type !== 'text') throw new Error('the standard master starts with its title');
    title.style['font-size'] = '64px';
    const { workspace, store } = build(deck);
    workspace.openLayoutEditor('standard');
    clickInOverlay('.layout-editor-actions', 'Done');

    const saved = store.get().deck.layoutMasters!.standard.elements[0];
    expect(saved.type === 'text' && saved.style['font-size']).toBeUndefined();
    expect(titleOf(store).style['font-size']).toBeUndefined();
  });

  it('leaves the deck untouched on Cancel', () => {
    const { workspace, store, save } = build(authoredDeck());
    const before = JSON.stringify(store.get().deck);
    workspace.openLayoutEditor('standard');
    clickInOverlay('.layout-editor-tools', 'Text');
    clickInOverlay('.layout-editor-actions', 'Cancel');

    expect(JSON.stringify(store.get().deck)).toBe(before);
    expect(save).not.toHaveBeenCalled();
  });
});

describe('layouts of the deck’s own in the layout editor', () => {
  beforeEach(() => {
    document.head.replaceChildren();
    document.body.replaceChildren();
    installDomShims();
  });

  const railNames = () => [...document.querySelectorAll('.layout-editor-rail h3, .layout-editor-rail-name')]
    .map((node) => node.textContent);
  const settings = () => document.querySelector<HTMLElement>('.layout-settings')!;
  const settingsButton = (label: string) => [...settings().querySelectorAll<HTMLButtonElement>('button')]
    .find((button) => button.textContent === label)!;

  it('starts a layout from the selected one, lets it be renamed and given a second body, and saves it on Done', () => {
    const { workspace, store } = build();
    workspace.openLayoutEditor('standard');
    expect(railNames()).toEqual(['Built-in', 'Freeform', 'Title + Body', 'Title', 'Your layouts']);
    // With nothing selected the panel is the layout's settings, not an empty inspector.
    expect(settings().hidden).toBe(false);
    expect(settings().querySelector<HTMLInputElement>('input[type="text"]')!.disabled).toBe(true);

    clickInOverlay('.layout-editor-rail', '+ New layout');
    expect(railNames()).toEqual(['Built-in', 'Freeform', 'Title + Body', 'Title', 'Your layouts', 'New layout']);

    const name = settings().querySelector<HTMLInputElement>('input[type="text"]')!;
    expect(name.disabled).toBe(false);
    name.value = 'Two columns';
    name.dispatchEvent(new Event('change'));
    settingsButton('+ Body').click();
    // Adding selects the new placeholder; deselect to come back to the settings.
    clickInOverlay('.layout-editor-rail', '+ New layout');
    expect(railNames().slice(5)).toEqual(['Two columns', 'New layout']);

    clickInOverlay('.layout-editor-actions', 'Done');
    const own = store.get().deck.customLayouts;
    expect(own.map((layout) => layout.name)).toEqual(['Two columns', 'New layout']);
    expect(own[0].basedOn).toBe('standard');
    expect(own[0].elements.map((element) => element.type === 'text' ? element.layoutPlaceholder : null))
      .toEqual(['title', 'body', 'body-2']);
    expect(own[0].elements[2].class).toEqual(['role-body', 'placeholder']);
    store.undo();
    expect(store.get().deck.customLayouts).toEqual([]);
  });

  it('marks a layout of its own as a title slide', () => {
    const { workspace, store } = build();
    workspace.openLayoutEditor('title');
    clickInOverlay('.layout-editor-rail', '+ New layout');
    const titleBox = settings().querySelector<HTMLInputElement>('input[type="checkbox"]')!;
    // A copy of Title starts as a title slide; it can be switched off.
    expect(titleBox.checked).toBe(true);
    titleBox.click();
    clickInOverlay('.layout-editor-actions', 'Done');
    expect(store.get().deck.customLayouts[0]).toMatchObject({ basedOn: 'title', titleSlide: false });
  });

  it('keeps built-in placeholders fixed and lets its own ones be deleted', () => {
    const { workspace } = build();
    workspace.openLayoutEditor('standard');
    expect(settingsButton('+ Body').disabled).toBe(true);
    clickInOverlay('.layout-editor-rail', '+ New layout');
    expect(settingsButton('+ Body').disabled).toBe(false);
    expect(settingsButton('+ Title').disabled, 'a layout has one title').toBe(true);
  });

  it('moves the slides of a deleted layout to the built-in it was made from, content kept', () => {
    const deck = emptyDeck('Delete');
    deck.layoutMasters = defaultLayoutMasters();
    deck.customLayouts = [{
      id: 'layout-cover', name: 'Cover', basedOn: 'title', titleSlide: true,
      background: { color: '#123456', image: null },
      elements: structuredClone(defaultLayoutMasters().title.elements),
    }];
    applySlideLayout(deck.slides[0], 'layout-cover', deck.layoutMasters, deck.customLayouts);
    const title = deck.slides[0].elements.find((element) => element.type === 'text')!;
    if (title.type === 'text') {
      title.html = 'Our talk';
      title.class = title.class.filter((name) => name !== 'placeholder');
    }
    const { workspace, store } = build(deck);
    workspace.openLayoutEditor('layout-cover');
    expect(settings().textContent).toContain('Used by 1 slide.');
    settingsButton('Delete layout').click();
    clickInOverlay('.layout-editor-actions', 'Done');

    const slide = store.get().deck.slides[0];
    expect(store.get().deck.customLayouts).toEqual([]);
    expect(slide.layout).toBe('title');
    expect(slide.elements.find((element) => element.type === 'text')).toMatchObject({ html: 'Our talk' });
  });

  it('turns a second body into two columns and shows the new placeholder\u2019s properties', () => {
    const { workspace } = build();
    workspace.openLayoutEditor('standard');
    clickInOverlay('.layout-editor-rail', '+ New layout');
    settingsButton('+ Body').click();
    // The placeholder is selected: the inspector, not the settings, is showing,
    // and it shows that text box's properties.
    expect(settings().hidden).toBe(true);
    const inspector = document.querySelector<HTMLElement>('.layout-editor-inspector-inner')!;
    expect(inspector.hidden).toBe(false);
    expect(inspector.textContent).toContain('Geometry');
    const columns = [...document.querySelectorAll<HTMLElement>('.layout-editor-canvas .slide-layer [data-element-id]')]
      .map((node) => node.style.left).filter(Boolean);
    expect(columns.length).toBeGreaterThanOrEqual(3);
  });
});

describe('shortcuts in the layout editor', () => {
  beforeEach(() => {
    document.head.replaceChildren();
    document.body.replaceChildren();
    installDomShims();
  });

  const press = (init: KeyboardEventInit) => document.body.dispatchEvent(
    new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init }),
  );
  const flush = () => new Promise((settle) => setTimeout(settle, 0));
  const layoutImages = () => document.querySelectorAll('.layout-editor-canvas [data-element-type="image"]').length;

  /** A deck whose slide has a selected object of its own, which no layout key may touch. */
  function withSelectedSlideObject() {
    const deck = emptyDeck('Shortcuts');
    deck.layoutMasters = defaultLayoutMasters();
    deck.slides[0].elements = [{
      id: 'slide-photo', type: 'image', x: 100, y: 100, w: 400, h: 300, rot: 0, z: 1, opacity: 1,
      class: [], style: {}, src: 'assets/photo.png', alt: '', fit: 'contain', sourceBox: null,
    }];
    const made = build(deck);
    made.store.select(['slide-photo']);
    // Stands in for the shell's own key handler, which acts on the deck.
    const reachedShell = vi.fn();
    window.addEventListener('keydown', reachedShell);
    return { ...made, reachedShell };
  }

  it('pastes a copied picture onto the layout, not onto the slide behind it, and deletes it again', async () => {
    const { workspace, store, reachedShell } = withSelectedSlideObject();
    (window.api as unknown as Record<string, unknown>).readClipboard = async () => ({
      kind: 'external-image',
      asset: { src: 'assets/logo.png', kind: 'image', width: 400, height: 200, duration: null },
    });
    workspace.openLayoutEditor('standard');

    press({ key: 'v', metaKey: true, ctrlKey: true });
    await flush();
    expect(layoutImages()).toBe(1);
    expect(store.slide!.elements.map((element) => element.id)).toEqual(['slide-photo']);

    press({ key: 'Backspace' });
    expect(layoutImages()).toBe(0);
    expect(store.slide!.elements.map((element) => element.id)).toEqual(['slide-photo']);
    expect(reachedShell).not.toHaveBeenCalled();
  });

  it('keeps the pasted logo when the layouts are saved', async () => {
    const { workspace, store } = withSelectedSlideObject();
    (window.api as unknown as Record<string, unknown>).readClipboard = async () => ({
      kind: 'external-image',
      asset: { src: 'assets/logo.png', kind: 'image', width: 400, height: 200, duration: null },
    });
    workspace.openLayoutEditor('standard');
    press({ key: 'v', metaKey: true, ctrlKey: true });
    await flush();
    clickInOverlay('.layout-editor-actions', 'Done');
    expect(store.get().deck.layoutMasters!.standard.elements
      .some((element) => element.type === 'image' && element.src === 'assets/logo.png')).toBe(true);
  });

  it('refuses copied slides, and gives the shortcuts back when it closes', async () => {
    const { workspace, store, reachedShell } = withSelectedSlideObject();
    (window.api as unknown as Record<string, unknown>).readClipboard = async () => ({
      kind: 'slides', slides: [structuredClone(store.slide!)], assets: [],
    });
    workspace.openLayoutEditor('standard');
    const layouts = document.querySelectorAll('.layout-editor-rail .layout-editor-rail-item, .layout-editor-rail [data-slide-id]').length;
    press({ key: 'v', metaKey: true, ctrlKey: true });
    await flush();
    expect(document.querySelectorAll('.layout-editor-rail .layout-editor-rail-item, .layout-editor-rail [data-slide-id]').length).toBe(layouts);

    clickInOverlay('.layout-editor-actions', 'Cancel');
    press({ key: 'ArrowLeft' });
    expect(reachedShell).toHaveBeenCalledTimes(1);
  });
});
