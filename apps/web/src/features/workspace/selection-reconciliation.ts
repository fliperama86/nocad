export function reconcileControlledSelection(
  currentSelectedIds: readonly string[],
  controlledSelectedId: string | undefined
): ReadonlySet<string> {
  if (!controlledSelectedId) return new Set();
  return currentSelectedIds.includes(controlledSelectedId)
    ? new Set(currentSelectedIds)
    : new Set([controlledSelectedId]);
}
