export function normalizedComputerOwnerEmail(identity: { email: string }): string {
  const email = identity.email.trim().toLowerCase();
  if (!email) throw new Error("A verified owner email is required for Computer.");
  return email;
}

export function computerWorkspaceName(identity: { email: string }): string {
  return normalizedComputerOwnerEmail(identity);
}
