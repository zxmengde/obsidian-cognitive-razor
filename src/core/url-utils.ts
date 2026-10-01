const MAX_EXTERNAL_URL_LENGTH = 2048;

/** Accept only external HTTP(S) links and remove embedded credentials. */
export function normalizeExternalHttpUrl(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const raw = value.trim();
  if (!raw || raw.length > MAX_EXTERNAL_URL_LENGTH) return undefined;
  try {
    const url = new URL(raw);
    if (url.protocol !== "http:" && url.protocol !== "https:") return undefined;
    url.username = "";
    url.password = "";
    return url.toString().replace(/\(/g, "%28").replace(/\)/g, "%29");
  } catch {
    return undefined;
  }
}
