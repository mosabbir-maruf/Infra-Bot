const KV_PREFIX = 'bandwidth_limit:';

export async function getEffectiveBandwidthLimit(
  kv: { get(key: string): Promise<string | null> } | undefined,
  alias: string,
  configLimit?: number,
): Promise<number | undefined> {
  if (!kv) return configLimit;
  const raw = await kv.get(`${KV_PREFIX}${alias.toLowerCase()}`);
  if (raw && raw.trim().length > 0) {
    const parsed = parseFloat(raw);
    if (!isNaN(parsed) && parsed > 0) return parsed;
  }
  return configLimit;
}
