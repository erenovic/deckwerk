import { BrowserWindow, Menu, type MenuItemConstructorOptions } from 'electron';
import { IPC } from '@shared/ipc.js';

/**
 * The application menu: Electron's default menu, so Edit's copy and paste,
 * reload, zoom and full screen keep working exactly as before, plus the
 * editor's own View items.
 *
 * Show Grid's checkmark is owned by the editor window (it remembers the
 * choice), which reports it through `setShowGridChecked`. The ⌘' key is
 * handled by the page itself so it also works while text is being edited;
 * the menu shows it and handles a click. Arrange's ⌘G and ⇧⌘G are the
 * page's keys in the same way. File's template items open the editor's own
 * template dialogs.
 */

const SHOW_GRID_ID = 'show-grid';
let showGridChecked = false;
const PANEL_IDS = { rail: 'show-slide-list', side: 'show-sidebar' } as const;
let panelsChecked = { rail: true, side: true };

/** The window a menu item was used from, which receives its command. */
function menuTarget(window: unknown): BrowserWindow | undefined {
  return (window as BrowserWindow | undefined)
    ?? BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
}

export function installAppMenu(): void {
  const isMac = process.platform === 'darwin';
  const template: MenuItemConstructorOptions[] = [
    ...(isMac ? [{ role: 'appMenu' as const }] : []),
    {
      label: 'File',
      submenu: [
        {
          label: 'New from Template…',
          click: (_item, window) => menuTarget(window)?.webContents.send(IPC.templateCommand, 'new'),
        },
        { type: 'separator' },
        {
          label: 'Save as Template…',
          click: (_item, window) => menuTarget(window)?.webContents.send(IPC.templateCommand, 'save'),
        },
        {
          label: 'Apply Template…',
          click: (_item, window) => menuTarget(window)?.webContents.send(IPC.templateCommand, 'apply'),
        },
        { type: 'separator' },
        isMac ? { role: 'close' } : { role: 'quit' },
      ],
    },
    { role: 'editMenu' },
    {
      label: 'View',
      submenu: [
        {
          id: SHOW_GRID_ID,
          label: 'Show Grid',
          type: 'checkbox',
          checked: showGridChecked,
          accelerator: "CmdOrCtrl+'",
          registerAccelerator: false,
          // The window the menu was used from; a presenter window has no grid
          // and ignores the message.
          click: (_item, window) => menuTarget(window)?.webContents.send(IPC.viewToggleGrid),
        },
        { type: 'separator' },
        // Like the grid, ⌥⌘1 and ⌥⌘2 are the page's keys; the menu follows.
        {
          id: PANEL_IDS.rail,
          label: 'Show Slide List',
          type: 'checkbox',
          checked: panelsChecked.rail,
          accelerator: 'Alt+CmdOrCtrl+1',
          registerAccelerator: false,
          click: (_item, window) => menuTarget(window)?.webContents.send(IPC.viewTogglePanel, 'rail'),
        },
        {
          id: PANEL_IDS.side,
          label: 'Show Sidebar',
          type: 'checkbox',
          checked: panelsChecked.side,
          accelerator: 'Alt+CmdOrCtrl+2',
          registerAccelerator: false,
          click: (_item, window) => menuTarget(window)?.webContents.send(IPC.viewTogglePanel, 'side'),
        },
        { type: 'separator' },
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    {
      label: 'Arrange',
      submenu: [
        {
          label: 'Group',
          accelerator: 'CmdOrCtrl+G',
          registerAccelerator: false,
          click: (_item, window) => menuTarget(window)?.webContents.send(IPC.arrangeCommand, 'group'),
        },
        {
          label: 'Ungroup',
          accelerator: 'Shift+CmdOrCtrl+G',
          registerAccelerator: false,
          click: (_item, window) => menuTarget(window)?.webContents.send(IPC.arrangeCommand, 'ungroup'),
        },
      ],
    },
    { role: 'windowMenu' },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

/** Reflect the editor's grid state in the View menu. */
export function setShowGridChecked(checked: boolean): void {
  showGridChecked = checked;
  const item = Menu.getApplicationMenu()?.getMenuItemById(SHOW_GRID_ID);
  if (item) item.checked = checked;
}

/** Reflect which editor panels are showing in the View menu. */
export function setPanelsChecked(shown: { rail: boolean; side: boolean }): void {
  panelsChecked = { rail: shown.rail !== false, side: shown.side !== false };
  for (const panel of ['rail', 'side'] as const) {
    const item = Menu.getApplicationMenu()?.getMenuItemById(PANEL_IDS[panel]);
    if (item) item.checked = panelsChecked[panel];
  }
}
