import { Marked, type Tokens } from 'marked';

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

const markdown = new Marked({
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
