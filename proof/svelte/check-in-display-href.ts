export function displayCheckInHref(href: string): string {
  if (href.startsWith("/api/attention")) return href.replace("/api/attention", "/attention");
  if (href.startsWith("/api/runs")) return href.replace("/api/runs", "/runs");
  if (href.startsWith("/api/jobs")) return href.replace("/api/jobs", "/jobs");
  return href;
}
