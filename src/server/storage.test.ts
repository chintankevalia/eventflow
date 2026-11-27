import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { checkUpload, MAX_UPLOAD_BYTES, UploadError } from "./storage";

describe("checkUpload", () => {
  it("accepts the allowed document and image types", () => {
    expect(
      checkUpload("deck.pptx", "application/vnd.openxmlformats-officedocument.presentationml.presentation", 1000)
        .extension,
    ).toBe(".pptx");
    expect(checkUpload("quote.pdf", "application/pdf", 1000).extension).toBe(".pdf");
    expect(checkUpload("photo.JPG", "image/jpeg", 1000).extension).toBe(".jpg");
  });

  it("refuses executables and scripts whatever they claim to be", () => {
    expect(() => checkUpload("payload.exe", "application/pdf", 1000)).toThrow(UploadError);
    expect(() => checkUpload("payload.svg", "image/svg+xml", 1000)).toThrow(UploadError);
    expect(() => checkUpload("payload.html", "text/html", 1000)).toThrow(UploadError);
  });

  it("refuses a type that does not match the extension", () => {
    expect(() => checkUpload("notes.pdf", "text/html", 1000)).toThrow(/does not match/);
  });

  it("refuses empty and oversized files", () => {
    expect(() => checkUpload("empty.pdf", "application/pdf", 0)).toThrow(/empty/);
    expect(() => checkUpload("huge.pdf", "application/pdf", MAX_UPLOAD_BYTES + 1)).toThrow(/25 MB/);
  });

  it("strips directory traversal from the stored display name", () => {
    expect(checkUpload("../../etc/passwd.pdf", "application/pdf", 10).safeName).toBe("passwd.pdf");
    expect(checkUpload("a/b/c/report.pdf", "application/pdf", 10).safeName).toBe("report.pdf");
  });
});

describe("storage backend", () => {
  const saved = { token: process.env.BLOB_READ_WRITE_TOKEN, dir: process.env.STORAGE_DIR };

  afterEach(() => {
    vi.doUnmock("@vercel/blob");
    vi.resetModules();
    if (saved.token === undefined) delete process.env.BLOB_READ_WRITE_TOKEN;
    else process.env.BLOB_READ_WRITE_TOKEN = saved.token;
    if (saved.dir === undefined) delete process.env.STORAGE_DIR;
    else process.env.STORAGE_DIR = saved.dir;
  });

  it("uses the local disk when no Blob token is set, and round-trips a file", async () => {
    delete process.env.BLOB_READ_WRITE_TOKEN;
    process.env.STORAGE_DIR = await mkdtemp(path.join(tmpdir(), "eventflow-storage-"));
    vi.resetModules();
    const storage = await import("./storage");

    expect(storage.storageBackend()).toBe("disk");
    const { key } = await storage.putFile("events/e1", ".pdf", Buffer.from("hello"));
    expect(key).toMatch(/^events\/e1\/\d{4}-\d{2}\/[0-9a-f]{32}\.pdf$/);
    expect((await storage.getFile(key)).toString()).toBe("hello");
    await storage.deleteFile(key);
    await expect(storage.getFile(key)).rejects.toThrow();
  });

  it("stores private blobs under the generated key when a Blob token is set", async () => {
    process.env.BLOB_READ_WRITE_TOKEN = "vercel_blob_rw_test";
    const blobs = new Map<string, Buffer>();
    const put = vi.fn(async (key: string, body: Buffer) => {
      blobs.set(key, body);
      return { pathname: key };
    });
    const get = vi.fn(async (key: string) =>
      blobs.has(key) ? { statusCode: 200, stream: new Blob([new Uint8Array(blobs.get(key)!)]).stream() } : null,
    );
    const del = vi.fn(async (key: string) => void blobs.delete(key));
    vi.doMock("@vercel/blob", () => ({ put, get, del }));
    vi.resetModules();
    const storage = await import("./storage");

    expect(storage.storageBackend()).toBe("blob");
    const { key } = await storage.putFile("events/e1", ".pdf", Buffer.from("hello"));
    expect(put).toHaveBeenCalledWith(key, expect.any(Buffer), {
      access: "private",
      addRandomSuffix: false,
      allowOverwrite: false,
    });
    expect((await storage.getFile(key)).toString()).toBe("hello");
    expect(get).toHaveBeenCalledWith(key, { access: "private" });

    await storage.deleteFile(key);
    expect(del).toHaveBeenCalledWith(key);
    await expect(storage.getFile(key)).rejects.toThrow(/not found/);
  });

  it("refuses blob keys that are URLs or path escapes", async () => {
    const { checkBlobKey, UploadError } = await import("./storage");
    expect(() => checkBlobKey("https://evil.example/x.pdf")).toThrow(UploadError);
    expect(() => checkBlobKey("/events/x.pdf")).toThrow(UploadError);
    expect(() => checkBlobKey("events/../secrets.pdf")).toThrow(UploadError);
    expect(checkBlobKey("events/e1/2026-11/abc.pdf")).toBe("events/e1/2026-11/abc.pdf");
  });
});
