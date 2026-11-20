export function recurringJobCount(value: unknown): number {
  const count = Number(value);
  return Number.isFinite(count) && count > 0 ? Math.floor(count) : 0;
}

export function recurringJobText(count: number): string {
  return count === 1 ? "1 recurring job runs in this conversation" : `${count} recurring jobs run in this conversation`;
}
