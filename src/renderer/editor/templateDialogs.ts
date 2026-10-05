import { emptyDeck, parseDeck } from '@shared/deck.js';
import { templateTitleLayout } from '@shared/deckTemplates.js';
import type { TemplateSummary } from '@shared/ipc.js';
import { deckTheme } from '@shared/themes.js';
import { masterTile } from './layoutPreview.js';

/**
 * The template dialogs: pick a saved template (to start a deck from or to
 * apply), and name one being saved. Built on the shared workflow dialog, so
 * they look, focus and dismiss like every other dialog in the editor.
 */

interface DialogParts {
  overlay: HTMLElement;
  dialog: HTMLElement;
  actions: HTMLElement;
  finishWith: (done: () => void) => void;
}

function openDialog(className: string, heading: string, onCancel: () => void): DialogParts {
  const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const overlay = document.createElement('div');
  overlay.className = 'workflow-overlay';
  const dialog = document.createElement('section');
  dialog.className = `workflow-dialog ${className}`;
  dialog.setAttribute('role', 'dialog');
  dialog.setAttribute('aria-modal', 'true');
  const title = document.createElement('h2');
  title.id = `${className}-title`;
  title.textContent = heading;
  dialog.setAttribute('aria-labelledby', title.id);
  const actions = document.createElement('div');
  actions.className = 'workflow-actions';
  dialog.append(title);
  overlay.appendChild(dialog);

  let finished = false;
  const finishWith = (done: () => void) => {
    if (finished) return;
    finished = true;
    overlay.remove();
    previousFocus?.focus();
    done();
  };
  overlay.addEventListener('pointerdown', (event) => {
    if (event.target === overlay) finishWith(onCancel);
  });
  overlay.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.stopPropagation();
      finishWith(onCancel);
    }
  });
  return { overlay, dialog, actions, finishWith };
}

function button(label: string, primary = false): HTMLButtonElement {
  const element = document.createElement('button');
  element.type = 'button';
  element.textContent = label;
  if (primary) element.className = 'primary';
  return element;
}

function describe(template: TemplateSummary): string {
  const parts = [
    template.theme,
    template.layouts > 0 ? `${template.layouts} layout${template.layouts === 1 ? '' : 's'}` : null,
    template.source ? `from ${template.source}` : null,
    new Date(template.savedAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }),
  ];
  return parts.filter(Boolean).join(' · ');
}

/** The template's title slide, drawn in its theme. */
function preview(template: TemplateSummary): { frame: HTMLElement; observer: ResizeObserver | null } {
  const wearer = parseDeck({ ...emptyDeck('preview'), ...structuredClone(template.design) });
  return masterTile(
    templateTitleLayout(template.design),
    template.design.layoutMasters,
    deckTheme(wearer),
    {},
    template.design.customLayouts,
  );
}

/**
 * Choose a saved template. Resolves its id, or null when cancelled. Templates
 * can be deleted from here too, which is the only place they are listed.
 */
export function showTemplatePicker(options: {
  heading: string;
  actionLabel: string;
  detail?: string;
}): Promise<string | null> {
  return new Promise((resolve) => {
    const observers: ResizeObserver[] = [];
    const { overlay, dialog, actions, finishWith } = openDialog('template-picker', options.heading, () => resolve(null));
    const done = (id: string | null) => finishWith(() => {
      for (const observer of observers) observer.disconnect();
      resolve(id);
    });

    if (options.detail) {
      const detail = document.createElement('p');
      detail.className = 'template-picker-detail';
      detail.textContent = options.detail;
      dialog.appendChild(detail);
    }

    const list = document.createElement('div');
    list.className = 'template-list';
    list.setAttribute('role', 'listbox');
    list.setAttribute('aria-label', 'Templates');
    const remove = button('Delete');
    const cancel = button('Cancel');
    const choose = button(options.actionLabel, true);
    remove.classList.add('template-delete');
    actions.append(remove, cancel, choose);
    dialog.append(list, actions);
    document.body.appendChild(overlay);

    let selected: string | null = null;
    let templates: TemplateSummary[] = [];
    const sync = () => {
      for (const row of list.querySelectorAll<HTMLElement>('.template-row')) {
        const on = row.dataset.templateId === selected;
        row.classList.toggle('selected', on);
        row.setAttribute('aria-selected', String(on));
      }
      choose.disabled = selected === null;
      remove.disabled = selected === null;
      remove.textContent = 'Delete';
      delete remove.dataset.confirming;
    };

    const render = () => {
      list.replaceChildren();
      if (templates.length === 0) {
        const empty = document.createElement('p');
        empty.className = 'template-empty';
        empty.textContent = 'No templates yet. Open a deck whose design you like and choose File › Save as Template…';
        list.appendChild(empty);
      }
      for (const template of templates) {
        const row = document.createElement('button');
        row.type = 'button';
        row.className = 'template-row';
        row.dataset.templateId = template.id;
        row.setAttribute('role', 'option');
        const tile = preview(template);
        if (tile.observer) observers.push(tile.observer);
        tile.frame.classList.add('template-preview');
        const text = document.createElement('span');
        text.className = 'template-text';
        const name = document.createElement('strong');
        name.textContent = template.name;
        const meta = document.createElement('span');
        meta.className = 'template-meta';
        meta.textContent = describe(template);
        text.append(name, meta);
        row.append(tile.frame, text);
        row.addEventListener('click', () => {
          selected = template.id;
          sync();
        });
        row.addEventListener('dblclick', () => done(template.id));
        list.appendChild(row);
      }

      sync();
    };

    remove.addEventListener('click', () => {
      if (!selected) return;
      // A second click confirms, so one stray click never loses a template.
      if (!remove.dataset.confirming) {
        remove.dataset.confirming = 'true';
        remove.textContent = 'Click again to delete';
        return;
      }
      const id = selected;
      void window.api.deleteTemplate(id).then(() => {
        templates = templates.filter((template) => template.id !== id);
        selected = templates[0]?.id ?? null;
        render();
      });
    });
    cancel.addEventListener('click', () => done(null));
    choose.addEventListener('click', () => {
      if (selected) done(selected);
    });
    choose.disabled = true;
    remove.disabled = true;
    cancel.focus();

    void window.api.listTemplates().then((found) => {
      templates = found;
      selected = found[0]?.id ?? null;
      render();
      if (selected) choose.focus();
    });
  });
}

/** Ask for a template's name. Resolves the name, or null when cancelled. */
export function showTemplateNameDialog(defaultName: string): Promise<string | null> {
  return new Promise((resolve) => {
    const { overlay, dialog, actions, finishWith } = openDialog('template-name', 'Save as template', () => resolve(null));
    const detail = document.createElement('p');
    detail.className = 'template-picker-detail';
    detail.textContent = 'Keeps this deck’s theme, layouts, page numbers and stylesheet, '
      + 'so any new deck can start from them. Slides and notes stay here.';
    const field = document.createElement('label');
    field.className = 'field';
    const label = document.createElement('span');
    label.textContent = 'Name';
    const input = document.createElement('input');
    input.type = 'text';
    input.value = defaultName;
    input.spellcheck = false;
    field.append(label, input);
    const cancel = button('Cancel');
    const save = button('Save template', true);
    actions.append(cancel, save);
    dialog.append(detail, field, actions);
    document.body.appendChild(overlay);

    const submit = () => {
      const name = input.value.trim();
      if (name) finishWith(() => resolve(name));
    };
    input.addEventListener('input', () => { save.disabled = input.value.trim() === ''; });
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') submit();
    });
    cancel.addEventListener('click', () => finishWith(() => resolve(null)));
    save.addEventListener('click', submit);
    input.focus();
    input.select();
  });
}

/** Ask before replacing a template of the same name. */
export function confirmReplaceTemplate(name: string): Promise<boolean> {
  return new Promise((resolve) => {
    const { overlay, dialog, actions, finishWith } = openDialog('template-replace', 'Replace template?', () => resolve(false));
    const detail = document.createElement('p');
    detail.className = 'template-picker-detail';
    detail.textContent = `A template named “${name}” already exists. Replace it with this deck’s design?`;
    const cancel = button('Cancel');
    const replace = button('Replace', true);
    actions.append(cancel, replace);
    dialog.append(detail, actions);
    document.body.appendChild(overlay);
    cancel.addEventListener('click', () => finishWith(() => resolve(false)));
    replace.addEventListener('click', () => finishWith(() => resolve(true)));
    replace.focus();
  });
}
