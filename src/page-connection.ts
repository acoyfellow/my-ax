export type PageConnectionState = {
  chatVisible?: boolean;
  standalone?: boolean;
  platform?: string | null;
  uaMobile?: boolean;
};

export function pageConnectionScore(state?: PageConnectionState | null): number {
  return (state?.chatVisible ? 4 : 0) + (state?.standalone ? 2 : 0) + (state?.uaMobile ? 1 : 0);
}

export function selectPageConnection<T extends { state?: PageConnectionState | null }>(connections: T[]): T | undefined {
  return [...connections].sort((left, right) => pageConnectionScore(right.state) - pageConnectionScore(left.state))[0];
}

export function selectLivePageConnection<T extends { state?: PageConnectionState | null }>(connections: T[]): T | undefined {
  const target = selectPageConnection(connections);
  if (!target) return undefined;
  if (target.state?.chatVisible === false) return undefined;
  return target;
}
