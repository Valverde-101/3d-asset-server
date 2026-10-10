const STORAGE_KEY = "3d-asset-server:disabled-sources:v1";

/** Read the sources hidden from this browser's website searches. */
export function readDisabledSources(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const value: unknown = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "[]");
    return Array.isArray(value) ? [...new Set(value.filter((id): id is string => typeof id === "string"))] : [];
  } catch {
    return [];
  }
}

/** Save only local website preferences. This is not sent to REST API or MCP. */
export function writeDisabledSources(ids: string[]): boolean {
  if (typeof window === "undefined") return false;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify([...new Set(ids)].sort()));
    return true;
  } catch {
    return false;
  }
}

export function enabledSources(allIds: string[], disabledIds = readDisabledSources()): string[] {
  const disabled = new Set(disabledIds);
  return allIds.filter((id) => !disabled.has(id));
}
