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
 * A narrow editor window, as macOS Split View makes one: the window may
 * shrink to half a laptop screen (Split View tiles only windows that can),
 * the page then fits it with nothing pushed off the edge, and the slide list
 * and sidebar can be put away -- from their buttons, their keys and the View
 * menu, whose checkmarks follow -- leaving the slide the whole window.
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

const PANEL_ITEMS = `(() => {
  const menu = require('electron').Menu.getApplicationMenu();
  return ['show-slide-list', 'show-sidebar'].map((id) => {
    const item = menu.getMenuItemById(id);
    return item ? { label: item.label, checked: item.checked, accelerator: item.accelerator ?? null } : null;
  });
})()`;

interface PanelItem { label: string; checked: boolean; accelerator: string | null }

describe.skipIf(!electronBinary)('a narrow editor window', () => {
  it('fits half a screen and hides the slide list and sidebar on request', {
    retry: 2,
    timeout: 120_000,
  }, async () => {
    workDir = await mkdtemp(join(tmpdir(), 'deckwerk-split-view-'));
    const appDir = join(workDir, 'app');
    const deckDir = join(workDir, 'deck');
    const profileDir = join(workDir, 'electron-profile');
    await mkdir(appDir, { recursive: true });
    await mkdir(profileDir, { recursive: true });
    await materializeDesktopApp(appDir, 'deckwerk-split-view-test');
    await saveDeck(deckDir, emptyDeck('Split'));

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
    // The deck itself, not the welcome screen (which hides both panels).
    await eventually(async () => editor!.evaluate<boolean>(
      'Boolean(document.querySelector("#canvas .stage .slide")) && !document.body.classList.contains("welcome-mode")'),
    'the editor never opened the deck');

    if (process.platform === 'darwin') {
      const [minimum] = await inMain<Array<[number, number]>>(
        "require('electron').BrowserWindow.getAllWindows().map((win) => win.getMinimumSize())");
      expect(minimum[0]).toBeLessThanOrEqual(600);
    }

    // Half of a 1280pt screen: everything is inside the window.
    await inMain("require('electron').BrowserWindow.getAllWindows().forEach((win) => win.setSize(600, 820)) || true");
    const fits = () => editor!.evaluate<boolean>(`(() => {
      const inside = (selector) => document.querySelector(selector).getBoundingClientRect().right <= innerWidth + 0.5;
      return innerWidth <= 600 && document.documentElement.scrollWidth <= innerWidth
        && inside('#side') && inside('.toolbar-split-button');
    })()`);
    await eventually(fits, 'the editor does not fit a 600px window', (value) => value);

    const shown = () => editor!.evaluate<{ rail: boolean; side: boolean }>(`({
      rail: getComputedStyle(document.getElementById('rail')).display !== 'none',
      side: getComputedStyle(document.getElementById('side')).display !== 'none',
    })`);
    expect(await shown()).toEqual({ rail: true, side: true });
    expect((await inMain<PanelItem[]>(PANEL_ITEMS)).map((item) => [item.label, item.checked, item.accelerator]))
      .toEqual([['Show Slide List', true, 'Alt+CmdOrCtrl+1'], ['Show Sidebar', true, 'Alt+CmdOrCtrl+2']]);

    // The key hides the slide list, and the menu's tick follows.
    const mod = process.platform === 'darwin' ? 4 : 2;
    await editor.chord('1', 'Digit1', 49, mod | 1);
    await eventually(shown, 'the key did not hide the slide list', (value) => !value.rail && value.side);
    await eventually(async () => (await inMain<PanelItem[]>(PANEL_ITEMS))[0].checked,
      'the menu kept its tick', (checked) => checked === false);

    // The menu hides the sidebar: the slide has the whole window.
    await inMain("require('electron').Menu.getApplicationMenu().getMenuItemById('show-sidebar').click() || true");
    await eventually(shown, 'the menu did not hide the sidebar', (value) => !value.rail && !value.side);
    await eventually(async () => editor!.evaluate<boolean>(
      'Math.abs(document.getElementById("canvas").getBoundingClientRect().width - innerWidth) < 1'),
    'the canvas did not take the freed width', (value) => value);

    // The canvas button brings the slide list back.
    await editor.click('.panel-toggle-rail', 'slide list toggle');
    await eventually(shown, 'the button did not show the slide list', (value) => value.rail && !value.side);
  });
});
