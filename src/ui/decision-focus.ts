export type DecisionFocusEnv = {
  find(decisionId: string): HTMLElement | null;
  wait(ms: number): Promise<void>;
  announce(decisionId: string): void;
};

export async function focusDecision(decisionId: string, env: DecisionFocusEnv, attempts = 25, intervalMs = 400): Promise<boolean> {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const element = env.find(decisionId);
    if (element) {
      element.scrollIntoView({ block: "center", behavior: "smooth" });
      element.classList.remove("decision-focus");
      void element.offsetWidth;
      element.classList.add("decision-focus");
      env.announce(decisionId);
      return true;
    }
    await env.wait(intervalMs);
  }
  return false;
}

export function browserDecisionFocusEnv(): DecisionFocusEnv {
  return {
    find: (decisionId) => document.querySelector<HTMLElement>(`[data-decision-id="${CSS.escape(decisionId)}"]`),
    wait: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    announce: (decisionId) => window.dispatchEvent(new CustomEvent("my-ax:decision-focus", { detail: { decisionId } })),
  };
}
