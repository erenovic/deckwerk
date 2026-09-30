import { describe, expect, it } from 'vitest';
import { renderNotesMarkdown } from '../src/shared/notesMarkdown.js';

/**
 * Notes are rendered into the editor and Speaker View with `innerHTML`, so the
 * renderer is the only thing standing between a note from disk or a
 * collaborator and live markup. It must format Markdown and nothing else.
 */
describe('speaker notes markdown', () => {
  it('renders headings, emphasis, lists and code', () => {
    const html = renderNotesMarkdown('# Intro\n\n**Pause** here, then *slowly*:\n\n- one\n- two\n\n`npm test`');
    expect(html).toContain('<h1>Intro</h1>');
    expect(html).toContain('<strong>Pause</strong>');
    expect(html).toContain('<em>slowly</em>');
    expect(html).toMatch(/<ul>\s*<li>one<\/li>\s*<li>two<\/li>\s*<\/ul>/);
    expect(html).toContain('<code>npm test</code>');
  });

  it('keeps single line breaks, as the author typed them', () => {
    expect(renderNotesMarkdown('first\nsecond')).toContain('first<br>second');
  });

  it('shows raw HTML as text instead of parsing it', () => {
    const inline = renderNotesMarkdown('Say <b>this</b> <img src=x onerror=alert(1)>');
    expect(inline).not.toContain('<b>');
    expect(inline).not.toContain('<img');
    expect(inline).toContain('&lt;b&gt;this&lt;/b&gt;');

    const block = renderNotesMarkdown('<script>alert(1)</script>');
    expect(block).not.toContain('<script');
    expect(block).toContain('&lt;script&gt;');
  });

  it('keeps safe links and drops the href of anything that could run', () => {
    expect(renderNotesMarkdown('[paper](https://arxiv.org/abs/1)'))
      .toContain('<a href="https://arxiv.org/abs/1" target="_blank" rel="noopener noreferrer">paper</a>');
    for (const href of ['javascript:alert(1)', 'java\tscript:alert(1)', 'data:text/html,x', 'file:///etc/passwd']) {
      const html = renderNotesMarkdown(`[click](${href})`);
      expect(html, href).not.toContain('<a');
      expect(html, href).toContain('click');
    }
  });

  it('renders images as their alt text so nothing is fetched while presenting', () => {
    const html = renderNotesMarkdown('![the teaser](https://example.com/t.png)');
    expect(html).not.toContain('<img');
    expect(html).toContain('the teaser');
  });

  it('renders inline and display math with KaTeX, as the slides do', () => {
    const inline = renderNotesMarkdown('The loss is $a_1 + b_1 = \\sum_i x_i$, so *pause*.');
    expect(inline).toContain('class="katex"');
    expect(inline).not.toContain('katex-display');
    // Underscores inside the formula must not turn into emphasis.
    expect(inline).not.toContain('<em>1 + b</em>');
    expect(inline).toContain('<em>pause</em>');

    const block = renderNotesMarkdown('Recall:\n\n$$\n\\frac{\\partial L}{\\partial w}\n$$\n\nThen move on.');
    expect(block).toContain('katex-display');
    expect(block).toContain('<p>Then move on.</p>');

    expect(renderNotesMarkdown('where $$E = mc^2$$ holds')).toContain('katex-display');
  });

  it('keeps an escaped dollar literal and survives a malformed formula', () => {
    const money = renderNotesMarkdown('It costs \\$5 and \\$10.');
    expect(money).not.toContain('katex');
    expect(money).toContain('$5 and $10');

    const broken = renderNotesMarkdown('Oops $\\frac{1}{$ here');
    expect(broken).toContain('katex-error');
  });

  it('does not let KaTeX emit links or raw HTML', () => {
    const html = renderNotesMarkdown('$\\href{javascript:alert(1)}{x}$ and $\\htmlClass{evil}{y}$');
    expect(html).not.toContain('javascript:');
    expect(html).not.toContain('evil');
  });

  it('renders an empty or blank note as nothing', () => {
    expect(renderNotesMarkdown('')).toBe('');
    expect(renderNotesMarkdown('  \n ')).toBe('');
  });
});
