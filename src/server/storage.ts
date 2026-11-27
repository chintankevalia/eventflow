import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

/**
 * File storage behind a small interface so the local disk can be swapped for S3-compatible
 * object storage later without touching callers. Keys are generated here and never taken
 * from the client, so an uploaded name can't escape the storage root.
 */

export const STORAGE_ROOT = path.resolve(process.env.STORAGE_DIR ?? "storage");

/** Accepted upload types, by extension and the content type browsers send for them. */
export const ALLOWED_UPLOADS: Record<string, string[]> = {
  ".pdf": ["application/pdf"],
  ".ppt": ["application/vnd.ms-powerpoint"],
  ".pptx": ["application/vnd.openxmlformats-officedocument.presentationml.presentation"],
  ".doc": ["application/msword"],
  ".docx": ["application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
  ".xls": ["application/vnd.ms-excel"],
  ".xlsx": ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],
  ".csv": ["text/csv", "application/csv"],
  ".png": ["image/png"],
  ".jpg": ["image/jpeg"],
  ".jpeg": ["image/jpeg"],
  ".webp": ["image/webp"],
};

export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024; // 25 MB

export class UploadError extends Error {}

/** Checks the extension and declared type, and returns a safe display name. */
export function checkUpload(fileName: string, contentType: string, sizeBytes: number) {
  if (sizeBytes <= 0) throw new UploadError("The file is empty.");
  if (sizeBytes > MAX_UPLOAD_BYTES) throw new UploadError("Files must be 25 MB or smaller.");

  const extension = path.extname(fileName).toLowerCase();
  const allowedTypes = ALLOWED_UPLOADS[extension];
  if (!allowedTypes) {
    throw new UploadError(`${extension || "That file type"} is not allowed. Use PDF, Office, CSV or an image.`);
  }
  const declared = contentType.split(";")[0].trim().toLowerCase();
  if (declared && !allowedTypes.includes(declared) && declared !== "application/octet-stream") {
    throw new UploadError("The file's type does not match its extension.");
  }

  // Keep a readable name but strip anything path-like or control-ish.
  const safeName =
    path
      .basename(fileName)
      .replace(/[\u0000-\u001f\\/:*?"<>|]/g, "")
      .trim()
      .slice(-120) || `file${extension}`;
  return { extension, safeName, contentType: allowedTypes[0] };
}

/**
 * Where files live. With a Vercel Blob token set (Vercel adds BLOB_READ_WRITE_TOKEN when a Blob
 * store is connected to the project) files go to Vercel Blob, because a Vercel deployment has no
 * disk that survives between requests. Otherwise they stay on the local disk under STORAGE_ROOT,
 * which is what local development and the Docker deployment use.
 *
 * Blobs are stored as private: they are only ever served through /api/attachments/[id], which
 * checks the viewer may see the event, never through a public blob URL.
 */
export function storageBackend(): "blob" | "disk" {
  return process.env.BLOB_READ_WRITE_TOKEN ? "blob" : "disk";
}

/** Writes bytes under a generated key: <scope>/<yyyy-mm>/<random>.<ext> */
export async function putFile(scope: string, extension: string, bytes: Buffer) {
  const month = new Date().toISOString().slice(0, 7);
  const key = path.posix.join(scope, month, `${randomBytes(16).toString("hex")}${extension}`);
  const checksum = createHash("sha256").update(bytes).digest("hex");

  if (storageBackend() === "blob") {
    const { put } = await import("@vercel/blob");
    // The key is already random, so keep it as the blob's pathname exactly; never overwrite.
    await put(key, bytes, { access: "private", addRandomSuffix: false, allowOverwrite: false });
    return { key, checksum };
  }

  const target = path.join(STORAGE_ROOT, key);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, bytes);
  return { key, checksum };
}

function resolveKey(key: string) {
  const target = path.resolve(STORAGE_ROOT, key);
  // Defence in depth: never read or delete outside the storage root.
  if (target !== STORAGE_ROOT && !target.startsWith(STORAGE_ROOT + path.sep)) {
    throw new UploadError("Invalid file reference.");
  }
  return target;
}

/** Reads a stored file. Throws when it no longer exists. */
export async function getFile(key: string): Promise<Buffer> {
  if (storageBackend() === "blob") {
    const { get } = await import("@vercel/blob");
    const result = await get(checkBlobKey(key), { access: "private" });
    if (!result || result.statusCode !== 200) throw new UploadError("File not found.");
    return Buffer.from(await new Response(result.stream).arrayBuffer());
  }
  return readFile(resolveKey(key));
}

export async function deleteFile(key: string) {
  if (storageBackend() === "blob") {
    const { del } = await import("@vercel/blob");
    await del(checkBlobKey(key)).catch(() => {});
    return;
  }
  await unlink(resolveKey(key)).catch(() => {});
}

/** Keys are always ones putFile generated; refuse anything that looks like a URL or a path escape. */
export function checkBlobKey(key: string) {
  if (
    !key ||
    key.includes("://") ||
    key.startsWith("/") ||
    key.split("/").some((part) => part === ".." || part === "")
  ) {
    throw new UploadError("Invalid file reference.");
  }
  return key;
}
