export type WorkspaceVerification =
  | { kind: "cold"; epoch: number }
  | { kind: "booting"; epoch: number }
  | { kind: "verified"; epoch: number };

export type WorkspaceVerificationEvent = "boot_started" | "boot_succeeded" | "boot_failed" | "stopped" | "replaced" | "found_not_running";

export function initialVerification(): WorkspaceVerification {
  return { kind: "cold", epoch: 0 };
}

export function nextVerification(state: WorkspaceVerification, event: WorkspaceVerificationEvent, bootEpoch = state.epoch): WorkspaceVerification {
  switch (event) {
    case "boot_started":
      return state.kind === "booting" ? state : { kind: "booting", epoch: state.epoch };
    case "boot_succeeded":
      return state.kind === "booting" && bootEpoch === state.epoch ? { kind: "verified", epoch: state.epoch } : state;
    case "boot_failed":
      return state.kind === "booting" && bootEpoch === state.epoch ? { kind: "cold", epoch: state.epoch } : state;
    case "stopped":
    case "replaced":
      return { kind: "cold", epoch: state.epoch + 1 };
    case "found_not_running":
      return state.kind === "verified" ? { kind: "cold", epoch: state.epoch } : state;
  }
}

export function bootIsCurrent(state: WorkspaceVerification, bootEpoch: number): boolean {
  return state.kind === "booting" && state.epoch === bootEpoch;
}
