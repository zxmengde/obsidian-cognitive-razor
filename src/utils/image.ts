import { Result, err, ok } from "../types";

const DATA_URL_REGEX = /data:image\/[a-zA-Z0-9.+-]+;base64,[A-Za-z0-9+/=]+/;

/** 从 Markdown 图片引用中提取 data URL */
export function extractMarkdownDataUrl(markdown: string): string | null {
  const match = markdown.match(DATA_URL_REGEX);
  return match ? match[0] : null;
}

/** 将 data URL 解码为 ArrayBuffer */
export function dataUrlToArrayBuffer(dataUrl: string): Result<ArrayBuffer> {
  try {
    const parts = dataUrl.split(",");
    if (parts.length !== 2) {
      return err("E998", "data URL 格式不正确");
    }
    const base64 = parts[1];
    const binary = Uint8Array.from(Buffer.from(base64, "base64"));
    return ok(binary.buffer);
  } catch (error) {
    return err("E998", "解析 data URL 失败", error);
  }
}

/** 从 data URL 推断扩展名 */
export function inferImageExtension(dataUrl: string): string {
  const mimeMatch = dataUrl.match(/data:(image\/[a-zA-Z0-9.+-]+);base64/);
  if (!mimeMatch) return "png";
  const mime = mimeMatch[1];
  const subtype = mime.split("/")[1] || "png";
  if (subtype.includes("jpeg")) return "jpg";
  return subtype;
}
