/** Splits a total (0-100) into Onyx, model and the rest, each clamped so they add up to it. */
export function splitUsage(total: number, onyx: number | null, model: number | null) {
  const onyxPart = Math.min(total, Math.max(0, onyx ?? 0));
  const modelPart = Math.min(total - onyxPart, Math.max(0, model ?? 0));
  return [onyxPart, modelPart, total - onyxPart - modelPart] as const;
}
