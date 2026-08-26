export function alignTrailing<T>(perUserMessage: readonly T[], userMessageCount: number): Array<T | undefined> {
  if (userMessageCount <= 0) return [];
  const aligned: Array<T | undefined> = new Array(userMessageCount).fill(undefined);
  const shared = Math.min(perUserMessage.length, userMessageCount);
  for (let offset = 1; offset <= shared; offset += 1) {
    aligned[userMessageCount - offset] = perUserMessage[perUserMessage.length - offset];
  }
  return aligned;
}
