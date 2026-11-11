export type GzipInput = { bytes: number; contentType: string; name: string; supported: boolean };

export type GzipPlan = { compress: boolean; name: string; contentType: string; contentEncoding: "gzip" | null };

export const GZIP_MIN_BYTES = 1024;

export function gzipPlan(input: GzipInput): GzipPlan {
  const baseContentType = input.contentType.split(";")[0];
  const isCompressible =
    baseContentType.startsWith("text/") ||
    baseContentType === "application/json" ||
    baseContentType === "application/x-ndjson" ||
    baseContentType === "application/javascript" ||
    baseContentType === "image/svg+xml";
  const alreadyCompressed = input.name.endsWith(".gz") || baseContentType === "application/gzip";

  const shouldCompress = input.supported && input.bytes >= GZIP_MIN_BYTES && isCompressible && !alreadyCompressed;

  if (shouldCompress) {
    return {
      compress: true,
      name: input.name + ".gz",
      contentType: input.contentType,
      contentEncoding: "gzip",
    };
  }

  return {
    compress: false,
    name: input.name,
    contentType: input.contentType,
    contentEncoding: null,
  };
}
