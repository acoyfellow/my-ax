export type InsetInput = {
  virtualKeyboardHeight: number | null;
  layoutViewportHeight: number;
  visualViewportHeight: number | null;
  visualViewportOffsetTop: number | null;
};

export function keyboardInset(input: InsetInput): number {
  let inset = 0;

  if (typeof input.virtualKeyboardHeight === "number" && input.virtualKeyboardHeight > 0) {
    inset = input.virtualKeyboardHeight;
  } else if (typeof input.visualViewportHeight === "number") {
    const offsetTop = input.visualViewportOffsetTop ?? 0;
    inset = input.layoutViewportHeight - input.visualViewportHeight - offsetTop;
  } else {
    inset = 0;
  }

  inset = Math.max(0, inset);
  if (inset < 24) {
    inset = 0;
  }
  return Math.round(inset);
}
