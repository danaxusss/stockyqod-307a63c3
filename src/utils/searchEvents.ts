// Opens the global search from anywhere (sidebar button, home search bar,
// phone header) without passing callbacks through the tree.
const EVENT = 'stocky:open-search';

export function openSearch(): void {
  window.dispatchEvent(new Event(EVENT));
}

export function onOpenSearch(handler: () => void): () => void {
  window.addEventListener(EVENT, handler);
  return () => window.removeEventListener(EVENT, handler);
}
