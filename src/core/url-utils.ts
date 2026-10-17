const MAX_EXTERNAL_URL_LENGTH = 2048;

/** Accept only external HTTP(S) links; remove credentials and UTM tracking. */
export function normalizeExternalHttpUrl(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const raw = value.trim();
  if (!raw || raw.length > MAX_EXTERNAL_URL_LENGTH) return undefined;
  try {
    const url = new URL(raw);
    if (url.protocol !== "http:" && url.protocol !== "https:") return undefined;
    url.username = "";
    url.password = "";
    // Preserve other query bytes, including encoded values and signatures.
    url.search = url.search.slice(1).split("&").filter(part => {
      try { return !/^utm_/i.test(decodeURIComponent(part.split("=", 1)[0].replace(/\+/g, " "))); }
      catch { return true; }
    }).join("&");
    return url.toString().replace(/\(/g, "%28").replace(/\)/g, "%29");
  } catch {
    return undefined;
  }
}
