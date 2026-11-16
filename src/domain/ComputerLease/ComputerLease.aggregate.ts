import * as Domain from "@alchemy.run/domain";
import * as Schema from "effect/Schema";
import { AcquireComputerLease, ComputerLeaseAcquired } from "./AcquireComputerLease.command";
import { ComputerLeaseReleased, ReleaseComputerLease } from "./ReleaseComputerLease.command";
import { ComputerLeaseId } from "./ComputerLease.id";
import { ComputerLeaseHeld, ComputerLeaseNotHeld } from "./ComputerLeaseRejections.rejection";

export const ComputerLeaseState = Schema.Union([
  Schema.TaggedStruct("Free", {}),
  Schema.TaggedStruct("Held", { holder: Schema.String, expiresAt: Schema.Number }),
]);
export type ComputerLeaseState = typeof ComputerLeaseState.Type;

export function heldByOther(state: ComputerLeaseState, holder: string, now: number): boolean {
  return state._tag === "Held" && state.expiresAt > now && state.holder !== holder;
}

export class ComputerLease extends Domain.Aggregate("ComputerLease", {
  id: ComputerLeaseId,
  state: ComputerLeaseState,
  initial: { _tag: "Free" },
  commands: [AcquireComputerLease, ReleaseComputerLease],
  decide: {
    AcquireComputerLease: (current, cmd) =>
      heldByOther(current, cmd.holder, cmd.now) ? new ComputerLeaseHeld() : [new ComputerLeaseAcquired({ holder: cmd.holder, expiresAt: cmd.expiresAt })],
    ReleaseComputerLease: (current, cmd) =>
      current._tag === "Held" && current.holder === cmd.holder && current.expiresAt > cmd.now ? [new ComputerLeaseReleased()] : new ComputerLeaseNotHeld(),
  },
  evolve: {
    ComputerLeaseAcquired: (_, e) => ({ _tag: "Held" as const, holder: e.holder, expiresAt: e.expiresAt }),
    ComputerLeaseReleased: () => ({ _tag: "Free" as const }),
  },
}) {}
