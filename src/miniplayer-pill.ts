export type TurnState = "working" | "idle" | "stuck" | "offline";

export type PillInput = {
  sessionName: string;
  turn: TurnState;
  minimized: boolean;
};

export type PillView = {
  label: string;
  dot: TurnState;
  showSend: boolean;
  showStop: boolean;
};

export function pillView(input: PillInput): PillView {
  let label: string;
  const dot = input.turn;
  
  if (input.minimized) {
    // When minimized, label is the dot state text
    const stateTexts: Record<TurnState, string> = {
      "working": "Working",
      "idle": "Idle",
      "stuck": "Needs you",
      "offline": "Offline"
    };
    label = stateTexts[input.turn];
  } else {
    // When not minimized, trim session name to 24 characters with ellipsis
    const sessionName = input.sessionName;
    if (sessionName.length > 24) {
      label = sessionName.substring(0, 24) + "…";
    } else {
      label = sessionName;
    }
  }
  
  // showSend is true only when not minimized and turn is idle or working
  const showSend = !input.minimized && (input.turn === "idle" || input.turn === "working");
  
  // showStop is true only when turn is working and not minimized
  const showStop = input.turn === "working" && !input.minimized;
  
  return {
    label,
    dot,
    showSend,
    showStop
  };
}

export function clampPosition(x: number, y: number, viewportW: number, viewportH: number, pillW: number, pillH: number): { x: number; y: number } {
  // If the pill is bigger than the viewport, return 8,8
  if (pillW > viewportW || pillH > viewportH) {
    return { x: 8, y: 8 };
  }
  
  // Clamp x to [8, viewportW - pillW - 8]
  const clampedX = Math.max(8, Math.min(x, viewportW - pillW - 8));
  
  // Clamp y to [8, viewportH - pillH - 8]
  const clampedY = Math.max(8, Math.min(y, viewportH - pillH - 8));
  
  return { x: clampedX, y: clampedY };
}

export function nextSessionIndex(current: number, count: number, dir: 1 | -1): number {
  // If count <= 0, return 0
  if (count <= 0) {
    return 0;
  }
  
  // Clamp current into range [0, count - 1]
  const clampedCurrent = Math.max(0, Math.min(current, count - 1));
  
  // Calculate next index with wraparound
  const nextIndex = clampedCurrent + dir;
  
  // Handle wraparound at both ends
  if (nextIndex < 0) {
    return count - 1;
  } else if (nextIndex >= count) {
    return 0;
  } else {
    return nextIndex;
  }
}
