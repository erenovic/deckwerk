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
 * the menu shows it and handles a click.
 */

const SHOW_GRID_ID = 'show-grid';
let showGridChecked = false;

export function installAppMenu(): void {
  const isMac = process.platform === 'darwin';
  const template: MenuItemConstructorOptions[] = [
    ...(isMac ? [{ role: 'appMenu' as const }] : []),
    { role: 'fileMenu' },
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
          click: (_item, window) => {
            const target = (window as BrowserWindow | undefined)
              ?? BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
            target?.webContents.send(IPC.viewToggleGrid);
          },
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
