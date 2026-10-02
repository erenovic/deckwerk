// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { emptyDeck, type Slide, type TextEl } from '../src/shared/deck.js';
import { renderSlide } from '../src/renderer/player/render.js';
import { hasUnclosedMath, joinMathAcrossRuns, mathRanges } from '../src/renderer/player/mathRuns.js';
import { cleanKatexMessage, slideWarnings } from '../src/renderer/editor/slideWarnings.js';

/**
 * Equations that cannot render: a formula split across formatting runs now
 * renders, and what still cannot is named, in words, beside the slide.
 */

function slideWith(...htmls: string[]): Slide {
  const slide = structuredClone(emptyDeck('Math').slides[0]);
  slide.elements = htmls.map((html, index): TextEl => ({
    id: `t${index}`, type: 'text', x: 0, y: 0, w: 800, h: 200, rot: 0, z: index, opacity: 1,
    class: ['role-body'], style: {}, html, align: 'left', valign: 'top',
  }));
  return slide;
}

const rendered = (slide: Slide) => {
  const layer = document.createElement('div');
  layer.className = 'slide-layer';
  layer.appendChild(renderSlide(slide, { resolveSrc: (src) => src }));
  return layer;
};

// The body of slide 3 in the author's deck, as the editor stored it.
const SPLIT = '<p>$\\mathcal{L}_{\\textrm{total}}<span style="letter-spacing: 0px;">\\mathcal{L}-</span>'
  + '<span style="letter-spacing: 0px;">\\mathcal{L}</span><span style="letter-spacing: 0px;">$</span></p><p><br></p>';

describe('maths split across formatting runs', () => {
  it('finds formulas, display maths first', () => {
    expect(mathRanges('a $x$ b $$y$$ c')).toEqual([[2, 5], [8, 13]]);
    expect(mathRanges('only $ one')).toEqual([]);
  });

  it('gathers a split formula into one text node, keeping the text around it', () => {
    const root = document.createElement('div');
    root.innerHTML = '<p>see <b>$a</b><i>+b$</i> here</p>';
    joinMathAcrossRuns(root);
    expect(root.innerHTML).toBe('<p>see <b>$a+b$</b> here</p>');
  });

  it("renders the author's slide 3 equation instead of its source", () => {
    const layer = rendered(slideWith(SPLIT));
    expect(layer.querySelectorAll('.katex')).toHaveLength(1);
    expect(layer.querySelector('.katex-error')).toBeNull();
    expect(layer.textContent).not.toContain('$');
    expect(slideWarnings(layer, slideWith(SPLIT).elements, null)).toEqual([]);
  });
});

describe('equation warnings', () => {
  it('names a LaTeX error in words, with the formula as written', () => {
    const slide = slideWith('<p>Loss $\\frakk{L}$</p>');
    const [warning] = slideWarnings(rendered(slide), slide.elements, null);
    expect(warning.box).toBe('Body');
    expect(warning.message).toMatch(/^This equation has a LaTeX error: Undefined control sequence: \\frakk/);
    expect(warning.source).toContain('\\frakk');
  });

  it('flags a $ that never closes, but not a written dollar sign', () => {
    const unclosed = slideWith('<p>Costs $5 a month</p>');
    expect(slideWarnings(rendered(unclosed), unclosed.elements, null)[0].message)
      .toMatch(/starts with \$ but never closes/);
    const escaped = slideWith('<p>Costs \\$5 a month</p>');
    expect(slideWarnings(rendered(escaped), escaped.elements, null)).toEqual([]);
    const root = document.createElement('div');
    root.textContent = 'no maths here';
    expect(hasUnclosedMath(root)).toBe(false);
  });

  it('leaves out the box being edited, which shows its source on purpose', () => {
    const slide = slideWith('<p>$\\frakk$</p>', '<p>$5</p>');
    expect(slideWarnings(rendered(slide), slide.elements, 't0').map((w) => w.elementId)).toEqual(['t1']);
  });

  it("cleans KaTeX's message of its class name and underline marks", () => {
    expect(cleanKatexMessage('ParseError: KaTeX parse error: Expected \'}\', got \'EOF\' at end of input: \\frac{1}{\u0332'))
      .toBe("Expected '}', got 'EOF' at end of input: \\frac{1}{");
    expect(cleanKatexMessage('ParseError: KaTeX parse error: Undefined control sequence: \\frakk at position 1: \\̲f̲r̲a̲k̲k̲{L}'))
      .toBe('Undefined control sequence: \\frakk (at character 1)');
  });
});
