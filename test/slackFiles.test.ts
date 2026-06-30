import { describe, it, expect, vi } from "vitest";
import { downloadSlackImages } from "../src/slackFiles.js";

function res(ok: boolean, bytes: Uint8Array) {
  return { ok, arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) };
}

describe("downloadSlackImages", () => {
  it("returns [] for no files", async () => {
    expect(await downloadSlackImages(undefined, "t")).toEqual([]);
    expect(await downloadSlackImages([], "t")).toEqual([]);
  });

  it("downloads images with the bearer token and base64-encodes them", async () => {
    const bytes = new Uint8Array([1, 2, 3, 4]);
    const fetchFn = vi.fn(async () => res(true, bytes));
    const files = [{ mimetype: "image/png", url_private_download: "https://files.slack.com/a.png" }];
    const out = await downloadSlackImages(files, "xoxb-123", fetchFn as any);
    expect(out).toEqual([{ mediaType: "image/png", data: Buffer.from(bytes).toString("base64") }]);
    expect(fetchFn).toHaveBeenCalledWith("https://files.slack.com/a.png", {
      headers: { Authorization: "Bearer xoxb-123" },
    });
  });

  it("skips non-image files", async () => {
    const fetchFn = vi.fn(async () => res(true, new Uint8Array([1])));
    const files = [{ mimetype: "application/pdf", url_private_download: "u" }];
    expect(await downloadSlackImages(files, "t", fetchFn as any)).toEqual([]);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("skips files with a failed download and keeps going", async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(res(false, new Uint8Array([0])))
      .mockResolvedValueOnce(res(true, new Uint8Array([9, 9])));
    const files = [
      { mimetype: "image/png", url_private_download: "bad" },
      { mimetype: "image/jpeg", url_private_download: "good" },
    ];
    const out = await downloadSlackImages(files, "t", fetchFn as any);
    expect(out).toEqual([{ mediaType: "image/jpeg", data: Buffer.from([9, 9]).toString("base64") }]);
  });

  it("caps at 4 images", async () => {
    const fetchFn = vi.fn(async () => res(true, new Uint8Array([1])));
    const files = Array.from({ length: 6 }, () => ({ mimetype: "image/png", url_private_download: "u" }));
    const out = await downloadSlackImages(files, "t", fetchFn as any);
    expect(out).toHaveLength(4);
  });
});
