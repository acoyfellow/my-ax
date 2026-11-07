export type DeskCardStatus = "pending" | "approved" | "rejected";

export const DESK_CARD_STATUSES: ReadonlySet<DeskCardStatus> = new Set(["pending", "approved", "rejected"]);

export function isDeskCardStatus(value: unknown): value is DeskCardStatus {
  return typeof value === "string" && DESK_CARD_STATUSES.has(value as DeskCardStatus);
}

export class DeskCardTransitionError extends Error {
  constructor(readonly from: DeskCardStatus, readonly to: DeskCardStatus) {
    super(`a desk card that is ${from} cannot become ${to}`);
  }
}

export function nextDeskCardStatus(current: DeskCardStatus | undefined, requested: unknown): DeskCardStatus {
  if (current === undefined) return isDeskCardStatus(requested) ? requested : "pending";
  if (requested === undefined) return current;
  if (!isDeskCardStatus(requested)) return current;
  if (current === requested) return current;
  if (current === "pending") return requested;
  throw new DeskCardTransitionError(current, requested);
}
