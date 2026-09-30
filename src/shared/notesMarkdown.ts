import katex from 'katex';
import { Marked, type TokenizerAndRendererExtension, type Tokens } from 'marked';

/**
 * Speaker notes are Markdown (see `speakerNotes.ts`); this turns one slide's
 * note into HTML for reading — the notes drawer's Preview and Speaker View.
 *
 * The output is assigned to `innerHTML`, so it may only contain markup this
 * renderer produced itself. Raw HTML in a note is shown as text, not parsed:
 * notes arrive from `notes.md` on disk and from collaborators, and a note is
 * for reading while presenting, not for embedding. Links keep only schemes
 * that cannot run anything and open in a new window, which the app hands to
 * the system browser rather than navigating itself away. Images render as
 * their alt text, because a remote image would be fetched mid-talk (and fail
 * offline).
 *
 * Math follows the slides' convention (`player/render.ts`): `$$…$$` is display
 * math, `$…$` inline, and `\$` a literal dollar. It is tokenised before the
 * Markdown inside it can be — otherwise `a_1 + b_1` would become emphasis —
 * and rendered by KaTeX, whose stylesheet every window showing notes loads.
 */

const SAFE_HREF = /^(?:https?:|mailto:)/i;

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

interface MathToken extends Tokens.Generic {
  type: 'displayMath' | 'inlineMath';
  tex: string;
}

function renderMath(tex: string, displayMode: boolean): string {
  // KaTeX's `trust` defaults to false, so \href, \url and \htmlClass stay
  // inert; a malformed formula renders as red source instead of throwing.
  return katex.renderToString(tex, { displayMode, throwOnError: false, strict: 'ignore', output: 'html' });
}

/** A `$$…$$` block on lines of its own, which may span blank-free lines. */
const displayMathBlock: TokenizerAndRendererExtension = {
  name: 'displayMath',
  level: 'block',
  start: (src) => src.match(/^\$\$/m)?.index,
  tokenizer(src) {
    const match = /^\$\$([\s\S]+?)\$\$[ \t]*(?:\n+|$)/.exec(src);
    if (!match) return undefined;
    return { type: 'displayMath', raw: match[0], tex: match[1].trim() } satisfies MathToken;
  },
  renderer: (token) => renderMath((token as MathToken).tex, true),
};

/** `$$…$$` or `$…$` inside a line of prose. A `\$` never opens or closes. */
const inlineMath: TokenizerAndRendererExtension = {
  name: 'inlineMath',
  level: 'inline',
  start: (src) => src.match(/(?<!\\)\$/)?.index,
  tokenizer(src) {
    const display = /^\$\$([\s\S]+?)(?<!\\)\$\$/.exec(src);
    if (display) return { type: 'inlineMath', raw: display[0], tex: display[1].trim(), display: true };
    const inline = /^\$((?:\\.|[^$\\])+?)\$/.exec(src);
    if (inline) return { type: 'inlineMath', raw: inline[0], tex: inline[1].trim(), display: false };
    return undefined;
  },
  renderer: (token) => renderMath((token as MathToken).tex, Boolean(token.display)),
};

const markdown = new Marked({
  extensions: [displayMathBlock, inlineMath],
  gfm: true,
  breaks: true,
  async: false,
  renderer: {
    html({ text }: Tokens.HTML | Tokens.Tag): string {
      return escapeHtml(text);
    },
    link({ href, title, tokens }: Tokens.Link): string {
      const label = this.parser.parseInline(tokens);
      // Control characters are stripped by the URL parser before it reads a
      // scheme, so test the scheme the way the browser will see it.
      const scheme = href.replace(/[\x00-\x20]/g, '');
      if (!SAFE_HREF.test(scheme)) return label;
      const titleAttr = title ? ` title="${escapeHtml(title)}"` : '';
      return `<a href="${escapeHtml(href)}"${titleAttr} target="_blank" rel="noopener noreferrer">${label}</a>`;
    },
    image({ text }: Tokens.Image): string {
      return escapeHtml(text);
    },
  },
});

/** Render one slide's Markdown note as safe HTML. */
export function renderNotesMarkdown(source: string): string {
  if (!source.trim()) return '';
  return markdown.parse(source) as string;
}
