export const TURN_STEP_BATCH = 25;

export type FinishedTurn = {
  status: string;
  stepFinishReasons: readonly (string | undefined)[];
  stepBatch: number;
};

export function turnStoppedMidWork(turn: FinishedTurn): boolean {
  if (turn.status !== "completed") return false;
  if (turn.stepFinishReasons.length < turn.stepBatch) return false;
  return turn.stepFinishReasons.at(-1) === "tool-calls";
}
