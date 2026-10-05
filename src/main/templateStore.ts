import { existsSync } from 'node:fs';
import { copyFile, mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, normalize, sep } from 'node:path';
import type { Deck } from '@shared/deck.js';
import {
  DeckTemplateSchema,
  deckFromTemplate,
  templateFromDeck,
  type DeckTemplate,
} from '@shared/deckTemplates.js';
import type { TemplateSummary } from '@shared/ipc.js';
import { deckThemes, themeById } from '@shared/themes.js';
import { saveDeck } from './deckStore.js';

/**
 * Templates on disk: one folder each under ~/.deckwerk/templates, holding
 * `template.json` and a copy of the files its design refers to. They belong
 * to the person, not to a deck, so every deck the editor or the CLI opens can
 * start from them. `DECKWERK_TEMPLATES_DIR` moves the folder (tests do).
 */

const TEMPLATE_FILE = 'template.json';

export function templatesRoot(): string {
  return process.env.DECKWERK_TEMPLATES_DIR || join(homedir(), '.deckwerk', 'templates');
}

export type { TemplateSummary };

export class TemplateExistsError extends Error {
  constructor(readonly id: string, name: string) {
    super(`A template named "${name}" already exists`);
  }
}

function templateDir(id: string): string {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(id)) throw new Error(`Not a template id: ${id}`);
  return join(templatesRoot(), id);
}

/** A deck-relative asset path that cannot climb out of the folder it is joined to. */
function safeAsset(path: string): string {
  const clean = normalize(path);
  if (clean.startsWith('..') || clean.startsWith(sep) || !clean.startsWith(`assets${sep}`)) {
    throw new Error(`Not a deck asset: ${path}`);
  }
  return clean;
}

export function summarize(template: DeckTemplate): TemplateSummary {
  const themeId = template.design.themeSelection?.preset ?? template.design.themePreset;
  return {
    id: template.id,
    name: template.name,
    source: template.source,
    savedAt: template.savedAt,
    theme: themeById(themeId, deckThemes(template.design))?.name ?? null,
    layouts: template.design.customLayouts.length,
    design: template.design,
  };
}

export async function readTemplate(id: string): Promise<DeckTemplate> {
  const path = join(templateDir(id), TEMPLATE_FILE);
  if (!existsSync(path)) throw new Error(`No template "${id}"`);
  return DeckTemplateSchema.parse(JSON.parse(await readFile(path, 'utf8')));
}

/** Every saved template, newest first. A folder that does not read is skipped. */
export async function listTemplates(): Promise<TemplateSummary[]> {
  const root = templatesRoot();
  if (!existsSync(root)) return [];
  const entries = await readdir(root, { withFileTypes: true });
  const templates: TemplateSummary[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    try {
      templates.push(summarize(await readTemplate(entry.name)));
    } catch {
      // Half-written or hand-edited into something else; not offered.
    }
  }

  return templates.sort((a, b) => b.savedAt.localeCompare(a.savedAt));
}

/**
 * Save a deck's design as a template named `name`. A template of that name is
 * replaced only when asked; otherwise this throws TemplateExistsError so the
 * caller can ask.
 */
export async function saveTemplate(
  deckDir: string,
  deck: Deck,
  css: string,
  name: string,
  options: { replace?: boolean } = {},
): Promise<DeckTemplate> {
  const template = templateFromDeck(deck, css, name);
  const dir = templateDir(template.id);
  if (existsSync(join(dir, TEMPLATE_FILE)) && !options.replace) throw new TemplateExistsError(template.id, template.name);
  // Written beside the old one and swapped in, so a failed save never leaves
  // a template half old and half new.
  const staging = `${dir}.saving-${process.pid}`;
  await rm(staging, { recursive: true, force: true });
  await mkdir(staging, { recursive: true });
  const kept: string[] = [];
  for (const asset of template.assets) {
    const from = join(deckDir, safeAsset(asset));
    if (!existsSync(from)) continue;
    const to = join(staging, safeAsset(asset));
    await mkdir(dirname(to), { recursive: true });
    await copyFile(from, to);
    kept.push(asset);
  }

  const saved = { ...template, assets: kept };
  await writeFile(join(staging, TEMPLATE_FILE), `${JSON.stringify(saved, null, 2)}\n`, 'utf8');
  await rm(dir, { recursive: true, force: true });
  await rename(staging, dir);
  return saved;
}

export async function deleteTemplate(id: string): Promise<void> {
  await rm(templateDir(id), { recursive: true, force: true });
}

/** Copy a template's files into a deck, leaving any the deck already has. */
export async function copyTemplateAssets(template: DeckTemplate, deckDir: string): Promise<string[]> {
  const copied: string[] = [];
  for (const asset of template.assets) {
    const from = join(templateDir(template.id), safeAsset(asset));
    const to = join(deckDir, safeAsset(asset));
    if (!existsSync(from) || existsSync(to)) continue;
    await mkdir(dirname(to), { recursive: true });
    await copyFile(from, to);
    copied.push(asset);
  }

  return copied;
}

/**
 * A new deck folder at `dir` wearing the template. Refuses a folder that
 * already holds a presentation or a stylesheet, which this would overwrite.
 */
export async function createDeckFromTemplate(dir: string, template: DeckTemplate, title: string): Promise<Deck> {
  if (existsSync(join(dir, 'deck.json'))) throw new Error(`${dir} already contains a presentation`);
  const { deck, css } = deckFromTemplate(template, title);
  if (existsSync(join(dir, deck.theme))) throw new Error(`${dir} already has a ${deck.theme}`);
  await Promise.all([
    mkdir(join(dir, 'assets'), { recursive: true }),
    mkdir(join(dir, 'edit'), { recursive: true }),
  ]);
  await copyTemplateAssets(template, dir);
  await writeFile(join(dir, deck.theme), css, 'utf8');
  await saveDeck(dir, deck);
  return deck;
}
