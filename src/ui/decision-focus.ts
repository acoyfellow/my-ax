export type DecisionFocusEnv = {
  find(decisionId: string): HTMLElement | null;
  wait(ms: number): Promise<void>;
  announce(decisionId: string): void;
  loadOlder?: () => Promise<boolean>;
};

function revealEnclosingDetails(element: HTMLElement): void {
  let cursor: HTMLElement | null = element.parentElement ?? null;
  while (cursor) {
    if (cursor.tagName === "DETAILS") (cursor as HTMLDetailsElement).open = true;
    cursor = cursor.parentElement ?? null;
  }
}

export async function focusDecision(decisionId: string, env: DecisionFocusEnv, attempts = 25, intervalMs = 400): Promise<boolean> {
  let pagesLoaded = 0;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const element = env.find(decisionId);
    if (element) {
      revealEnclosingDetails(element);
      element.scrollIntoView({ block: "center", behavior: "smooth" });
      element.classList.remove("decision-focus");
      void element.offsetWidth;
      element.classList.add("decision-focus");
      env.announce(decisionId);
      return true;
    }
    if (env.loadOlder && pagesLoaded < 6 && attempt > 0) {
      const loaded = await env.loadOlder().catch(() => false);
      if (loaded) {
        pagesLoaded += 1;
        await env.wait(60);
        continue;
      }
    }
    await env.wait(intervalMs);
  }
  return false;
}

export function browserDecisionFocusEnv(options?: { loadOlder?: () => Promise<boolean> }): DecisionFocusEnv {
  return {
    find: (decisionId) => document.querySelector<HTMLElement>(`[data-decision-id="${CSS.escape(decisionId)}"]`),
    wait: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    announce: (decisionId) => window.dispatchEvent(new CustomEvent("my-ax:decision-focus", { detail: { decisionId } })),
    ...(options?.loadOlder ? { loadOlder: options.loadOlder } : {}),
  };
}
