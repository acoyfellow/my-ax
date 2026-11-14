import * as Domain from "@alchemy.run/domain";
import { RunId } from "./Run.id";
import { RunNotFound, RunTransitionRefused } from "./RunRejections.rejection";

export class ReceiptRecorded extends Domain.Event("ReceiptRecorded", {}) {}

export class RecordReceipt extends Domain.Command("RecordReceipt", {
  target: RunId,
  events: [ReceiptRecorded],
  rejects: [RunNotFound, RunTransitionRefused],
}) {}
