export type EmptyListView = { text: string; hint: string | null; showArchiveToggle: boolean; toggleLabel: string };

export function emptyListView(showArchived: boolean): EmptyListView {
  if (showArchived) return { text: "No archived conversations.", hint: null, showArchiveToggle: true, toggleLabel: "Back to conversations" };
  return { text: "No conversations yet.", hint: "Send a message to start one.", showArchiveToggle: true, toggleLabel: "Show archived" };
}
