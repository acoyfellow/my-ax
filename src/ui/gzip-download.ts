import { gzipPlan } from "./web/gzip-plan";

export type GzipDeps = {
  enabled: () => boolean;
  receipt: (text: string) => void;
  save: (blob: Blob, name: string) => void;
};

function kb(bytes: number): string {
  return (bytes / 1024).toFixed(1);
}

export function saveBlob(blob: Blob, name: string): void {
  if (typeof document === "undefined" || typeof URL === "undefined" || !URL.createObjectURL) return;
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function downloadMaybeGzip(blob: Blob, name: string, deps: GzipDeps): Promise<void> {
  const plan = gzipPlan({
    bytes: blob.size,
    contentType: blob.type || "text/plain",
    name,
    supported: typeof CompressionStream !== "undefined" && deps.enabled(),
  });
  if (!plan.compress) {
    deps.save(blob, name);
    return;
  }
  try {
    const stream = blob.stream().pipeThrough(new CompressionStream("gzip"));
    const out = await new Response(stream).blob();
    const zipped = new Blob([out], { type: "application/gzip" });
    deps.save(zipped, plan.name);
    deps.receipt(`Downloaded ${plan.name} (gzip, ${kb(blob.size)} KB to ${kb(zipped.size)} KB)`);
  } catch {
    deps.save(blob, name);
  }
}
