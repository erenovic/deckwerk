import { type ChildProcess } from 'node:child_process';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { saveDeck } from '../src/main/deckStore.js';
import { emptyDeck } from '../src/shared/deck.js';
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
 * View › Show Grid in the real desktop app: the application menu carries the
 * item with its ⌘' key, the key shows the grid in the editor and ticks the
 * item, and choosing the item from the menu hides it again. The main process
 * is read over its Node inspector, since the menu lives there.
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

interface GridItem { label: string; checked: boolean; accelerator: string | null }

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

const GRID_ITEM = `(() => {
  const { Menu } = require('electron');
  const view = Menu.getApplicationMenu()?.items.find((item) => item.label === 'View');
  const grid = view?.submenu?.getMenuItemById('show-grid');
  return grid ? { label: grid.label, checked: grid.checked, accelerator: grid.accelerator ?? null } : null;
})()`;

describe.skipIf(!electronBinary)('View › Show Grid in the desktop app', () => {
  it('toggles the editor grid from the key and from the menu, keeping the checkmark in step', {
    retry: 2,
    timeout: 120_000,
  }, async () => {
    workDir = await mkdtemp(join(tmpdir(), 'deckwerk-view-grid-'));
    const appDir = join(workDir, 'app');
    const deckDir = join(workDir, 'deck');
    const profileDir = join(workDir, 'electron-profile');
    await mkdir(appDir, { recursive: true });
    await mkdir(profileDir, { recursive: true });
    await materializeDesktopApp(appDir, 'deckwerk-view-grid-test');
    await saveDeck(deckDir, emptyDeck('Grid'));

    const inspectPort = await freePort();
    const app = await launchDesktopApp(appDir, [`--inspect=${inspectPort}`, deckDir], { profileDir });
    appProcess = app.process;
    const target = await findTarget(app.debugPort, isEditorTarget, app.log, 20_000);
    editor = await Cdp.connect(target.webSocketDebuggerUrl!);
    const inspector = await eventually(async () => {
      const list = await (await fetch(`http://127.0.0.1:${inspectPort}/json/list`)).json() as Array<{ webSocketDebuggerUrl: string }>;
      return list[0]?.webSocketDebuggerUrl ?? null;
    }, 'the main process inspector never came up', (url) => url !== null);
    main = await Cdp.connect(inspector!);
    await eventually(async () => editor!.evaluate<boolean>(
      'Boolean(document.querySelector("#canvas .stage .slide"))'), 'the editor never loaded');

    const item = await eventually(async () => inMain<GridItem | null>(GRID_ITEM),
      'View › Show Grid is not in the application menu', (value) => value !== null);
    expect(item).toEqual({ label: 'Show Grid', checked: false, accelerator: "CmdOrCtrl+'" });
    const shown = () => editor!.evaluate<boolean>('Boolean(document.querySelector("#canvas .stage > .canvas-grid"))');
    expect(await shown()).toBe(false);

    // The key, pressed in the editor: the grid appears and the menu follows.
    await editor.chord("'", 'Quote', 222, process.platform === 'darwin' ? 4 : 2);
    await eventually(shown, 'the key did not show the grid', (value) => value);
    await eventually(async () => (await inMain<GridItem | null>(GRID_ITEM))?.checked,
      'the menu did not tick Show Grid', (value) => value === true);

    // The menu item, chosen: the grid goes away and the tick with it.
    await inMain(`(() => {
      require('electron').Menu.getApplicationMenu().getMenuItemById('show-grid').click();
      return true;
    })()`);
    await eventually(shown, 'choosing the menu item did not hide the grid', (value) => !value);
    await eventually(async () => (await inMain<GridItem | null>(GRID_ITEM))?.checked,
      'the menu kept its tick', (value) => value === false);
  });
});
