import type { Env } from "./types";
import type { AccessIdentity } from "./auth";
import { logAssistantMessage } from "./conversation-log";
import { notifyOwner } from "./notify";
import { recoveryExhaustionContract, sequenceRecoveryExhaustion, type RecoveryExhaustionContractInput } from "./recovery-exhaustion-contract";

export type RecoveryExhaustionInput = RecoveryExhaustionContractInput;

/** Persist the owner-visible terminal state for an exhausted recovery attempt. */
type RecoveryExhaustionDependencies = {
  logAssistant: typeof logAssistantMessage;
  notify: typeof notifyOwner;
};
const DEFAULT_DEPENDENCIES: RecoveryExhaustionDependencies = { logAssistant: logAssistantMessage, notify: notifyOwner };

export async function recordRecoveryExhaustion(
  env: Env,
  identity: AccessIdentity,
  sessionId: string,
  input: RecoveryExhaustionInput,
  dependencies: RecoveryExhaustionDependencies = DEFAULT_DEPENDENCIES,
): Promise<void> {
  const contract = recoveryExhaustionContract(sessionId, input);
  await sequenceRecoveryExhaustion(
    () => dependencies.logAssistant(env, identity, sessionId, input.terminalMessage, contract.transcriptMeta),
    () => env.DB.prepare("UPDATE sessions SET status = 'interrupted', updated_at = datetime('now') WHERE id = ? AND owner_email = ?")
      .bind(sessionId, identity.email)
      .run(),
    () => dependencies.notify(env, identity.email, contract.notification),
  );
}
