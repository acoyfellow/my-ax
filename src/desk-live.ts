import { parseDeskBoard, type DeskBoard } from "./desk-board";

export const DESK_BOARD_FRAME = "desk.board";

export function deskBoardFrame(board: DeskBoard): string {
  return JSON.stringify({ type: DESK_BOARD_FRAME, board });
}

export function parseDeskBoardFrame(raw: unknown): DeskBoard | null {
  if (!raw || typeof raw !== "object") return null;
  const frame = raw as { type?: unknown; board?: unknown };
  if (frame.type !== DESK_BOARD_FRAME || !("board" in frame)) return null;
  return parseDeskBoard(frame.board);
}
