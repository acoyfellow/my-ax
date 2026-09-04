export function removeLeadingTemplateWhitespace(container: Element): void {
  const firstChild = container.firstChild;
  if (firstChild?.nodeType === Node.TEXT_NODE && /^\s+$/.test(firstChild.textContent ?? "")) {
    firstChild.remove();
  }
}
