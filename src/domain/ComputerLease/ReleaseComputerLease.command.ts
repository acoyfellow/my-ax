import * as Domain from "@alchemy.run/domain";
import * as Schema from "effect/Schema";
import { ComputerLeaseId } from "./ComputerLease.id";
import { ComputerLeaseNotHeld } from "./ComputerLeaseRejections.rejection";

export class ComputerLeaseReleased extends Domain.Event("ComputerLeaseReleased", {}) {}

export class ReleaseComputerLease extends Domain.Command("ReleaseComputerLease", {
  target: ComputerLeaseId,
  input: { holder: Schema.String, now: Schema.Number },
  events: [ComputerLeaseReleased],
  rejects: [ComputerLeaseNotHeld],
}) {}
