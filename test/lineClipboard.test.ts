// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import {
  LINE_CLIPBOARD_ATTRIBUTE,
  copiedLine,
  insertLineAbove,
  lineAt,
  linePayload,
  removeLine,
} from '../src/renderer/editor/lineClipboard.js';

/**
 * Whole-line cut, copy and paste: the markup a line copies as, what cutting
 * it leaves behind, and where a pasted line lands.
 */

function box(html: string): HTMLElement {
  const body = document.createElement('div');
  body.className = 'text-content';
  body.innerHTML = html;
  document.body.replaceChildren(body);
  return body;
}

const inner = (root: HTMLElement) => root.innerHTML;
const textOf = (body: HTMLElement, text: string) => [...body.querySelectorAll('*')]
  .find((node) => node.firstChild?.nodeType === 3 && node.firstChild.textContent === text)!.firstChild!;

describe('the line at the caret', () => {
  it('is the paragraph or the whole list item, even from inside its markup', () => {
    const body = box('<p>one <b>two</b></p><ul><li><p>item</p></li></ul><table><tr><td>cell</td></tr></table>');
    expect(lineAt(body, textOf(body, 'two'))?.tagName).toBe('P');
    expect(lineAt(body, textOf(body, 'item'))?.tagName).toBe('LI');
    expect(lineAt(body, textOf(body, 'cell')), 'tables keep their own copy and paste').toBeNull();
  });
});

describe('copying a line', () => {
  it('copies a paragraph as itself, marked as a whole line, and its text with a newline', () => {
    const body = box('<p>alpha <b>beta</b></p><p>gamma</p>');
    const { html, text } = linePayload(body.querySelector('p')!, inner);
    expect(html).toBe(`<p ${LINE_CLIPBOARD_ATTRIBUTE}="">alpha <b>beta</b></p>`);
    expect(text).toBe('alpha beta\n');
  });

  it('copies a list item inside its list, kind and start included', () => {
    const body = box('<ol start="3"><li>three</li><li>four</li></ol>');
    const { html } = linePayload(body.querySelectorAll('li')[1], inner);
    expect(html).toBe(`<ol start="3" ${LINE_CLIPBOARD_ATTRIBUTE}=""><li>four</li></ol>`);
  });
});

describe('cutting a line', () => {
  it('removes the line whole and lands on the next one, else the previous', () => {
    const body = box('<p>a</p><p>b</p><p>c</p>');
    expect(removeLine(body.querySelectorAll('p')[1])?.textContent).toBe('c');
    expect(body.innerHTML).toBe('<p>a</p><p>c</p>');
    expect(removeLine(body.querySelectorAll('p')[1])?.textContent).toBe('a');
  });

  it('removes a list that held only the cut item', () => {
    const body = box('<p>a</p><ul><li>only</li></ul><p>b</p>');
    expect(removeLine(body.querySelector('li')!)?.textContent).toBe('b');
    expect(body.innerHTML).toBe('<p>a</p><p>b</p>');
  });
});

describe('pasting a copied line', () => {
  const copy = (html: string) => copiedLine(html)!;

  it('only recognises a whole-line copy', () => {
    expect(copiedLine('<p>just text</p>')).toBeNull();
    expect(copy(`<meta charset="utf-8"><p ${LINE_CLIPBOARD_ATTRIBUTE}="">x</p>`).outerHTML).toBe('<p>x</p>');
  });

  it("puts a paragraph above the caret's paragraph", () => {
    const body = box('<p>one</p><p>two</p>');
    insertLineAbove(body, body.querySelectorAll('p')[1], copy(`<p ${LINE_CLIPBOARD_ATTRIBUTE}="">new</p>`));
    expect(body.innerHTML).toBe('<p>one</p><p>new</p><p>two</p>');
  });

  it("puts list items into the caret's list, and a paragraph into a list as an item", () => {
    const body = box('<ul><li>a</li><li>b</li></ul>');
    insertLineAbove(body, body.querySelectorAll('li')[1], copy(`<ol ${LINE_CLIPBOARD_ATTRIBUTE}=""><li>x</li></ol>`));
    insertLineAbove(body, body.querySelectorAll('li')[0], copy(`<p ${LINE_CLIPBOARD_ATTRIBUTE}="">para <i>y</i></p>`));
    expect(body.innerHTML).toBe('<ul><li>para <i>y</i></li><li>a</li><li>x</li><li>b</li></ul>');
  });

  it('brings a list along among paragraphs, joining a list of the same kind just above', () => {
    const body = box('<p>one</p><p>two</p>');
    insertLineAbove(body, body.querySelectorAll('p')[1], copy(`<ul ${LINE_CLIPBOARD_ATTRIBUTE}=""><li>x</li></ul>`));
    expect(body.innerHTML).toBe('<p>one</p><ul><li>x</li></ul><p>two</p>');
    const joined = box('<ul><li>a</li></ul><p>two</p>');
    insertLineAbove(joined, joined.querySelector('p'), copy(`<ul ${LINE_CLIPBOARD_ATTRIBUTE}=""><li>x</li></ul>`));
    expect(joined.innerHTML).toBe('<ul><li>a</li><li>x</li></ul><p>two</p>');
  });
});
