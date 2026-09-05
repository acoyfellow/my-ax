export async function persistBeforeWorkspaceDestroy(
  snapshot: () => Promise<unknown>,
  destroy: () => Promise<void>,
): Promise<void> {
  await snapshot();
  await destroy();
}
