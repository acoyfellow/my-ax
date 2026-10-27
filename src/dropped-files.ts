export const MAX_DROPPED_FILE_BYTES = 25 * 1024 * 1024;
export const MAX_INLINE_IMAGE_BYTES = 10 * 1024 * 1024;
export const UPLOADS_DIRECTORY = "/home/user/uploads";

const INLINE_IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);

export type DroppedFile = { name: string; type: string; size: number };

export type DropPlan<T extends DroppedFile> = { images: T[]; files: T[]; rejected: Array<{ file: T; reason: string }> };

export function planDroppedFiles<T extends DroppedFile>(dropped: readonly T[]): DropPlan<T> {
  const plan: DropPlan<T> = { images: [], files: [], rejected: [] };
  for (const file of dropped) {
    if (file.size <= 0) plan.rejected.push({ file, reason: `${file.name || "file"} is empty` });
    else if (file.size > MAX_DROPPED_FILE_BYTES) plan.rejected.push({ file, reason: `${file.name || "file"} is larger than 25 MB` });
    else if (INLINE_IMAGE_TYPES.has(file.type) && file.size <= MAX_INLINE_IMAGE_BYTES) plan.images.push(file);
    else plan.files.push(file);
  }
  return plan;
}

export function safeUploadName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "";
  const cleaned = base.replace(/[^A-Za-z0-9._ -]/g, "_").replace(/^[.\s]+/, "").trim().slice(0, 120);
  return cleaned || "file";
}

export function uploadedFilePath(name: string, stamp: string): string {
  const safe = safeUploadName(name);
  const dot = safe.lastIndexOf(".");
  const stem = dot > 0 ? safe.slice(0, dot) : safe;
  const extension = dot > 0 ? safe.slice(dot) : "";
  return `${UPLOADS_DIRECTORY}/${stem}-${stamp}${extension}`;
}

export function withAttachedFilesNote(text: string, paths: readonly string[]): string {
  if (!paths.length) return text;
  const note = `[attached ${paths.length === 1 ? "file" : "files"} saved in your workspace: ${paths.join(", ")}]`;
  return text.trim() ? `${text}\n\n${note}` : note;
}

export function bytesToBase64Chunked(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let index = 0; index < bytes.length; index += chunk) binary += String.fromCharCode(...bytes.subarray(index, index + chunk));
  return btoa(binary);
}

export function isFileDrag(types: ArrayLike<string> | null | undefined): boolean {
  return !!types && Array.from(types).includes("Files");
}
