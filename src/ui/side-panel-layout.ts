export const PANEL_DEFAULT_WIDTH = 300;
export const PANEL_MIN_WIDTH = 220;
export const PANEL_MAX_WIDTH = 480;
export const CONVERSATION_MIN_WIDTH = 420;
export const DOCK_BREAKPOINT = 900;
export const LAYOUT_STORAGE_KEY = "my-ax-sessions-panel";

export type PanelLayout = { open: boolean; width: number };

export const DEFAULT_LAYOUT: PanelLayout = { open: true, width: PANEL_DEFAULT_WIDTH };

export function clampPanelWidth(requested: number, viewportWidth: number): number {
  const roomForPanel = Math.max(PANEL_MIN_WIDTH, viewportWidth - CONVERSATION_MIN_WIDTH);
  return Math.round(Math.min(Math.max(requested, PANEL_MIN_WIDTH), PANEL_MAX_WIDTH, roomForPanel));
}

export function canDock(viewportWidth: number): boolean {
  return viewportWidth >= DOCK_BREAKPOINT;
}

export function parseLayout(raw: string | null): PanelLayout {
  if (!raw) return DEFAULT_LAYOUT;
  try {
    const value = JSON.parse(raw) as Partial<PanelLayout>;
    return {
      open: typeof value.open === "boolean" ? value.open : DEFAULT_LAYOUT.open,
      width: typeof value.width === "number" && Number.isFinite(value.width) ? value.width : DEFAULT_LAYOUT.width,
    };
  } catch {
    return DEFAULT_LAYOUT;
  }
}
