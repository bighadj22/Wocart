import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const seam = vi.hoisted(() => {
  class ApiError extends Error {
    constructor(message: string, public status: number, public code?: string) {
      super(message);
    }
  }
  return { apiFetch: vi.fn(), ApiError };
});
vi.mock("@/lib/api", () => seam);

import type { UploadSend, UploadTicket } from "../../../../cod-shared/media/library";
import {
  ACCEPTED_IMAGE_TYPES,
  ImageUploadFailedError,
  ImageUploadRejectedError,
  MAX_UPLOAD_MB,
  completeUpload,
  measureImageDimensions,
  partitionUploadFiles,
  requestUpload,
  sendUpload,
  uploadFailure,
  uploadImageFile,
  validateUploadFile,
} from "./api";

function makeFile(input: { type?: string; size?: number; name?: string } = {}): File {
  const { type = "image/jpeg", size = 100, name = "img.jpg" } = input;
  return new File([new Uint8Array(size)], name, { type });
}

const FORM: UploadSend = {
  kind: "form",
  method: "POST",
  url: "https://upload.imagekit.io/api/v2/files/upload",
  fields: { token: "jwt", fileName: "3f2a.jpg" },
  fileField: "file",
};
const WEBP_FORM: UploadSend = {
  ...FORM,
  fields: { token: "jwt", fileName: "3f2a.webp" },
};
const PUT: UploadSend = { kind: "put", method: "PUT", url: "https://bucket.example/signed", headers: { "Content-Type": "image/jpeg" } };
const RELAY: UploadSend = { kind: "relay", method: "PUT", url: "/api/media/uploads/m1/content", headers: { "Content-Type": "image/jpeg" } };

const ticket = (send: UploadSend): UploadTicket => ({ mediaId: "m1", key: "products/3f2a.jpg", expiresAt: "2026-10-30T12:10:00.000Z", send });
const IMAGE = { key: "products/3f2a.jpg", url: "https://ik.imagekit.io/acct/products/3f2a.jpg", width: 1200, height: 900 };

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("requestUpload", () => {
  it("asks for a ticket with the folder, the file's type and its size", async () => {
    seam.apiFetch.mockResolvedValue({ success: true, data: ticket(FORM) });

    await expect(requestUpload(makeFile({ type: "image/png", size: 321 }), "landing")).resolves.toEqual(ticket(FORM));
    const [path, init] = seam.apiFetch.mock.calls[0] as [string, RequestInit];
    expect(path).toBe("/api/media/uploads");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({ folder: "landing", contentType: "image/png", bytes: 321 });
  });

  it("asks for a WebP ticket from the extension when the browser gives no MIME type", async () => {
    seam.apiFetch.mockResolvedValue({ success: true, data: ticket(FORM) });
    const file = makeFile({ type: "", name: "logo.webp", size: 321 });

    await expect(requestUpload(file, "products")).resolves.toEqual(ticket(FORM));
    const [, init] = seam.apiFetch.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toEqual({ folder: "products", contentType: "image/webp", bytes: 321 });
  });
});

describe("sendUpload", () => {
  it("posts a form with the ticket's fields and the file under the ticket's name, and answers the host's fileId", async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ fileId: "ik-file-1" }));
    vi.stubGlobal("fetch", fetchMock);
    const file = makeFile();

    await expect(sendUpload(FORM, file)).resolves.toEqual({ hostRef: "ik-file-1" });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(FORM.url);
    expect(init.method).toBe("POST");
    const form = init.body as FormData;
    expect(form.get("token")).toBe("jwt");
    expect((form.get("file") as File).name).toBe("3f2a.jpg");
    expect((form.get("file") as File).size).toBe(file.size);
    expect(init.headers).toBeUndefined();
    expect(seam.apiFetch).not.toHaveBeenCalled();
  });

  it("sends a WebP part with the ticket's MIME type when the browser reports none", async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ fileId: "ik-file-webp" }));
    vi.stubGlobal("fetch", fetchMock);
    const file = makeFile({ type: "", name: "photo.webp" });

    await expect(sendUpload(WEBP_FORM, file, "image/webp")).resolves.toEqual({ hostRef: "ik-file-webp" });
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const part = (init.body as FormData).get("file") as File;
    expect(part.name).toBe("3f2a.webp");
    expect(part.type).toBe("image/webp");
    expect(part.size).toBe(file.size);
  });

  it("answers no host reference when the form's answer names no file", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({})));

    await expect(sendUpload(FORM, makeFile())).resolves.toEqual({ hostRef: null });
  });

  it("puts the file to a signed URL with the ticket's headers", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const file = makeFile();

    await expect(sendUpload(PUT, file)).resolves.toEqual({ hostRef: null });
    expect(fetchMock).toHaveBeenCalledWith(PUT.url, { method: "PUT", headers: PUT.headers, body: file });
    expect(seam.apiFetch).not.toHaveBeenCalled();
  });

  it("relays the file through the store's server, signed in, never with a bare fetch", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    seam.apiFetch.mockResolvedValue(undefined);
    const file = makeFile();

    await expect(sendUpload(RELAY, file)).resolves.toEqual({ hostRef: null });
    expect(seam.apiFetch).toHaveBeenCalledWith(RELAY.url, { method: "PUT", headers: RELAY.headers, body: file });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    ["form", FORM],
    ["put", PUT],
  ] as const)("fails with the host's status when a %s upload is refused", async (_kind, send) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{}", { status: 403 })));

    await expect(sendUpload(send, makeFile())).rejects.toMatchObject({ name: "ImageUploadFailedError", status: 403 });
  });
});

describe("completeUpload", () => {
  it("reports the upload and answers the image", async () => {
    seam.apiFetch.mockResolvedValue({ success: true, data: IMAGE });

    await expect(completeUpload("m/1", { hostRef: "ik-file-1", width: 10, height: 20 })).resolves.toEqual(IMAGE);
    const [path, init] = seam.apiFetch.mock.calls[0] as [string, RequestInit];
    expect(path).toBe("/api/media/uploads/m%2F1/complete");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({ hostRef: "ik-file-1", width: 10, height: 20 });
  });
});

describe("uploadImageFile (ticket → send → complete)", () => {
  it("completes with the host's reference and answers the server's image", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ fileId: "ik-file-1" })));
    seam.apiFetch.mockResolvedValueOnce({ success: true, data: ticket(FORM) }).mockResolvedValueOnce({ success: true, data: IMAGE });

    await expect(uploadImageFile(makeFile(), "products")).resolves.toEqual(IMAGE);
    const [path, init] = seam.apiFetch.mock.calls[1] as [string, RequestInit];
    expect(path).toBe("/api/media/uploads/m1/complete");
    expect(JSON.parse(init.body as string)).toEqual({ hostRef: "ik-file-1", width: null, height: null });
  });

  it("keeps the WebP MIME type from the ticket through to the host", async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ fileId: "ik-file-webp" }));
    vi.stubGlobal("fetch", fetchMock);
    seam.apiFetch
      .mockResolvedValueOnce({ success: true, data: ticket(WEBP_FORM) })
      .mockResolvedValueOnce({ success: true, data: { ...IMAGE, key: "products/3f2a.webp" } });

    await uploadImageFile(makeFile({ type: "", name: "photo.webp" }), "products");
    const form = fetchMock.mock.calls[0][1].body as FormData;
    expect((form.get("file") as File).type).toBe("image/webp");
    const [, init] = seam.apiFetch.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(init.body as string).contentType).toBe("image/webp");
  });

  it("never completes an upload the host refused", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{}", { status: 400 })));
    seam.apiFetch.mockResolvedValueOnce({ success: true, data: ticket(FORM) });

    await expect(uploadImageFile(makeFile(), "products")).rejects.toBeInstanceOf(ImageUploadFailedError);
    expect(seam.apiFetch).toHaveBeenCalledTimes(1);
  });

  it("asks for no ticket when the file is refused", async () => {
    vi.stubGlobal("fetch", vi.fn());

    await expect(uploadImageFile(makeFile({ type: "application/zip" }), "landing")).rejects.toBeInstanceOf(ImageUploadRejectedError);
    expect(seam.apiFetch).not.toHaveBeenCalled();
  });
});

describe("uploadFailure", () => {
  it.each([
    [new ImageUploadRejectedError("unsupported_type"), "unsupported_file"],
    [new ImageUploadRejectedError("file_too_large"), "file_too_large"],
    [new ImageUploadFailedError(403), "media_host_refused"],
    [new ImageUploadFailedError(429), "media_host_unavailable"],
    [new ImageUploadFailedError(503), "media_host_unavailable"],
    [new seam.ApiError("x", 400, "INVALID_FILE_TYPE"), "unsupported_file"],
    [new seam.ApiError("x", 413, "FILE_TOO_LARGE"), "file_too_large"],
    [new seam.ApiError("x", 503, "MEDIA_NOT_CONFIGURED"), "media_not_configured"],
    [new seam.ApiError("x", 502, "MEDIA_HOST_REFUSED"), "media_host_refused"],
    [new seam.ApiError("x", 503, "MEDIA_HOST_UNAVAILABLE"), "media_host_unavailable"],
    [new seam.ApiError("x", 404, "MEDIA_UPLOAD_UNKNOWN"), "upload_expired"],
    [new seam.ApiError("x", 409, "MEDIA_UPLOAD_MISSING"), "upload_expired"],
    [new seam.ApiError("x", 409, "MEDIA_UPLOAD_MISMATCH"), "upload_expired"],
    [new seam.ApiError("x", 500, "INTERNAL"), "upload_failed"],
    [new TypeError("Failed to fetch"), "upload_failed"],
  ])("says %o as %s", (cause, key) => {
    expect(uploadFailure(cause)).toBe(key);
  });
});

describe("file validation", () => {
  it("accepts every image type the server takes", () => {
    for (const type of ACCEPTED_IMAGE_TYPES) expect(() => validateUploadFile(makeFile({ type }))).not.toThrow();
  });

  it("accepts an image the browser sends without a MIME type, using its extension", () => {
    const webp = makeFile({ type: "", name: "logo.webp" });
    expect(() => validateUploadFile(webp)).not.toThrow();
    expect(partitionUploadFiles([webp])).toEqual({ accepted: [webp], unsupportedCount: 0, tooLargeCount: 0 });
  });

  it("refuses an unsupported type", () => {
    expect(() => validateUploadFile(makeFile({ type: "application/pdf" }))).toThrow(expect.objectContaining({ reason: "unsupported_type" }) as never);
  });

  it("refuses a file over the cap and accepts one exactly at it", () => {
    expect(() => validateUploadFile(makeFile({ size: MAX_UPLOAD_MB * 1024 * 1024 + 1 }))).toThrow(expect.objectContaining({ reason: "file_too_large" }) as never);
    expect(() => validateUploadFile(makeFile({ size: MAX_UPLOAD_MB * 1024 * 1024 }))).not.toThrow();
  });

  it("partitions a selection: unsupported over all files, oversized over the supported ones", () => {
    const good = makeFile({ type: "image/png" });
    const big = makeFile({ type: "image/png", size: MAX_UPLOAD_MB * 1024 * 1024 + 5 });
    const bad = makeFile({ type: "text/html" });

    expect(partitionUploadFiles([good, big, bad, bad])).toEqual({ accepted: [good], unsupportedCount: 2, tooLargeCount: 1 });
    expect(partitionUploadFiles([])).toEqual({ accepted: [], unsupportedCount: 0, tooLargeCount: 0 });
  });
});

describe("measureImageDimensions", () => {
  it("resolves null in non-DOM runtimes (fail-open)", async () => {
    await expect(measureImageDimensions(makeFile())).resolves.toBeNull();
  });
});
