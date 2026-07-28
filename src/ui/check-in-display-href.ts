export function displayCheckInHref(href: string): string {
  // Rewrite only on a complete path-segment boundary: a bare startsWith would
  // also rewrite unrelated routes like /api/runs-v2 or /api/jobs-old, steering
  // to a different (possibly nonexistent) destination.
  for (const seg of ["attention", "runs", "jobs"]) {
    const prefix = `/api/${seg}`;
    if (href === prefix || href.startsWith(`${prefix}/`) || href.startsWith(`${prefix}?`) || href.startsWith(`${prefix}#`)) {
      return `/${seg}${href.slice(prefix.length)}`;
    }
  }
  return href;
}
