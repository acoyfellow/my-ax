import * as Domain from "@alchemy.run/domain";
import * as Schema from "effect/Schema";
import { ComputerLeaseId } from "./ComputerLease.id";
import { ComputerLeaseHeld } from "./ComputerLeaseRejections.rejection";

export class ComputerLeaseAcquired extends Domain.Event("ComputerLeaseAcquired", { holder: Schema.String, expiresAt: Schema.Number }) {}

export class AcquireComputerLease extends Domain.Command("AcquireComputerLease", {
  target: ComputerLeaseId,
  input: { holder: Schema.String, expiresAt: Schema.Number, now: Schema.Number },
  events: [ComputerLeaseAcquired],
  rejects: [ComputerLeaseHeld],
}) {}
