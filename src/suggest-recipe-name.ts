// Pure snippet naming/description/portability helpers, extracted so they're
// testable without the Worker-only work-tools imports. Fixes the recipe-audit
// gaps: no more `WorkCodeRecipe_<epoch>` names; a portability signal.

const HOST_NAMESPACES = new Set(["machine", "workspace", "terrarium"]);

export function isPortable(capabilities: string[]): boolean {
  // A `<ns>.none` sentinel explicitly means "needs no host binding" and is
  // portable; only a real host-namespace method (machine.shell, workspace.read)
  // makes a snippet machine-bound.
  return !capabilities.some((cap) => {
    const [ns, method] = cap.split(".");
    return HOST_NAMESPACES.has(ns) && method !== "none";
  });
}

const clean = (s: string) =>
  s.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40);

function fallbackName(code: string): string {
  let h = 0;
  for (let i = 0; i < code.length; i++) h = (h * 31 + code.charCodeAt(i)) >>> 0;
  return `snippet_${h.toString(36).slice(0, 6)}`;
}

// Propose a snake_case name from what the code does; never a bare timestamp.
export function suggestRecipeName(code: string): string {
  const comment = code.match(/^\s*\/\/\s*(?:name:\s*)?([a-zA-Z][ \t\w-]{2,40})/);
  if (comment) return clean(comment[1]) || fallbackName(code);
  const call = code.match(/\b(?:machine|workspace|terrarium)\.(\w+)/);
  const returned = code.match(/return\s+(?:JSON\.stringify\()?\{\s*(\w+)/);
  if (call && returned) return clean(`${call[1]}_${returned[1]}`);
  if (returned) return clean(`compute_${returned[1]}`);
  if (call) return clean(`run_${call[1]}`);
  return fallbackName(code);
}

export function suggestRecipeDescription(code: string, caps: string[]): string {
  const hostCap = caps.find((c) => /^(machine|workspace|terrarium)\./.test(c));
  const verb = code.match(/return\s+(?:JSON\.stringify\()?\{\s*(\w+)/)?.[1];
  if (verb && hostCap) return `Computes { ${verb}, ... } via ${hostCap}. Review before enabling.`;
  if (verb) return `Computes { ${verb}, ... } from its input. Portable. Review before enabling.`;
  return "Reusable code from a successful work_code run.";
}
