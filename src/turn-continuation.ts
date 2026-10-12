export const TURN_STEP_BATCH = 25;
export const MAX_AUTO_CONTINUATIONS = 3;

export type FinishedTurn = {
  status: string;
  stepFinishReasons: readonly (string | undefined)[];
  stepBatch: number;
};

export function turnStoppedMidWork(turn: FinishedTurn): boolean {
  if (turn.status !== "completed") return false;
  return turn.stepFinishReasons.at(-1) === "tool-calls";
}

export function shouldAutoContinue(turn: FinishedTurn, continuationsSoFar: number): "continue" | "give-up" | "done" {
  if (!turnStoppedMidWork(turn)) return "done";
  return continuationsSoFar < MAX_AUTO_CONTINUATIONS ? "continue" : "give-up";
}

export const TURN_CUT_NOTE = "This turn stopped while the agent was still calling tools and could not be continued automatically. Say \"go on\" to resume.";
