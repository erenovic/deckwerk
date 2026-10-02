import { type ChildProcess } from 'node:child_process';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { saveDeck } from '../src/main/deckStore.js';
import { emptyDeck, type SlideElement } from '../src/shared/deck.js';
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
 * Arrange › Group and Ungroup in the real desktop app: the application menu
 * carries both items with their keys, choosing Group frames the selection as
 * one group in the editor, and ⇧⌘G takes it apart again. The main process is
 * driven over its Node inspector, since the menu lives there.
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

const ARRANGE_ITEMS = `(() => {
  const { Menu } = require('electron');
  const arrange = Menu.getApplicationMenu()?.items.find((item) => item.label === 'Arrange');
  return arrange ? arrange.submenu.items.map((item) => [item.label, item.accelerator ?? null]) : null;
})()`;

const box = (id: string, x: number): SlideElement => ({
  id, type: 'shape', x, y: 300, w: 300, h: 200, rot: 0, z: 1, opacity: 1, class: [], style: {},
  shape: 'rect', fill: '#dbeafe', stroke: '#2563eb', strokeWidth: 4, radius: 0, path: null,
  pathSize: null, arrowStart: false, arrowEnd: false,
});

describe.skipIf(!electronBinary)('Arrange › Group in the desktop app', () => {
  it('groups from the menu and ungroups from the key', {
    retry: 2,
    timeout: 120_000,
  }, async () => {
    workDir = await mkdtemp(join(tmpdir(), 'deckwerk-arrange-'));
    const appDir = join(workDir, 'app');
    const deckDir = join(workDir, 'deck');
    const profileDir = join(workDir, 'electron-profile');
    await mkdir(appDir, { recursive: true });
    await mkdir(profileDir, { recursive: true });
    await materializeDesktopApp(appDir, 'deckwerk-arrange-test');
    const deck = emptyDeck('Groups');
    deck.slides[0].elements = [box('left-box', 200), box('right-box', 800)];
    await saveDeck(deckDir, deck);

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
      'Boolean(document.querySelector("#canvas .stage [data-element-id=\\"right-box\\"]"))'), 'the editor never loaded');

    const items = await eventually(async () => inMain<Array<[string, string | null]> | null>(ARRANGE_ITEMS),
      'Arrange is not in the application menu', (value) => value !== null);
    expect(items).toEqual([['Group', 'CmdOrCtrl+G'], ['Ungroup', 'Shift+CmdOrCtrl+G']]);

    const mod = process.platform === 'darwin' ? 4 : 2;
    const frames = () => editor!.evaluate<number>('document.querySelectorAll("#canvas .group-frame").length');
    await editor.chord('a', 'KeyA', 65, mod);
    await eventually(async () => editor!.evaluate<number>(
      'document.querySelectorAll("#canvas .sel-box").length'), 'select all took nothing', (count) => count === 2);

    // The menu item, chosen: the two boxes become one framed group.
    await inMain(`(() => {
      const arrange = require('electron').Menu.getApplicationMenu().items.find((item) => item.label === 'Arrange');
      arrange.submenu.items.find((item) => item.label === 'Group').click();
      return true;
    })()`);
    await eventually(frames, 'choosing Group did not frame the selection', (count) => count === 1);

    // The key, pressed in the editor: the group comes apart.
    await editor.chord('g', 'KeyG', 71, mod | 8);
    await eventually(frames, 'Shift+Cmd+G did not ungroup', (count) => count === 0);
  });
});
