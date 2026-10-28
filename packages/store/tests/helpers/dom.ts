/**
 * Test helper: registers a happy-dom Window as the global realm.
 * happy-dom is a devDependency only — the runtime itself has zero deps.
 */
import { Window } from 'happy-dom';

export function setupDom(): Window {
  const win = new Window({ url: 'http://localhost/' });
  const g = globalThis as unknown as Record<string, unknown>;
  g.window = win;
  g.document = win.document;
  g.customElements = win.customElements;
  g.Node = win.Node;
  g.Element = win.Element;
  g.HTMLElement = win.HTMLElement;
  g.HTMLTemplateElement = win.HTMLTemplateElement;
  g.HTMLInputElement = win.HTMLInputElement;
  g.HTMLSelectElement = win.HTMLSelectElement;
  g.HTMLTextAreaElement = win.HTMLTextAreaElement;
  g.HTMLFormElement = win.HTMLFormElement;
  g.DocumentFragment = win.DocumentFragment;
  g.Document = win.Document;
  g.Text = win.Text;
  g.Comment = win.Comment;
  g.Event = win.Event;
  g.CustomEvent = win.CustomEvent;
  g.MouseEvent = win.MouseEvent;
  g.SVGElement = win.SVGElement;
  g.NodeFilter = win.NodeFilter;
  return win;
}
