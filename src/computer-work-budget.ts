import {
  COMPUTER_GREP_MAX_TOTAL_BYTES,
  COMPUTER_READ_MAX_BYTES,
  COMPUTER_WRITE_MAX_BYTES,
} from "./computer-filesystem";

export const COMPUTER_WORK_CODE_MAX_CALLS = 16;
export const COMPUTER_WORK_CODE_MAX_CONCURRENCY = 4;
export const COMPUTER_WORK_CODE_MAX_CUMULATIVE_READ_BYTES = 256 * 1024;
export const COMPUTER_WORK_CODE_MAX_CUMULATIVE_WRITE_BYTES = 128 * 1024;
export const WORK_CODE_SAVED_RECIPE_MAX_INVOCATIONS = 16;

export type WorkCodeExecutionState = {
  computerAttempts: number;
  computerConcurrent: number;
  computerReservedReadBytes: number;
  computerReservedWriteBytes: number;
  savedRecipeInvocations: number;
};

const executionStates = new WeakSet<WorkCodeExecutionState>();

export function createWorkCodeExecutionState(): WorkCodeExecutionState {
  const state = {
    computerAttempts: 0,
    computerConcurrent: 0,
    computerReservedReadBytes: 0,
    computerReservedWriteBytes: 0,
    savedRecipeInvocations: 0,
  };
  executionStates.add(state);
  return state;
}

export function resolveWorkCodeExecutionState(value: unknown): WorkCodeExecutionState {
  return value && typeof value === "object" && executionStates.has(value as WorkCodeExecutionState)
    ? value as WorkCodeExecutionState
    : createWorkCodeExecutionState();
}

export function reserveSavedRecipeInvocation(value: unknown): WorkCodeExecutionState {
  const state = resolveWorkCodeExecutionState(value);
  state.savedRecipeInvocations = Math.min(WORK_CODE_SAVED_RECIPE_MAX_INVOCATIONS + 1, state.savedRecipeInvocations + 1);
  if (state.savedRecipeInvocations > WORK_CODE_SAVED_RECIPE_MAX_INVOCATIONS) {
    throw new Error(`Saved recipe invocation budget exceeded (${WORK_CODE_SAVED_RECIPE_MAX_INVOCATIONS}).`);
  }
  return state;
}

type ComputerFunction = (input: unknown) => Promise<unknown>;
type ComputerFunctions = Record<string, ComputerFunction>;

type ComputerReservation = {
  readBytes: number;
  writeBytes: number;
};

const encoder = new TextEncoder();

function byteLengthForWrite(input: unknown): number {
  const content = (input as { content?: unknown } | null)?.content;
  if (typeof content !== "string") return COMPUTER_WRITE_MAX_BYTES;
  if (content.length > COMPUTER_WRITE_MAX_BYTES) return COMPUTER_WRITE_MAX_BYTES + 1;
  return encoder.encode(content).byteLength;
}

function reservationForComputerMethod(method: string, input: unknown): ComputerReservation {
  if (method === "read") return { readBytes: COMPUTER_READ_MAX_BYTES, writeBytes: 0 };
  if (method === "grep") return { readBytes: COMPUTER_GREP_MAX_TOTAL_BYTES, writeBytes: 0 };
  if (method === "write") return { readBytes: 0, writeBytes: byteLengthForWrite(input) };
  return { readBytes: 0, writeBytes: 0 };
}

export function applyComputerWorkBudget<T extends ComputerFunctions>(functions: T, executionState?: WorkCodeExecutionState): { [K in keyof T]: ComputerFunction } {
  const state = resolveWorkCodeExecutionState(executionState);

  return Object.fromEntries(Object.entries(functions).map(([method, invoke]) => [method, async (input: unknown) => {
    const reservation = reservationForComputerMethod(method, input);
    state.computerAttempts = Math.min(COMPUTER_WORK_CODE_MAX_CALLS + 1, state.computerAttempts + 1);
    if (state.computerAttempts > COMPUTER_WORK_CODE_MAX_CALLS) {
      throw new Error(`Computer work_code call budget exceeded (${COMPUTER_WORK_CODE_MAX_CALLS}).`);
    }
    if (state.computerConcurrent >= COMPUTER_WORK_CODE_MAX_CONCURRENCY) {
      throw new Error(`Computer work_code concurrency budget exceeded (${COMPUTER_WORK_CODE_MAX_CONCURRENCY}).`);
    }
    if (state.computerReservedReadBytes + reservation.readBytes > COMPUTER_WORK_CODE_MAX_CUMULATIVE_READ_BYTES) {
      throw new Error(`Computer work_code cumulative read budget exceeded (${COMPUTER_WORK_CODE_MAX_CUMULATIVE_READ_BYTES} bytes).`);
    }
    if (state.computerReservedWriteBytes + reservation.writeBytes > COMPUTER_WORK_CODE_MAX_CUMULATIVE_WRITE_BYTES) {
      throw new Error(`Computer work_code cumulative write budget exceeded (${COMPUTER_WORK_CODE_MAX_CUMULATIVE_WRITE_BYTES} bytes).`);
    }

    state.computerConcurrent += 1;
    state.computerReservedReadBytes += reservation.readBytes;
    state.computerReservedWriteBytes += reservation.writeBytes;
    try {
      return await invoke(input);
    } finally {
      state.computerConcurrent -= 1;
    }
  }])) as { [K in keyof T]: ComputerFunction };
}
