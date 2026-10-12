const WIDGET_TOOL_NAMES: Readonly<Record<string, string>> = {
  create_svelte_artifact: "create_widget",
  search_artifacts: "search_widgets",
  get_artifact: "get_widget",
  desk_promote_artifact: "desk_promote_widget",
};

export function widgetToolName(name: string): string {
  return WIDGET_TOOL_NAMES[name] ?? name;
}

export function legacyToolName(name: string): string {
  return Object.entries(WIDGET_TOOL_NAMES).find(([, widget]) => widget === name)?.[0] ?? name;
}

export function widgetWording(text: string): string {
  return text
    .replace(/create_svelte_artifact/g, "create_widget")
    .replace(/search_artifacts/g, "search_widgets")
    .replace(/get_artifact\b/g, "get_widget")
    .replace(/desk_promote_artifact/g, "desk_promote_widget")
    .replace(/\bArtifacts\b/g, "Widgets")
    .replace(/\bartifacts\b/g, "widgets")
    .replace(/\bArtifact\b/g, "Widget")
    .replace(/\bartifact\b/g, "widget")
    .replace(/\ban widget\b/g, "a widget")
    .replace(/\bAn widget\b/g, "A widget");
}
