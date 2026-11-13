export function portal(node: HTMLElement): { destroy: () => void } {
  document.body.appendChild(node);
  return { destroy: () => node.remove() };
}
