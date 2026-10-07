export const DEFAULT_TRACE_BUDGET = 4096;

export function parsePositiveInteger(value: string | number, name: string, max = Number.MAX_SAFE_INTEGER): number {
  const numberValue = typeof value === "number" ? value : Number(value);
  if (!Number.isSafeInteger(numberValue) || numberValue < 1 || numberValue > max) {
    throw new RangeError(`${name} 必须是 1 到 ${max} 的整数`);
  }
  return numberValue;
}
