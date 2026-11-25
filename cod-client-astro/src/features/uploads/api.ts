import { ApiError, apiFetch } from "@/lib/api";
import { IMAGE_TYPES, MEDIA_MAX_BYTES, isImageType, type ImageType, type UploadFolder } from "../../../../cod-shared/media/keys";
import type { MediaImage } from "../../../../cod-shared/media/model";
import type { UploadSend, UploadTicket } from "../../../../cod-shared/media/library";

export type ImageUploadFolder = UploadFolder;
export type { MediaImage };

export const ACCEPTED_IMAGE_TYPES: readonly string[] = IMAGE_TYPES;
export const IMAGE_ACCEPT = [...IMAGE_TYPES, ".jpg", ".jpeg", ".png", ".webp", ".gif"].join(",");
export const MAX_UPLOAD_MB = MEDIA_MAX_BYTES / (1024 * 1024);

const TYPE_FROM_EXTENSION: Record<string, ImageType> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
};

/** Some browsers hand a file over with no useful MIME type; its extension still names the image. */
export function imageTypeOf(file: File): ImageType | null {
  if (file.type && file.type !== "application/octet-stream") {
    return isImageType(file.type) ? file.type : null;
  }
  const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
  return TYPE_FROM_EXTENSION[extension] ?? null;
}

export type ImageUploadRejection = "unsupported_type" | "file_too_large";

export class ImageUploadRejectedError extends Error {
  constructor(public readonly reason: ImageUploadRejection) {
    super(reason === "unsupported_type" ? "Unsupported file type" : `File exceeds ${MAX_UPLOAD_MB} MB`);
    this.name = "ImageUploadRejectedError";
  }
}

/** The store's media host refused or could not take the file the ticket sent it. */
export class ImageUploadFailedError extends Error {
  constructor(public readonly status: number) {
    super(`Upload failed: ${status}`);
    this.name = "ImageUploadFailedError";
  }
}

interface DataEnvelope<T> {
  success: boolean;
  data: T;
}

function json(init: RequestInit = {}): RequestInit {
  return { ...init, headers: { ...init.headers, "Content-Type": "application/json" } };
}

/** An Upload Ticket for this file: where and how to send it. */
export async function requestUpload(file: File, folder: ImageUploadFolder): Promise<UploadTicket> {
  const contentType = imageTypeOf(file);
  if (!contentType) throw new ImageUploadRejectedError("unsupported_type");
  return (
    await apiFetch<DataEnvelope<UploadTicket>>(
      "/api/media/uploads",
      json({ method: "POST", body: JSON.stringify({ folder, contentType, bytes: file.size }) }),
    )
  ).data;
}

/**
 * Sends the file as its ticket says: a form to the media host, a PUT to a
 * signed URL, or a PUT to the store's server. Answers the host's own id for
 * the file when it gives one (a form upload's `fileId`).
 */
export async function sendUpload(send: UploadSend, file: File): Promise<{ hostRef: string | null }> {
  if (send.kind === "relay") {
    await apiFetch<void>(send.url, { method: send.method, headers: send.headers, body: file });
    return { hostRef: null };
  }
  if (send.kind === "put") {
    const response = await fetch(send.url, { method: send.method, headers: send.headers, body: file });
    if (!response.ok) throw new ImageUploadFailedError(response.status);
    return { hostRef: null };
  }
  const form = new FormData();
  for (const [name, value] of Object.entries(send.fields)) form.append(name, value);
  form.append(send.fileField, file, send.fields.fileName ?? file.name);
  const response = await fetch(send.url, { method: send.method, body: form });
  if (!response.ok) throw new ImageUploadFailedError(response.status);
  const { fileId } = (await response.json()) as { fileId?: string };
  return { hostRef: fileId ?? null };
}

/** The upload, confirmed by the store's server: the image as every answer carries it. */
export async function completeUpload(mediaId: string, report: { hostRef: string | null; width: number | null; height: number | null }): Promise<MediaImage> {
  return (
    await apiFetch<DataEnvelope<MediaImage>>(`/api/media/uploads/${encodeURIComponent(mediaId)}/complete`, json({ method: "POST", body: JSON.stringify(report) }))
  ).data;
}

/** Same selection semantics the three uploaders had: unsupported types are
 *  counted over ALL selected files, oversized only over the type-accepted
 *  ones; `accepted` passes both filters. */
export function partitionUploadFiles(files: File[]): {
  accepted: File[];
  unsupportedCount: number;
  tooLargeCount: number;
} {
  const unsupportedCount = files.filter((file) => imageTypeOf(file) === null).length;
  const typeAccepted = files.filter((file) => imageTypeOf(file) !== null);
  const tooLargeCount = typeAccepted.filter((file) => file.size > MEDIA_MAX_BYTES).length;
  return {
    accepted: typeAccepted.filter((file) => file.size <= MEDIA_MAX_BYTES),
    unsupportedCount,
    tooLargeCount,
  };
}

/** Throws ImageUploadRejectedError for a file that must not be uploaded. */
export function validateUploadFile(file: File): void {
  if (imageTypeOf(file) === null) throw new ImageUploadRejectedError("unsupported_type");
  if (file.size > MEDIA_MAX_BYTES) throw new ImageUploadRejectedError("file_too_large");
}

/** Intrinsic pixel size of a file, measured locally. Resolves null on decode
 *  failure or in non-DOM runtimes — dimension capture is fail-open, never
 *  blocks an upload; the host's own measure is kept when it has one. */
export function measureImageDimensions(file: File): Promise<{ width: number; height: number } | null> {
  if (typeof Image === "undefined" || typeof URL?.createObjectURL !== "function") {
    return Promise.resolve(null);
  }
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img.naturalWidth > 0 && img.naturalHeight > 0 ? { width: img.naturalWidth, height: img.naturalHeight } : null);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(null);
    };
    img.src = url;
  });
}

export type UploadFailure =
  | "unsupported_file"
  | "file_too_large"
  | "upload_failed"
  | "upload_expired"
  | "media_not_configured"
  | "media_host_refused"
  | "media_host_unavailable";

/** Why an upload failed, as the `common` namespace's `feedback.*` key that says it. */
export function uploadFailure(cause: unknown): UploadFailure {
  if (cause instanceof ImageUploadRejectedError) return cause.reason === "unsupported_type" ? "unsupported_file" : "file_too_large";
  if (cause instanceof ImageUploadFailedError) return cause.status >= 500 || cause.status === 429 ? "media_host_unavailable" : "media_host_refused";
  if (cause instanceof ApiError) {
    switch (cause.code) {
      case "INVALID_FILE_TYPE":
        return "unsupported_file";
      case "FILE_TOO_LARGE":
        return "file_too_large";
      case "MEDIA_NOT_CONFIGURED":
        return "media_not_configured";
      case "MEDIA_HOST_REFUSED":
        return "media_host_refused";
      case "MEDIA_HOST_UNAVAILABLE":
        return "media_host_unavailable";
      case "MEDIA_UPLOAD_UNKNOWN":
      case "MEDIA_UPLOAD_MISSING":
      case "MEDIA_UPLOAD_MISMATCH":
        return "upload_expired";
    }
  }
  return "upload_failed";
}

/** Ticket → send → measure → complete. One implementation for all dashboard uploads. */
export async function uploadImageFile(file: File, folder: ImageUploadFolder): Promise<MediaImage> {
  validateUploadFile(file);
  const ticket = await requestUpload(file, folder);
  const { hostRef } = await sendUpload(ticket.send, file);
  const size = await measureImageDimensions(file);
  return completeUpload(ticket.mediaId, { hostRef, width: size?.width ?? null, height: size?.height ?? null });
}
