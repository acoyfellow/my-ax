import type { Env } from "./types";
import type { AccessIdentity } from "./auth";

export type AppEnv = {
  Bindings: Env;
  Variables: { identity: AccessIdentity };
};
