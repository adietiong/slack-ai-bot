import type { ImageInput } from "./claudeDriver.js";

// Slack attaches uploaded files to the event as `files[]`. Downloading the
// bytes requires the `files:read` scope and a Bearer bot token — the
// url_private(_download) URLs are NOT public. We base64-encode images so they
// can be passed to Claude as image content blocks.
const MAX_IMAGES = 4;
const MAX_BYTES = 6 * 1024 * 1024; // 6 MB per image — keeps the request sane

type FetchLike = (
  url: string,
  init?: { headers?: Record<string, string> }
) => Promise<{ ok: boolean; arrayBuffer: () => Promise<ArrayBuffer> }>;

export async function downloadSlackImages(
  files: any[] | undefined,
  botToken: string,
  fetchFn: FetchLike = fetch as unknown as FetchLike
): Promise<ImageInput[]> {
  if (!files || files.length === 0) {
    return [];
  }
  const images: ImageInput[] = [];
  for (const f of files) {
    if (images.length >= MAX_IMAGES) {
      break;
    }
    const mime: string = f?.mimetype ?? "";
    if (!mime.startsWith("image/")) {
      continue;
    }
    const url: string | undefined = f?.url_private_download ?? f?.url_private;
    if (!url) {
      continue;
    }
    try {
      const res = await fetchFn(url, { headers: { Authorization: `Bearer ${botToken}` } });
      if (!res.ok) {
        continue;
      }
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length === 0 || buf.length > MAX_BYTES) {
        continue;
      }
      images.push({ mediaType: mime, data: buf.toString("base64") });
    } catch {
      continue; // a bad download shouldn't kill the whole message
    }
  }
  return images;
}
