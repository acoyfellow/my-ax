export type EmptyListView = { text: string; hint: string | null; showArchiveToggle: boolean; toggleLabel: string };

export function emptyListView(showArchived: boolean): EmptyListView {
  if (showArchived) return { text: "No archived conversations.", hint: null, showArchiveToggle: true, toggleLabel: "Back to conversations" };
  return { text: "No other conversations", hint: null, showArchiveToggle: true, toggleLabel: "Show archived" };
}
