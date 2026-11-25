export type ContextMenuIcon =
  | "pin"
  | "unpin"
  | "size"
  | "rename"
  | "export"
  | "archive"
  | "unarchive"
  | "delete"
  | "sparkles"
  | "sliders";

export type ContextMenuActionItem = {
  kind: "action";
  id: string;
  label: string;
  icon?: ContextMenuIcon;
  hint?: string;
  tone?: "default" | "danger";
  disabled?: boolean;
  checked?: boolean;
  href?: string;
  onSelect?: () => void;
};

export type ContextMenuSubmenuItem = {
  kind: "submenu";
  id: string;
  label: string;
  icon?: ContextMenuIcon;
  hint?: string;
  items: ContextMenuItem[];
};

export type ContextMenuItem =
  | ContextMenuActionItem
  | ContextMenuSubmenuItem
  | { kind: "separator" }
  | { kind: "header"; label: string };

export type MenuPoint = { x: number; y: number };
export type MenuRect = { left: number; top: number; width: number; height: number };

const VIEWPORT_MARGIN = 8;

export function clampMenuPosition(
  anchor: MenuPoint,
  size: { width: number; height: number },
  viewport: { width: number; height: number },
): MenuPoint {
  const maxX = Math.max(VIEWPORT_MARGIN, viewport.width - size.width - VIEWPORT_MARGIN);
  const maxY = Math.max(VIEWPORT_MARGIN, viewport.height - size.height - VIEWPORT_MARGIN);
  return {
    x: Math.max(VIEWPORT_MARGIN, Math.min(anchor.x, maxX)),
    y: Math.max(VIEWPORT_MARGIN, Math.min(anchor.y, maxY)),
  };
}

export function submenuPosition(
  trigger: MenuRect,
  size: { width: number; height: number },
  viewport: { width: number; height: number },
): MenuPoint {
  const rightX = trigger.left + trigger.width + 4;
  const fitsRight = rightX + size.width + VIEWPORT_MARGIN <= viewport.width;
  const preferredX = fitsRight ? rightX : trigger.left - size.width - 4;
  return clampMenuPosition({ x: preferredX, y: trigger.top - 4 }, size, viewport);
}
