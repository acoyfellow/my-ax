import { MarkAttentionSeen } from "./MarkAttentionSeen.command";
import type { AttentionCommandName } from "./Attention.aggregate";

export const ALL: Record<AttentionCommandName, new () => object> = {
  MarkAttentionSeen,
};
