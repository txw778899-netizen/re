/** Registers a happy-dom realm for tests that exercise @zhenre/core + the plugin. */
import { Window } from 'happy-dom';

export function setupCoreDom(): Window {
  const win = new Window({ url: 'http://localhost/' });
  const g = globalThis as unknown as Record<string, unknown>;
  g.window = win;
  g.document = win.document;
  g.customElements = win.customElements;
  g.Node = win.Node;
  g.Element = win.Element;
  g.HTMLElement = win.HTMLElement;
  g.HTMLTemplateElement = win.HTMLTemplateElement;
  g.DocumentFragment = win.DocumentFragment;
  g.Document = win.Document;
  g.Text = win.Text;
  g.Comment = win.Comment;
  g.Event = win.Event;
  g.CustomEvent = win.CustomEvent;
  g.SVGElement = win.SVGElement;
  g.NodeFilter = win.NodeFilter;
  return win;
}
