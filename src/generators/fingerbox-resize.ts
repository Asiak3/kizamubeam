/** A distribution of plain ones is equivalent to the automatic equal distribution. */
export function isDefaultDistribution(spec: string, count: number): boolean {
  if (!Number.isInteger(count) || count < 1 || count > 20) return false;
  const fields = spec.split(':');
  return fields.length === count && fields.every((v) => v.trim() === '1');
}

/** Resizes a complete user distribution without evaluating or changing its expressions.
 * null means the existing text is incomplete; it must remain untouched for correction. */
export function resizeDistribution(spec: string, oldCount: number, count: number): { text: string; removed: string[] } | null {
  if (!spec || !Number.isInteger(oldCount) || !Number.isInteger(count) || count < 1 || count > 20) return null;
  const fields = spec.split(':');
  if (fields.length !== oldCount || fields.some((v) => !v.trim())) return null;
  const removed = fields.slice(count).filter((v) => v.trim() !== '1');
  const fieldsNew = fields.slice(0, count);
  while (fieldsNew.length < count) fieldsNew.push('1');
  return { text: fieldsNew.join(':'), removed };
}