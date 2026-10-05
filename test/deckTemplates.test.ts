import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { emptyDeck, parseDeck, type CustomLayout, type Deck } from '../src/shared/deck.js';
import {
  applyTemplateToDeck,
  deckFromTemplate,
  designAssets,
  handWrittenCss,
  templateFromDeck,
  templateId,
} from '../src/shared/deckTemplates.js';
import { placeholderFor } from '../src/renderer/editor/layoutEditorModel.js';
import { defaultLayoutMasters } from '../src/shared/layoutMasters.js';
import { THEME_BLOCK_START, chooseDeckTheme, themeById, themeStyleCss, withThemeBlock } from '../src/shared/themes.js';
import {
  createDeckFromTemplate,
  listTemplates,
  readTemplate,
  saveTemplate,
  TemplateExistsError,
} from '../src/main/templateStore.js';
import { loadDeck, saveDeck } from '../src/main/deckStore.js';
import { EXIT_ERROR, EXIT_OK, runAgentCli } from '../src/cli/agentCli.js';

/**
 * Deck templates: a design saved apart from its slides, a deck started from
 * it, and a deck that takes it on -- from the model, the store and the CLI.
 */

const CANVAS = { w: 1920, h: 1080 };

/** A deck with a look worth keeping: a theme, its own title layout, page numbers, CSS rules. */
function designedDeck(): { deck: Deck; css: string } {
  const deck = emptyDeck('Looped Transformer');
  chooseDeckTheme(deck, themeById('noir')!);
  const title: CustomLayout = {
    id: 'lt-title',
    name: 'Title slide',
    basedOn: 'title',
    titleSlide: true,
    background: { color: '#101820', image: 'assets/backdrop.png' },
    elements: [placeholderFor('title', CANVAS, 1), placeholderFor('subtitle', CANVAS, 2)],
  };
  const content: CustomLayout = {
    id: 'lt-content',
    name: 'Kicker + Title',
    basedOn: 'standard',
    titleSlide: false,
    background: { color: null, image: null },
    elements: [placeholderFor('caption', CANVAS, 1), placeholderFor('title', CANVAS, 2)],
  };
  deck.layoutMasters = defaultLayoutMasters();
  deck.customLayouts = [title, content];
  deck.pageNumbers = {
    position: 'bottom-right', margin: 40, fontSize: 32, color: null, format: 'number',
    startAt: 0, hideOnTitle: true, hideOnFirst: false,
  };
  const css = withThemeBlock('.kicker { letter-spacing: .2em; }\n', themeStyleCss(deck.themeStyle!));
  return { deck: parseDeck(deck), css };
}

describe('a template, as data', () => {
  it('names a template file-safely', () => {
    expect(templateId('Looped Transformer — v2!')).toBe('looped-transformer-v2');
    expect(templateId('Été')).toBe('ete');
    expect(templateId('???')).toBe('template');
  });

  it('keeps the design and leaves the slides behind', () => {
    const { deck, css } = designedDeck();
    deck.slides[0].notes = 'secret talk';
    const template = templateFromDeck(deck, css, 'Looped Transformer');
    expect(template.design.customLayouts.map((layout) => layout.id)).toEqual(['lt-title', 'lt-content']);
    expect(template.design.pageNumbers?.fontSize).toBe(32);
    expect(template.design.themePreset).toBe('noir');
    expect(JSON.stringify(template)).not.toContain('secret talk');
    expect(template.assets).toEqual(['assets/backdrop.png']);
  });

  it('finds the files a design and its stylesheet refer to', () => {
    const { deck } = designedDeck();
    const design = templateFromDeck(deck, '', 'x').design;
    expect(designAssets(design, "@font-face { src: url('assets/fonts/Avenir.woff2'); }"))
      .toEqual(['assets/backdrop.png', 'assets/fonts/Avenir.woff2']);
  });

  it('tells the author’s CSS from the generated block', () => {
    const { css } = designedDeck();
    expect(handWrittenCss(css)).toBe('.kicker { letter-spacing: .2em; }');
  });

  it('starts a deck on the template’s own title layout, wearing its design', () => {
    const { deck, css } = designedDeck();
    const made = deckFromTemplate(templateFromDeck(deck, css, 'Looped'), 'My next talk');
    expect(made.deck.title).toBe('My next talk');
    expect(made.deck.slides).toHaveLength(1);
    expect(made.deck.slides[0].layout).toBe('lt-title');
    expect(made.deck.slides[0].background.color).toBe('#101820');
    expect(made.deck.slides[0].elements.map((element) => element.type === 'text' && element.layoutPlaceholder))
      .toEqual(['title', 'subtitle']);
    expect(made.deck.themeStyle).toEqual(deck.themeStyle);
    expect(made.css).toBe(css);
  });

  it('dresses an existing deck: theme on every slide, layouts joined, title slide moved', () => {
    const { deck: source, css } = designedDeck();
    const template = templateFromDeck(source, css, 'Looped');
    const deck = emptyDeck('Old talk');
    deck.slides[0].layout = 'title';
    deck.slides[0].elements = [{
      id: 'old-title', type: 'text', x: 100, y: 100, w: 800, h: 200, rot: 0, z: 1, opacity: 1,
      class: ['role-title'], style: { 'font-family': 'Comic Sans MS', 'font-size': '96px' },
      html: 'Old title', align: 'left', valign: 'top',
    }];
    deck.customLayouts = [{ ...template.design.customLayouts[1], id: 'old-own', name: 'Mine' }];
    const out = applyTemplateToDeck(deck, template, '.old { color: red; }\n');

    expect(deck.themeStyle).toEqual(source.themeStyle);
    expect(deck.pageNumbers).toEqual(source.pageNumbers);
    expect(deck.customLayouts.map((layout) => layout.id)).toEqual(['old-own', 'lt-title', 'lt-content']);
    expect(deck.slides[0].layout).toBe('lt-title');
    // The theme reaches the slide: its own inline type gives way to the stylesheet.
    const title = deck.slides[0].elements.find((element) => element.id === 'old-title');
    expect(title?.style['font-family']).toBeUndefined();
    // The deck's rules first, then the template's, then the generated block.
    const own = handWrittenCss(out);
    expect(own.indexOf('.old')).toBeLessThan(own.indexOf('.kicker'));
    expect(out).toContain(THEME_BLOCK_START);
    expect(out.indexOf('.kicker')).toBeLessThan(out.indexOf(THEME_BLOCK_START));
  });
});

describe('templates on disk', () => {
  let root: string;
  let previous: string | undefined;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'deckwerk-templates-'));
    previous = process.env.DECKWERK_TEMPLATES_DIR;
    process.env.DECKWERK_TEMPLATES_DIR = join(root, 'templates');
  });

  afterEach(async () => {
    if (previous === undefined) delete process.env.DECKWERK_TEMPLATES_DIR;
    else process.env.DECKWERK_TEMPLATES_DIR = previous;
    await rm(root, { recursive: true, force: true });
  });

  async function sourceDeck(): Promise<string> {
    const dir = join(root, 'source');
    const { deck, css } = designedDeck();
    await mkdir(join(dir, 'assets'), { recursive: true });
    await writeFile(join(dir, 'assets', 'backdrop.png'), 'png bytes');
    await writeFile(join(dir, 'theme.css'), css);
    await saveDeck(dir, deck);
    return dir;
  }

  it('saves, lists and reads a template, with its files', async () => {
    const dir = await sourceDeck();
    const { deck, css } = designedDeck();
    await saveTemplate(dir, deck, css, 'Looped Transformer');
    const [listed] = await listTemplates();
    expect(listed).toMatchObject({ id: 'looped-transformer', name: 'Looped Transformer', layouts: 2, theme: 'Noir' });
    expect((await readTemplate('looped-transformer')).css).toBe(css);
    expect(await readFile(join(root, 'templates', 'looped-transformer', 'assets', 'backdrop.png'), 'utf8')).toBe('png bytes');
  });

  it('asks before replacing a template of the same name', async () => {
    const dir = await sourceDeck();
    const { deck, css } = designedDeck();
    await saveTemplate(dir, deck, css, 'Looped');
    await expect(saveTemplate(dir, deck, '/* new */', 'Looped')).rejects.toBeInstanceOf(TemplateExistsError);
    await saveTemplate(dir, deck, '/* new */', 'Looped', { replace: true });
    expect((await readTemplate('looped')).css).toBe('/* new */');
  });

  it('creates a deck folder from a template, and never over an existing one', async () => {
    const dir = await sourceDeck();
    const { deck, css } = designedDeck();
    const template = await saveTemplate(dir, deck, css, 'Looped');
    const target = join(root, 'next-talk');
    await createDeckFromTemplate(target, template, 'Next talk');
    const made = await loadDeck(target);
    expect(made.slides[0].layout).toBe('lt-title');
    expect(await readFile(join(target, 'theme.css'), 'utf8')).toBe(css);
    expect(existsSync(join(target, 'assets', 'backdrop.png'))).toBe(true);
    await expect(createDeckFromTemplate(target, template, 'Again')).rejects.toThrow(/already contains/);
  });

  it('refuses a template id that would leave the templates folder', async () => {
    await expect(readTemplate('../outside')).rejects.toThrow(/Not a template id/);
  });

  describe('slide-agent template', () => {
    const cli = async (cwd: string, ...argv: string[]) => {
      const out: string[] = [];
      const err: string[] = [];
      const code = await runAgentCli(argv, { out: (chunk) => out.push(chunk), err: (chunk) => err.push(chunk), cwd });
      return { code, stdout: out.join(''), stderr: err.join('') };
    };
    let stateBefore: string | undefined;

    beforeEach(() => {
      // No live editor: every command works on the folders directly.
      stateBefore = process.env.DECKWERK_STATE_DIR;
      process.env.DECKWERK_STATE_DIR = join(root, 'state');
    });

    afterEach(() => {
      if (stateBefore === undefined) delete process.env.DECKWERK_STATE_DIR;
      else process.env.DECKWERK_STATE_DIR = stateBefore;
    });

    it('saves, lists, starts a deck from and applies a template', async () => {
      const dir = await sourceDeck();
      const saved = await cli(dir, 'template', 'save', '--name', 'Looped');
      expect(saved.code).toBe(EXIT_OK);
      expect(JSON.parse(saved.stdout)).toMatchObject({ status: 'saved', template: { id: 'looped' } });
      expect((await cli(dir, 'template', 'save', '--name', 'Looped')).code).toBe(EXIT_ERROR);

      const listed = JSON.parse((await cli(dir, 'template', 'list')).stdout);
      expect(listed.templates.map((template: { id: string }) => template.id)).toEqual(['looped']);
      expect(listed.templates[0]).not.toHaveProperty('design');

      const created = await cli(root, 'template', 'new', 'talk', '--template', 'looped', '--title', 'A talk');
      expect(JSON.parse(created.stdout)).toMatchObject({ status: 'created', slides: 1 });
      expect((await loadDeck(join(root, 'talk'))).title).toBe('A talk');

      const other = join(root, 'other');
      await mkdir(other, { recursive: true });
      await saveDeck(other, emptyDeck('Other'));
      await writeFile(join(other, 'theme.css'), '.mine { color: red; }\n');
      const applied = await cli(other, 'template', 'apply', '--template', 'looped');
      expect(applied.code).toBe(EXIT_OK);
      const restyled = await loadDeck(other);
      expect(restyled.customLayouts.map((layout) => layout.id)).toEqual(['lt-title', 'lt-content']);
      const css = await readFile(join(other, 'theme.css'), 'utf8');
      expect(css).toContain('.mine');
      expect(css).toContain('.kicker');
    });
  });
});
