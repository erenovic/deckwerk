import { type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { emptyDeck, parseDeck, type CustomLayout } from '../src/shared/deck.js';
import { placeholderFor } from '../src/renderer/editor/layoutEditorModel.js';
import { saveTemplate } from '../src/main/templateStore.js';
import {
  Cdp,
  electronBinary,
  eventually,
  findTarget,
  freePort,
  stopBrowser,
} from './support/browserSession.js';
import { isEditorTarget, launchDesktopApp, materializeDesktopApp } from './support/desktopApp.js';

/**
 * Deck templates in the real desktop app: the welcome screen starts a deck
 * from a saved template (through the template picker and the native folder
 * panel), File › Save as Template keeps the open deck's design under a new
 * name, and File › Apply Template dresses the deck in one. The menu lives in
 * the main process, driven over its Node inspector; the native panel is
 * scripted.
 */

let workDir = '';
let appProcess: ChildProcess | null = null;
let editor: Cdp | null = null;
let main: Cdp | null = null;

afterEach(async () => {
  editor?.close();
  editor = null;
  main?.close();
  main = null;
  await stopBrowser(appProcess);
  appProcess = null;
  if (workDir) await rm(workDir, { recursive: true, force: true });
  workDir = '';
});


/**
 * Evaluate in the main process. Its console's command-line API provides
 * `require`, which an ES-module main process otherwise lacks there.
 */
async function inMain<T>(expression: string): Promise<T> {
  const result = await main!.call('Runtime.evaluate', {
    expression, includeCommandLineAPI: true, awaitPromise: true, returnByValue: true,
  });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? 'main evaluation failed');
  return result.result?.value as T;
}

function fileItem(label: string): string {
  return `(() => {
    const file = require('electron').Menu.getApplicationMenu().items.find((item) => item.label === 'File');
    file.submenu.items.find((item) => item.label === ${JSON.stringify(label)}).click();
    return true;
  })()`;
}

const FILE_ITEMS = `(() => {
  const file = require('electron').Menu.getApplicationMenu()?.items.find((item) => item.label === 'File');
  return file ? file.submenu.items.filter((item) => item.label).map((item) => item.label) : null;
})()`;

describe.skipIf(!electronBinary)('deck templates in the desktop app', () => {
  it('starts a deck from a template, saves its design and applies one', {
    retry: 2,
    timeout: 120_000,
  }, async () => {
    workDir = await mkdtemp(join(tmpdir(), 'deckwerk-templates-'));
    const appDir = join(workDir, 'app');
    const profileDir = join(workDir, 'electron-profile');
    const templates = join(workDir, 'templates');
    const dialogs = join(workDir, 'dialogs.json');
    await mkdir(appDir, { recursive: true });
    await mkdir(profileDir, { recursive: true });
    await materializeDesktopApp(appDir, 'deckwerk-templates-test');

    // A saved design with its own title layout.
    const source = emptyDeck('Looped');
    const title: CustomLayout = {
      id: 'lt-title', name: 'Title slide', basedOn: 'title', titleSlide: true,
      background: { color: '#101820', image: null },
      elements: [placeholderFor('title', source.canvas, 1)],
    };
    source.customLayouts = [title];
    const previous = process.env.DECKWERK_TEMPLATES_DIR;
    process.env.DECKWERK_TEMPLATES_DIR = templates;
    try {
      await saveTemplate(workDir, parseDeck(source), '.kicker { letter-spacing: .2em; }\n', 'Looped');
    } finally {
      if (previous === undefined) delete process.env.DECKWERK_TEMPLATES_DIR;
      else process.env.DECKWERK_TEMPLATES_DIR = previous;
    }

    const target = join(workDir, 'Next talk');
    await writeFile(dialogs, JSON.stringify([{ canceled: false, filePath: target }]), 'utf8');
    const inspectPort = await freePort();
    const app = await launchDesktopApp(appDir, [`--inspect=${inspectPort}`], {
      profileDir,
      env: { DECKWERK_TEMPLATES_DIR: templates, DECKWERK_TEST_DIALOGS: dialogs },
    });
    appProcess = app.process;
    const editorTarget = await findTarget(app.debugPort, isEditorTarget, app.log, 20_000);
    editor = await Cdp.connect(editorTarget.webSocketDebuggerUrl!);
    const inspector = await eventually(async () => {
      const list = await (await fetch(`http://127.0.0.1:${inspectPort}/json/list`)).json() as Array<{ webSocketDebuggerUrl: string }>;
      return list[0]?.webSocketDebuggerUrl ?? null;
    }, 'the main process inspector never came up', (url) => url !== null);
    main = await Cdp.connect(inspector!);

    expect(await eventually(async () => inMain<string[] | null>(FILE_ITEMS),
      'File has no template items', (value) => value !== null))
      .toEqual(expect.arrayContaining(['New from Template…', 'Save as Template…', 'Apply Template…']));

    // New from template, from the welcome screen: pick it, then the folder.
    await eventually(async () => editor!.evaluate<boolean>(
      'Boolean(document.querySelector(".welcome-action[data-action=\\"template\\"]"))'), 'no welcome template action');
    await editor.click('.welcome-action[data-action="template"]', 'New from template');
    await eventually(async () => editor!.evaluate<number>('document.querySelectorAll(".template-row").length'),
      'the picker listed no template', (count) => count === 1);
    await editor.click('.template-picker button.primary', 'Create deck…');
    await eventually(async () => existsSync(join(target, 'deck.json')), 'no deck was created');
    const created = parseDeck(JSON.parse(await readFile(join(target, 'deck.json'), 'utf8')));
    expect(created.slides[0].layout).toBe('lt-title');
    expect(await readFile(join(target, 'theme.css'), 'utf8')).toContain('.kicker');
    await eventually(async () => editor!.evaluate<boolean>(
      'Boolean(document.querySelector("#canvas .stage .slide")) && !document.querySelector(".welcome-screen:not([hidden])")'),
    'the new deck did not open');

    // File › Save as Template, under a new name.
    await inMain(fileItem('Save as Template…'));
    await eventually(async () => editor!.evaluate<boolean>('Boolean(document.querySelector(".template-name input"))'),
      'no name dialog');
    await editor.evaluate(`(() => {
      const input = document.querySelector('.template-name input');
      input.value = 'Second design';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    })()`);
    await editor.click('.template-name button.primary', 'Save template');
    await eventually(async () => existsSync(join(templates, 'second-design', 'template.json')),
      'Save as Template wrote nothing');

    // File › Apply Template: both are offered; applying lands with a message.
    await inMain(fileItem('Apply Template…'));
    await eventually(async () => editor!.evaluate<number>('document.querySelectorAll(".template-row").length'),
      'the picker did not list both templates', (count) => count === 2);
    await editor.click('.template-picker button.primary', 'Apply');
    await eventually(async () => editor!.evaluate<string>('document.getElementById("status")?.textContent ?? ""'),
      'Apply Template reported nothing', (text) => text.includes('Applied template'));

    // The Design tab lists the library too: both templates, pick one, apply.
    await editor.click('#side-tabs button[data-panel="themePanel"]', 'Design tab');
    await eventually(async () => editor!.evaluate<number>(
      'document.querySelectorAll(".design-template-list .template-row").length'),
    'the Design tab did not list both templates', (count) => count === 2);
    await editor.evaluate(`(() => {
      document.querySelector('.design-template-list .template-row[data-template-id="looped"]').click();
      return true;
    })()`);
    await editor.evaluate(`(() => {
      const apply = [...document.querySelectorAll('.template-section button')]
        .find((button) => button.textContent === 'Apply to this deck');
      apply.click();
      return true;
    })()`);
    await eventually(async () => editor!.evaluate<string>('document.getElementById("status")?.textContent ?? ""'),
      'applying from the Design tab reported nothing', (text) => text.includes('Applied template “Looped”'));
  });
});
