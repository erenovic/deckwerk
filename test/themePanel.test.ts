// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CssEditor } from '../src/renderer/editor/cssEditor.js';
import { createThemePanel } from '../src/renderer/editor/themePanel.js';
import { EditorStore } from '../src/renderer/editor/store.js';
import { emptyDeck } from '../src/shared/deck.js';
import { STOCK_STYLESHEET_STYLE, THEMES, chooseDeckTheme, fullThemeSelection, themeStyleCss, themeStyleOf } from '../src/shared/themes.js';

describe('theme panel', () => {
  beforeEach(() => document.body.replaceChildren());

  it('keeps the theme first, its Apply second, then layouts and their Apply', () => {
    const store = new EditorStore(emptyDeck('Theme panel'), '/tmp/theme-panel');
    const cssEditor = {
      getValue: () => '',
      setValue: vi.fn(),
    } as unknown as CssEditor;
    const onThemePreview = vi.fn();
    const onEditLayouts = vi.fn();
    const panel = createThemePanel({
      store,
      cssEditor,
      save: vi.fn(),
      setStatusMessage: vi.fn(),
      saveThemeCss: vi.fn(),
      onThemePreview,
      onEditLayouts,
    });
    document.body.appendChild(panel.element);

    expect([...panel.element.children].map((child) => child.className)).toEqual([
      'theme-browser-intro',
      'insp-option-section theme-current-section',
      'insp-option-section theme-apply-section',
      'insp-option-section layouts-section',
      'insp-option-section page-numbers-section',
    ]);
    expect([...panel.element.querySelectorAll('.insp-subtitle')].map((h) => h.textContent))
      .toEqual(['Current theme', 'Apply theme', 'Layouts', 'Page numbers']);
    expect(panel.element.querySelectorAll('.theme-active-host .theme-card')).toHaveLength(1);
    expect(panel.element.querySelector('.theme-chooser')?.hasAttribute('hidden')).toBe(true);
    expect(onThemePreview).not.toHaveBeenCalled();
    panel.element.querySelector<HTMLButtonElement>('.theme-active-host .theme-card')!.click();
    expect(onThemePreview).toHaveBeenCalledTimes(1);

    // The three masters, drawn in the theme; clicking one edits it.
    const masters = panel.element.querySelectorAll<HTMLButtonElement>('.layouts-section .design-master');
    expect(masters).toHaveLength(3);
    masters[1].click();
    expect(onEditLayouts).toHaveBeenCalledWith('standard');

    // Roles are always on show; properties are three decisions plus detection,
    // and whether to replace what the author set by hand.
    const labels = [...panel.element.querySelectorAll<HTMLElement>('.theme-adoption-controls .field-check > span')]
      .map((label) => label.firstChild?.textContent);
    expect(labels).toEqual([
      'Title', 'Body', 'Caption',
      'Typography', 'Type scale', 'Colour', 'Detect roles for untagged text', 'Replace my manual changes',
    ]);
    expect(labels).not.toContain('Heading');
  });

  it('dismisses theme picking and the inline theme editor', () => {
    const store = new EditorStore(emptyDeck('Theme panel'), '/tmp/theme-panel');
    const panel = createThemePanel({
      store,
      cssEditor: { getValue: () => '', setValue: vi.fn() } as unknown as CssEditor,
      save: vi.fn(),
      setStatusMessage: vi.fn(),
      saveThemeCss: vi.fn(),
      onThemePreview: vi.fn(),
    });
    document.body.appendChild(panel.element);

    panel.element.querySelector<HTMLButtonElement>('.theme-active-card')!.click();
    expect(panel.element.querySelector<HTMLElement>('.theme-chooser')!.hidden).toBe(false);
    expect(panel.dismiss()).toBe(true);
    // Opening the theme editor closes the chooser: a draft is edited alone.
    panel.element.querySelector<HTMLButtonElement>('.theme-edit-button')!.click();
    expect(panel.element.querySelector<HTMLElement>('.theme-chooser')!.hidden).toBe(true);
    expect(panel.element.querySelector<HTMLElement>('.theme-inline-editor')!.hidden).toBe(false);

    expect(panel.dismiss()).toBe(true);
    expect(panel.element.querySelector<HTMLElement>('.theme-chooser')!.hidden).toBe(true);
    expect(panel.element.querySelector<HTMLElement>('.theme-inline-editor')!.hidden).toBe(true);
    expect(panel.dismiss()).toBe(false);
  });

  it('installs the chosen theme for new slides and pins existing slides where they are', () => {
    const deck = emptyDeck('Theme panel');
    // A title on the stock stylesheet alone: no inline type, no theme installed.
    deck.slides[0].elements.push({
      id: 'title-1', type: 'text', x: 0, y: 0, w: 800, h: 200, rot: 0, z: 1, opacity: 1,
      class: ['role-title'], style: {}, html: 'Existing title',
      align: 'left', valign: 'middle',
    });
    const store = new EditorStore(deck, '/tmp/theme-panel');
    const setStatusMessage = vi.fn();
    const save = vi.fn();
    const saveThemeCss = vi.fn();
    const panel = createThemePanel({
      store,
      cssEditor: { getValue: () => '', setValue: vi.fn() } as unknown as CssEditor,
      save,
      setStatusMessage,
      saveThemeCss,
      onThemePreview: vi.fn(),
    });
    document.body.appendChild(panel.element);

    // Open the chooser, then pick a card other than the one already showing.
    panel.element.querySelector<HTMLButtonElement>('.theme-active-card')!.click();
    const showing = panel.currentTheme()!.id;
    const target = THEMES.find((theme) => theme.id !== showing)!;
    const cards = [...panel.element.querySelectorAll<HTMLButtonElement>('.theme-gallery .theme-card')];
    const card = cards.find((element) => element.textContent?.includes(target.name));
    card!.click();

    // Choosing installs the whole theme as the deck's defaults, and theme.css
    // follows it at once so new slides can sit on the cascade.
    expect(store.get().deck.themeSelection).toEqual(fullThemeSelection(target.id));
    expect(store.get().deck.themePreset).toBe(target.id);
    expect(store.get().deck.themeStyle).toEqual(themeStyleOf(target));
    const css = saveThemeCss.mock.calls.at(-1)?.[0] as string;
    expect(css).toContain([
      '.role-title {',
      `  font-family: ${target.fonts.title.family};`,
      `  font-size: ${target.fonts.title.size}px;`,
      `  font-weight: ${target.fonts.title.weight};`,
      `  line-height: ${target.fonts.title.lineHeight};`,
      `  letter-spacing: ${target.fonts.title.letterSpacing};`,
    ].join('\n'));
    expect(css).toContain(`.slide {\n  background: ${target.colors.background};\n  color: ${target.colors.text};`);

    // The existing title is pinned at exactly what it rendered at before: the
    // stock value for every property the new theme would have moved, nothing
    // for the properties the two agree on.
    const was = STOCK_STYLESHEET_STYLE.fonts.title;
    const will = target.fonts.title;
    const pinned = (before: string, after: string): string | undefined => (before === after ? undefined : before);
    const title = store.get().deck.slides[0].elements.find((element) => element.id === 'title-1')!;
    expect(title.style).toEqual(Object.fromEntries(Object.entries({
      'font-family': pinned(was.family, will.family),
      'font-weight': pinned(String(was.weight), String(will.weight)),
      'font-size': pinned(`${was.size}px`, `${will.size}px`),
      'line-height': pinned(String(was.lineHeight), String(will.lineHeight)),
      'letter-spacing': pinned(was.letterSpacing, will.letterSpacing),
      color: pinned(STOCK_STYLESHEET_STYLE.colors.text, will.color ?? target.colors.text),
    }).filter(([, value]) => value !== undefined)));
    expect(title.style).not.toEqual({});
    expect(store.get().deck.slides[0].background.color)
      .toBe(pinned(STOCK_STYLESHEET_STYLE.colors.background, target.colors.background) ?? null);
    expect(save).toHaveBeenCalled();
    expect(setStatusMessage.mock.calls.at(-1)?.[0]).toContain('New slides will use');
    expect(setStatusMessage.mock.calls.at(-1)?.[0]).toContain(target.name);
  });

  it('follows the Light/Dark switch with the selection and the preview', () => {
    const store = new EditorStore(emptyDeck('Theme panel'), '/tmp/theme-panel');
    const onThemePreview = vi.fn();
    const panel = createThemePanel({
      store,
      cssEditor: { getValue: () => '', setValue: vi.fn() } as unknown as CssEditor,
      save: vi.fn(),
      setStatusMessage: vi.fn(),
      saveThemeCss: vi.fn(),
      onThemePreview,
    });
    document.body.appendChild(panel.element);

    panel.element.querySelector<HTMLButtonElement>('.theme-active-card')!.click();
    const light = panel.currentTheme()!;
    [...panel.element.querySelectorAll<HTMLButtonElement>('.theme-mode-option')]
      .find((button) => button.textContent === 'Dark')!.click();

    // The dark half of the theme that was showing, not a different theme.
    expect(panel.currentTheme()!.id).toBe(`${light.id}-dark`);
    expect(store.get().deck.themeSelection?.preset).toBe(`${light.id}-dark`);
    expect((onThemePreview.mock.calls.at(-1)?.[0] as { id: string }).id).toBe(`${light.id}-dark`);
    // Flipping the switch is still browsing: the chooser stays open.
    expect(panel.element.querySelector<HTMLElement>('.theme-chooser')!.hidden).toBe(false);
  });

  it('ends the central preview whenever the chooser closes', () => {
    const store = new EditorStore(emptyDeck('Theme panel'), '/tmp/theme-panel');
    const onThemePreview = vi.fn();
    const panel = createThemePanel({
      store,
      cssEditor: { getValue: () => '', setValue: vi.fn() } as unknown as CssEditor,
      save: vi.fn(),
      setStatusMessage: vi.fn(),
      saveThemeCss: vi.fn(),
      onThemePreview,
    });
    document.body.appendChild(panel.element);
    const chooser = panel.element.querySelector<HTMLElement>('.theme-chooser')!;
    const openChooser = () =>
      panel.element.querySelector<HTMLButtonElement>('.theme-active-card')!.click();

    // The chooser's own Close button.
    openChooser();
    expect(chooser.hidden).toBe(false);
    [...chooser.querySelectorAll<HTMLButtonElement>('button')]
      .find((button) => button.textContent === 'Close')!.click();
    expect(chooser.hidden).toBe(true);
    expect(onThemePreview.mock.calls.at(-1)?.[0]).toBeNull();

    // Picking a card is a decision: the picker closes and the deck comes back.
    openChooser();
    [...panel.element.querySelectorAll<HTMLButtonElement>('.theme-gallery .theme-card')]
      .find((card) => card.dataset.themeId !== panel.currentTheme()!.id)!.click();
    expect(chooser.hidden).toBe(true);
    expect(onThemePreview.mock.calls.at(-1)?.[0]).toBeNull();

    // And re-opening the active card while the chooser is up closes it too.
    openChooser();
    openChooser();
    expect(chooser.hidden).toBe(true);
    expect(onThemePreview.mock.calls.at(-1)?.[0]).toBeNull();

    openChooser();
    expect(panel.dismiss()).toBe(true);
    expect(onThemePreview.mock.calls.at(-1)?.[0]).toBeNull();
  });

  it('marks the theme the deck last actually wore, not the one last clicked', () => {
    const deck = emptyDeck('Theme panel');
    deck.slides[0].elements.push({
      id: 'title-1', type: 'text', x: 0, y: 0, w: 800, h: 200, rot: 0, z: 1, opacity: 1,
      class: ['role-title'], style: {}, html: 'A title', align: 'left', valign: 'middle',
    });
    const store = new EditorStore(deck, '/tmp/theme-panel');
    const panel = createThemePanel({
      store,
      cssEditor: { getValue: () => '', setValue: vi.fn() } as unknown as CssEditor,
      save: vi.fn(),
      setStatusMessage: vi.fn(),
      saveThemeCss: vi.fn(),
      onThemePreview: vi.fn(),
    });
    document.body.appendChild(panel.element);
    const openChooser = () =>
      panel.element.querySelector<HTMLButtonElement>('.theme-active-card')!.click();
    const cardFor = (name: string) =>
      [...panel.element.querySelectorAll<HTMLButtonElement>('.theme-gallery .theme-card')]
        .find((element) => element.textContent?.includes(name))!;
    const markedPrevious = () => [...panel.element
      .querySelectorAll<HTMLElement>('.theme-gallery .theme-previous-badge')]
      .filter((badge) => !badge.hidden)
      .map((badge) => badge.closest<HTMLElement>('.theme-card')!.dataset.themeId);

    // Choose Swiss and actually put it on the slide.
    openChooser();
    cardFor(THEMES.find((theme) => theme.id === 'swiss')!.name).click();
    panel.element.querySelector<HTMLButtonElement>('.theme-apply-action button')!.click();
    openChooser();
    expect(markedPrevious()).toEqual([]);

    // Now merely click through another theme: chosen, never applied.
    const salon = THEMES.find((theme) => theme.id === 'salon')!;
    openChooser();
    cardFor(salon.name).click();
    openChooser();
    // Swiss is the last theme this deck actually wore; Salon is only selected.
    expect(markedPrevious()).toEqual(['swiss']);

    // Applying Salon makes it the deck's look, and Swiss the one to go back to.
    panel.element.querySelector<HTMLButtonElement>('.theme-apply-action button')!.click();
    openChooser();
    expect(store.get().deck.themeHistory).toEqual(['salon', 'swiss']);
    expect(markedPrevious()).toEqual(['swiss']);
  });

  it('carries the theme\'s font weight into theme.css for the slides it restyles', () => {
    const deck = emptyDeck('Theme panel');
    deck.slides[0].elements.push({
      id: 'title-1', type: 'text', x: 0, y: 0, w: 800, h: 200, rot: 0, z: 1, opacity: 1,
      class: ['role-title'], style: { 'font-weight': '700' }, html: 'A heavy title',
      align: 'left', valign: 'middle',
    });
    // The store opens with the first slide selected, which is the apply scope.
    const store = new EditorStore(deck, '/tmp/theme-panel');
    const saveThemeCss = vi.fn();
    const panel = createThemePanel({
      store,
      cssEditor: { getValue: () => '', setValue: vi.fn() } as unknown as CssEditor,
      save: vi.fn(),
      setStatusMessage: vi.fn(),
      saveThemeCss,
      onThemePreview: vi.fn(),
    });
    document.body.appendChild(panel.element);

    // Pick the condensed-medium theme, then apply with the panel's defaults.
    panel.element.querySelector<HTMLButtonElement>('.theme-active-card')!.click();
    const colloquium = THEMES.find((theme) => theme.id === 'colloquium')!;
    [...panel.element.querySelectorAll<HTMLButtonElement>('.theme-gallery .theme-card')]
      .find((element) => element.textContent?.includes(colloquium.name))!.click();
    panel.element.querySelector<HTMLButtonElement>('.theme-apply-action button')!.click();

    // The family without its weight is what left condensed titles at 700. Now
    // both travel together: the title's own 700 is cleared so it follows the
    // deck's defaults, and those carry Colloquium's medium into theme.css.
    const title = store.get().deck.slides[0].elements.find((element) => element.id === 'title-1')!;
    expect(title.style['font-weight']).toBeUndefined();
    expect(title.style['font-family']).toBeUndefined();
    expect(store.get().deck.themeStyle?.fonts.title.family).toBe(colloquium.fonts.title.family);
    expect(store.get().deck.themeStyle?.fonts.title.weight).toBe(colloquium.fonts.title.weight);
    expect(saveThemeCss).toHaveBeenLastCalledWith(expect.stringContaining(
      `.role-title {\n  font-family: ${colloquium.fonts.title.family};\n  font-size: ${colloquium.fonts.title.size}px;\n  font-weight: ${colloquium.fonts.title.weight};`,
    ));
  });

  it('offers a theme the deck carries itself, and applies it like any built-in', () => {
    const deck = emptyDeck('Theme panel');
    // The shape `slide-agent theme create` writes, on a deck that has slides.
    deck.customThemes = [{
      id: 'lab-night',
      name: 'Lab Night',
      description: 'Slab titles on a deep ink ground.',
      fonts: structuredClone(THEMES[0].fonts),
      palette: ['#e9edf2', '#94a0ad', '#f0a83c'],
      colors: { background: '#12151a', text: '#e9edf2', muted: '#94a0ad', accent: '#f0a83c' },
    }];
    deck.slides[0].elements.push({
      id: 'title-1', type: 'text', x: 0, y: 0, w: 800, h: 200, rot: 0, z: 1, opacity: 1,
      class: ['role-title'], style: { 'font-family': 'Comic Sans MS' }, html: 'A title',
      align: 'left', valign: 'middle',
    });
    const store = new EditorStore(deck, '/tmp/theme-panel');
    const saveThemeCss = vi.fn();
    const panel = createThemePanel({
      store,
      cssEditor: { getValue: () => '', setValue: vi.fn() } as unknown as CssEditor,
      save: vi.fn(),
      setStatusMessage: vi.fn(),
      saveThemeCss,
      onThemePreview: vi.fn(),
    });
    document.body.appendChild(panel.element);

    panel.element.querySelector<HTMLButtonElement>('.theme-active-card')!.click();
    const card = [...panel.element.querySelectorAll<HTMLButtonElement>('.theme-gallery .theme-card')]
      .find((element) => element.textContent?.includes('Lab Night'));
    expect(card).toBeDefined();
    card!.click();
    // The gallery opens on the light side of its switch, so a dark deck theme
    // is offered as its generated light counterpart — the same courtesy the
    // built-ins get.
    expect(panel.currentTheme()?.id).toBe('lab-night-light');
    panel.element.querySelector<HTMLButtonElement>('.theme-apply-action button')!.click();

    // The title's own Comic Sans is cleared so it follows theme.css, which now
    // carries the deck theme's title face.
    const title = store.get().deck.slides[0].elements.find((element) => element.id === 'title-1')!;
    expect(title.style['font-family']).toBeUndefined();
    expect(store.get().deck.themeStyle?.fonts.title.family).toBe(deck.customThemes[0].fonts.title.family);
    expect(saveThemeCss).toHaveBeenLastCalledWith(expect.stringContaining(
      `.role-title {\n  font-family: ${deck.customThemes[0].fonts.title.family};`,
    ));
  });

  it('offers the presets of a deck opened after the panel was built', () => {
    // The shells build the panel once, against an empty placeholder deck, and
    // hand it the real deck later through noteDeckOpened. A deck theme must
    // still reach the gallery — this is the path every real session takes.
    const store = new EditorStore(emptyDeck('Placeholder'), '/tmp/theme-panel');
    const panel = createThemePanel({
      store,
      cssEditor: { getValue: () => '', setValue: vi.fn() } as unknown as CssEditor,
      save: vi.fn(),
      setStatusMessage: vi.fn(),
      saveThemeCss: vi.fn(),
      onThemePreview: vi.fn(),
    });
    document.body.appendChild(panel.element);
    const cardIds = () => [...panel.element.querySelectorAll<HTMLElement>('.theme-gallery .theme-card')]
      .map((card) => card.dataset.themeId);
    expect(cardIds()).not.toContain('lab-night');

    const opened = emptyDeck('Opened later');
    opened.customThemes = [{
      id: 'lab-night', name: 'Lab Night', description: '',
      fonts: structuredClone(THEMES[0].fonts),
      palette: ['#e9edf2', '#94a0ad', '#f0a83c'],
      colors: { background: '#12151a', text: '#e9edf2', muted: '#94a0ad', accent: '#f0a83c' },
    }];
    opened.themeSelection = fullThemeSelection('lab-night');
    store.applyRemote(opened, 'open');
    panel.noteDeckOpened(opened);

    // The gallery now lists the deck theme, on the dark side its ground sits on,
    // and the chooser still holds exactly one gallery.
    expect(panel.element.querySelectorAll('.theme-gallery')).toHaveLength(1);
    expect(cardIds()).toContain('lab-night');
    expect(panel.currentTheme()?.id).toBe('lab-night');
    panel.element.querySelector<HTMLButtonElement>('.theme-active-card')!.click();
    expect(panel.element.querySelector('[data-theme-id="lab-night"]')!.classList.contains('selected')).toBe(true);

    // Opening a deck without presets of its own drops the card again.
    const plain = emptyDeck('Plain');
    store.applyRemote(plain, 'open');
    panel.noteDeckOpened(plain);
    expect(panel.element.querySelectorAll('.theme-gallery')).toHaveLength(1);
    expect(cardIds()).not.toContain('lab-night');
  });
});

describe('the theme editor’s type scale', () => {
  it('edits one role’s default size into theme.css on Done, without moving existing slides', () => {
    const deck = emptyDeck('Scale panel');
    deck.themePreset = THEMES[0].id;
    deck.themeStyle = structuredClone({
      fonts: THEMES[0].fonts, palette: THEMES[0].palette, colors: THEMES[0].colors,
    });
    deck.slides[0].elements.push({
      id: 'following', type: 'text', x: 0, y: 0, w: 100, h: 50, rot: 0, z: 1, opacity: 1,
      class: ['role-title'], style: {}, html: 'Following',
      align: 'left', valign: 'top', autoFit: false,
    });
    const store = new EditorStore(deck, '/tmp/theme-panel-scale');
    const saveThemeCss = vi.fn();
    const onPreviewThemeDraft = vi.fn();
    const panel = createThemePanel({
      store,
      cssEditor: { getValue: () => '', setValue: vi.fn() } as unknown as CssEditor,
      save: vi.fn(),
      setStatusMessage: vi.fn(),
      saveThemeCss,
      onPreviewThemeDraft,
    });
    document.body.appendChild(panel.element);
    panel.element.querySelector<HTMLButtonElement>('.theme-edit-button')!.click();

    const sizes = [...panel.element.querySelectorAll<HTMLElement>('.theme-role-size')];
    expect(sizes.map((node) => node.querySelector('span')?.textContent)).toEqual([
      'Title size', 'Body size', 'Caption size', 'Paragraph spacing',
    ]);
    const title = sizes[0].querySelector('input')!;
    const before = THEMES[0].fonts.title.size;
    expect(Number(title.value)).toBe(before);
    title.value = '100';
    title.dispatchEvent(new Event('change', { bubbles: true }));

    // The edit is a draft: previewed on the canvas, not yet on the deck.
    expect(store.get().deck.themeStyle?.fonts.title.size).toBe(before);
    expect((onPreviewThemeDraft.mock.calls.at(-1)?.[0] as { fonts: { title: { size: number } } }).fonts.title.size).toBe(100);
    expect(saveThemeCss).not.toHaveBeenCalled();

    [...panel.element.querySelectorAll<HTMLButtonElement>('.theme-inline-editor button')]
      .find((node) => node.textContent === 'Done')!.click();
    expect(onPreviewThemeDraft).toHaveBeenLastCalledWith(null);
    expect(store.get().deck.themeStyle?.fonts.title.size).toBe(100);
    expect(saveThemeCss).toHaveBeenLastCalledWith(expect.stringMatching(/\.role-title \{[^}]*font-size: 100px/));
    // The existing title kept the size it rendered at; only new slides and an
    // explicit Apply see 100px.
    expect(store.get().deck.slides[0].elements.find((el) => el.id === 'following')?.style)
      .toEqual({ 'font-size': `${before}px` });
    expect(panel.element.querySelector<HTMLElement>('.theme-inline-editor')!.hidden).toBe(true);
  });

  it('throws a draft away on Cancel', () => {
    const deck = emptyDeck('Scale panel');
    deck.themePreset = THEMES[0].id;
    deck.themeStyle = structuredClone({
      fonts: THEMES[0].fonts, palette: THEMES[0].palette, colors: THEMES[0].colors,
    });
    const store = new EditorStore(deck, '/tmp/theme-panel-scale');
    const panel = createThemePanel({
      store,
      cssEditor: { getValue: () => '', setValue: vi.fn() } as unknown as CssEditor,
      save: vi.fn(),
      setStatusMessage: vi.fn(),
      saveThemeCss: vi.fn(),
    });
    document.body.appendChild(panel.element);
    const before = JSON.stringify(store.get().deck);
    panel.element.querySelector<HTMLButtonElement>('.theme-edit-button')!.click();
    const title = panel.element.querySelector<HTMLElement>('.theme-role-size')!.querySelector('input')!;
    title.value = '100';
    title.dispatchEvent(new Event('change', { bubbles: true }));
    [...panel.element.querySelectorAll<HTMLButtonElement>('.theme-inline-editor button')]
      .find((node) => node.textContent === 'Cancel')!.click();
    expect(JSON.stringify(store.get().deck)).toBe(before);
    expect(store.canUndo()).toBe(false);
  });
});

describe('page numbers in the Design tab', () => {
  beforeEach(() => document.body.replaceChildren());

  function openPanel() {
    const store = new EditorStore(emptyDeck('Numbers'), '/tmp/page-numbers');
    const panel = createThemePanel({
      store,
      cssEditor: { getValue: () => '', setValue: vi.fn() } as unknown as CssEditor,
      save: vi.fn(),
      setStatusMessage: vi.fn(),
      saveThemeCss: vi.fn(),
    });
    document.body.appendChild(panel.element);
    const section = () => panel.element.querySelector<HTMLElement>('.page-numbers-section')!;
    const field = (label: string) => [...section().querySelectorAll<HTMLElement>('label')]
      .find((node) => node.querySelector('span')?.textContent?.startsWith(label))!;
    return { store, section, field };
  }

  it('is off by default and turns on with defaults, as one undo step', () => {
    const { store, section, field } = openPanel();
    expect(section().querySelectorAll('select')).toHaveLength(0);
    const show = field('Show page numbers').querySelector('input')!;
    expect(show.checked).toBe(false);

    show.click();
    expect(store.get().deck.pageNumbers).toMatchObject({ position: 'bottom-right', fontSize: 24, hideOnTitle: true });
    expect(field('Position').querySelector('select')!.value).toBe('bottom-right');

    store.undo();
    expect(store.get().deck.pageNumbers).toBeNull();
    expect(section().querySelectorAll('select')).toHaveLength(0);
  });

  it('changes placement, size, format, numbering and title-slide rules', () => {
    const { store, field } = openPanel();
    field('Show page numbers').querySelector('input')!.click();
    const choose = (label: string, value: string) => {
      const select = field(label).querySelector('select')!;
      select.value = value;
      select.dispatchEvent(new Event('change'));
    };
    const type = (label: string, value: string) => {
      const input = field(label).querySelector('input')!;
      input.value = value;
      input.dispatchEvent(new Event('change'));
    };
    choose('Position', 'top-center');
    choose('Format', 'number-of-total');
    type('Size', '40');
    type('Margin', '12');
    type('Start at', '0');
    field('Hide on title slides').querySelector('input')!.click();
    field('Hide on first slide').querySelector('input')!.click();

    expect(store.get().deck.pageNumbers).toEqual({
      position: 'top-center', margin: 12, fontSize: 40, color: null,
      format: 'number-of-total', startAt: 0, hideOnTitle: false, hideOnFirst: true,
    });
    // The rebuilt controls show what was chosen.
    expect(field('Size').querySelector('input')!.value).toBe('40');
    expect(field('Hide on first slide').querySelector('input')!.checked).toBe(true);
  });

  it('turns off again, keeping no settings behind', () => {
    const { store, field } = openPanel();
    field('Show page numbers').querySelector('input')!.click();
    field('Show page numbers').querySelector('input')!.click();
    expect(store.get().deck.pageNumbers).toBeNull();
  });
});

describe('editing a theme size and applying it', () => {
  beforeEach(() => document.body.replaceChildren());

  function openWithBody(element: Record<string, unknown> = {}) {
    const deck = emptyDeck('Sizes');
    deck.slides[0].elements = [{
      id: 'body', type: 'text', x: 0, y: 0, w: 800, h: 200, rot: 0, z: 1, opacity: 1,
      class: ['role-body'], style: {}, html: '<ul><li>one</li><li>two</li></ul>', align: 'left', valign: 'top',
      ...element,
    } as never];
    const store = new EditorStore(deck, '/tmp/theme-sizes');
    let css = '';
    const status: string[] = [];
    const panel = createThemePanel({
      store,
      cssEditor: { getValue: () => css, setValue: (value: string) => { css = value; } } as unknown as CssEditor,
      save: vi.fn(),
      setStatusMessage: (message: string) => status.push(message),
      saveThemeCss: (value: string) => { css = value; },
    });
    document.body.appendChild(panel.element);
    const button = (text: RegExp) => [...panel.element.querySelectorAll<HTMLButtonElement>('button')]
      .find((candidate) => text.test(candidate.textContent ?? ''))!;
    const group = (name: string) => panel.element.querySelector<HTMLInputElement>(`input[data-group="${name}"]`)!;
    const box = () => store.get().deck.slides[0].elements[0] as { style: Record<string, string>; overrides?: string[] };
    const editBodySize = (size: number) => {
      button(/^Edit…$/).click();
      const input = [...panel.element.querySelectorAll<HTMLElement>('label')]
        .find((label) => /^Body size/.test(label.textContent ?? ''))!.querySelector('input')!;
      input.value = String(size);
      input.dispatchEvent(new Event('change'));
      button(/^Done$/).click();
    };
    return { store, button, group, box, editBodySize, status, css: () => css };
  }

  // BUG: Done pinned every box at its old size and Apply, with Type scale off
  // by default, left the pin in place: an edited size never reached a slide.
  it('carries an edited size to the selected slide on the next Apply', () => {
    const { button, group, box, editBodySize, status, css } = openWithBody();
    expect(group('typeScale').checked).toBe(false);
    editBodySize(64);
    // Nothing on screen moves until Apply...
    expect(box().style['font-size']).toBe('48px');
    // ...and Apply is now set up to carry the edit.
    expect(group('typeScale').checked).toBe(true);
    expect(status.at(-1)).toMatch(/click Apply to update existing slides/);

    button(/^Apply theme/).click();
    expect(box().style['font-size']).toBeUndefined();
    expect(css()).toMatch(/\.role-body[^}]*font-size:\s*64px/);
  });

  it('keeps a size set by hand unless asked to replace manual changes', () => {
    const { button, group, box, editBodySize } = openWithBody({ style: { 'font-size': '30px' }, overrides: ['font-size'] });
    editBodySize(64);
    button(/^Apply theme/).click();
    expect(box().style['font-size']).toBe('30px');

    group('replaceAuthored').click();
    button(/^Apply theme/).click();
    expect(box().style['font-size']).toBeUndefined();
    expect(box().overrides).toBeUndefined();
  });
});

describe('paragraph spacing in the Design tab', () => {
  beforeEach(() => document.body.replaceChildren());

  it('is set once in the theme editor and spaces every box without its own', () => {
    const store = new EditorStore(emptyDeck('Spacing'), '/tmp/theme-spacing');
    let css = '';
    const status: string[] = [];
    const panel = createThemePanel({
      store,
      cssEditor: { getValue: () => css, setValue: (value: string) => { css = value; } } as unknown as CssEditor,
      save: vi.fn(),
      setStatusMessage: (message: string) => status.push(message),
      saveThemeCss: (value: string) => { css = value; },
    });
    document.body.appendChild(panel.element);
    const button = (text: RegExp) => [...panel.element.querySelectorAll<HTMLButtonElement>('button')]
      .find((candidate) => text.test(candidate.textContent ?? ''))!;
    button(/^Edit…$/).click();
    const input = panel.element.querySelector<HTMLInputElement>('.theme-paragraph-spacing input')!;
    input.value = '24';
    input.dispatchEvent(new Event('change'));
    button(/^Done$/).click();

    expect(store.get().deck.themeStyle?.paragraphSpacing).toBe(24);
    expect(css).toContain('.element-text:not([data-paragraph-spacing]) { --paragraph-spacing: 24px; }');
    expect(css).toMatch(/\.element-text:not\(\[data-paragraph-spacing\]\) \.text-content > \* \+ \*/);
    expect(status.at(-1)).toMatch(/Paragraph spacing now applies/);
    // Type was not edited, so Apply is left as it was.
    expect(panel.element.querySelector<HTMLInputElement>('input[data-group="typeScale"]')!.checked).toBe(false);

    store.undo();
    expect(store.get().deck.themeStyle?.paragraphSpacing).toBeUndefined();
  });

  it('writes no spacing rules for a theme without spacing, and keeps the spacing across a theme change', () => {
    expect(themeStyleCss(themeStyleOf(THEMES[0]))).not.toContain('paragraph-spacing');
    const deck = emptyDeck('Keep');
    deck.themeStyle = { ...themeStyleOf(THEMES[0]), paragraphSpacing: 18 };
    chooseDeckTheme(deck, THEMES[1]);
    expect(deck.themePreset).toBe(THEMES[1].id);
    expect(deck.themeStyle?.paragraphSpacing).toBe(18);
  });
});

describe('layouts of the deck’s own in the Design tab', () => {
  beforeEach(() => document.body.replaceChildren());

  it('shows them as tiles after the built-ins, each opening the editor on itself', () => {
    const deck = emptyDeck('Tiles');
    deck.customLayouts = [{
      id: 'layout-cover', name: 'Cover', basedOn: 'title', titleSlide: true,
      background: { color: null, image: null }, elements: [],
    }];
    const store = new EditorStore(deck, '/tmp/tiles');
    const onEditLayouts = vi.fn();
    const panel = createThemePanel({
      store,
      cssEditor: { getValue: () => '', setValue: vi.fn() } as unknown as CssEditor,
      save: vi.fn(), setStatusMessage: vi.fn(), saveThemeCss: vi.fn(), onEditLayouts,
    });
    document.body.appendChild(panel.element);
    const tiles = [...panel.element.querySelectorAll<HTMLButtonElement>('.design-master')];
    expect(tiles.map((tile) => tile.querySelector('em')?.textContent)).toEqual(['Freeform', 'Title + Body', 'Title', 'Cover']);
    tiles[3].click();
    expect(onEditLayouts).toHaveBeenCalledWith('layout-cover');
  });
});

describe('the Design tab’s template library', () => {
  const summary = (id: string, name: string) => {
    const design = emptyDeck(name);
    return {
      id, name, source: 'Talk', savedAt: '2026-10-05T00:00:00.000Z', theme: null, layouts: 0,
      design: {
        canvas: design.canvas, themePreset: null, themeStyle: null, themeSelection: null, customThemes: [],
        recentColors: [], pageNumbers: null, layoutMasters: null, customLayouts: [], morphEasing: 'ease-in-out' as const,
      },
    };
  };
  const flush = () => new Promise((settle) => setTimeout(settle, 0));

  it('lists saved templates to pick from, applies the picked one and deletes on a second click', async () => {
    let saved = [summary('looped', 'Looped'), summary('lab', 'Lab talks')];
    const templates = {
      list: vi.fn(async () => saved),
      save: vi.fn(async () => {
        saved = [summary('new', 'New design'), ...saved];
        return true;
      }),
      apply: vi.fn(async () => {}),
      remove: vi.fn(async (id: string) => { saved = saved.filter((template) => template.id !== id); }),
    };
    const panel = createThemePanel({
      store: new EditorStore(emptyDeck('Templates'), '/tmp/templates'),
      cssEditor: { getValue: () => '', setValue: vi.fn() } as unknown as CssEditor,
      save: vi.fn(),
      setStatusMessage: vi.fn(),
      saveThemeCss: vi.fn(),
      templates,
    });
    document.body.appendChild(panel.element);
    await flush();

    const section = panel.element.querySelector<HTMLElement>('.template-section')!;
    const rows = () => [...section.querySelectorAll<HTMLElement>('.template-row')];
    const button = (label: string) => [...section.querySelectorAll<HTMLButtonElement>('button')]
      .find((candidate) => candidate.textContent?.startsWith(label))!;
    expect(rows().map((row) => row.dataset.templateId)).toEqual(['looped', 'lab']);
    expect(button('Apply to this deck').disabled).toBe(true);

    rows()[1].click();
    expect(rows()[1].classList.contains('selected')).toBe(true);
    button('Apply to this deck').click();
    expect(templates.apply).toHaveBeenCalledWith('lab');

    button('Delete').click();
    expect(templates.remove).not.toHaveBeenCalled();
    button('Click again').click();
    await flush();
    expect(templates.remove).toHaveBeenCalledWith('lab');
    expect(rows().map((row) => row.dataset.templateId)).toEqual(['looped']);

    button('Save this design').click();
    await flush();
    expect(rows().map((row) => row.dataset.templateId)).toEqual(['new', 'looped']);
  });

  it('is left out where templates are not kept', () => {
    const panel = createThemePanel({
      store: new EditorStore(emptyDeck('No templates'), '/tmp/none'),
      cssEditor: { getValue: () => '', setValue: vi.fn() } as unknown as CssEditor,
      save: vi.fn(),
      setStatusMessage: vi.fn(),
      saveThemeCss: vi.fn(),
    });
    expect(panel.element.querySelector('.template-section')).toBeNull();
  });
});
