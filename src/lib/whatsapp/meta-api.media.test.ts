import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sendMediaMessage } from "./meta-api";

// Capture the JSON body each helper POSTs to Meta so we can assert the
// exact payload shape per media kind without hitting the network.
interface CapturedBody {
  type?: string;
  image?: Record<string, unknown>;
  video?: Record<string, unknown>;
  document?: Record<string, unknown>;
  audio?: Record<string, unknown>;
}
let captured: CapturedBody | null = null;

function okFetch() {
  return vi.fn(async (_url: string, init?: RequestInit) => {
    captured = init?.body ? (JSON.parse(init.body as string) as CapturedBody) : null;
    return {
      ok: true,
      json: async () => ({ messages: [{ id: "wamid.TEST" }] }),
    } as Response;
  });
}

const BASE = {
  phoneNumberId: "test-phone",
  accessToken: "test-token",
  to: "1234567890",
  link: "https://cdn.example.com/file",
} as const;

describe("sendMediaMessage — payload shape", () => {
  beforeEach(() => {
    captured = null;
    vi.stubGlobal("fetch", okFetch());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("sends image with a caption and no filename", async () => {
    await sendMediaMessage({ ...BASE, kind: "image", caption: "hello", filename: "x.png" });
    expect(captured?.type).toBe("image");
    expect(captured?.image).toEqual({ link: BASE.link, caption: "hello" });
    expect(captured?.image?.filename).toBeUndefined();
  });

  it("sends document with both caption and filename", async () => {
    await sendMediaMessage({
      ...BASE,
      kind: "document",
      caption: "invoice",
      filename: "invoice.pdf",
    });
    expect(captured?.type).toBe("document");
    expect(captured?.document).toEqual({
      link: BASE.link,
      caption: "invoice",
      filename: "invoice.pdf",
    });
  });

  it("sends audio with NO caption and NO filename (Meta rejects both)", async () => {
    await sendMediaMessage({
      ...BASE,
      kind: "audio",
      caption: "should be dropped",
      filename: "voice.ogg",
    });
    expect(captured?.type).toBe("audio");
    expect(captured?.audio).toEqual({ link: BASE.link });
  });

  it("throws when no link is provided", async () => {
    await expect(
      sendMediaMessage({ ...BASE, link: "", kind: "image" }),
    ).rejects.toThrow(/requires a link/);
  });
});

describe("getMediaUrl", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("appends phone_number_id query parameter when provided", async () => {
    let capturedUrl = "";
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        capturedUrl = url;
        return {
          ok: true,
          json: async () => ({
            url: "https://lookaside.fbsbx.com/whatsapp_business/attachments/123",
            mime_type: "image/jpeg",
          }),
        } as Response;
      }),
    );

    const { getMediaUrl } = await import("./meta-api");
    const result = await getMediaUrl({
      mediaId: "media-123",
      accessToken: "token-abc",
      phoneNumberId: "phone-456",
    });

    expect(capturedUrl).toContain("media-123?phone_number_id=phone-456");
    expect(result.url).toBe("https://lookaside.fbsbx.com/whatsapp_business/attachments/123");
    expect(result.mimeType).toBe("image/jpeg");
  });

  it("throws MetaApiError with code and details on failure", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        return {
          ok: false,
          status: 400,
          json: async () => ({
            error: {
              message: "Unsupported get request. Object with ID '1077034291635748' does not exist",
              type: "GraphMethodException",
              code: 100,
              error_subcode: 33,
              fbtrace_id: "Az123xyz",
            },
          }),
        } as unknown as Response;
      }),
    );

    const { getMediaUrl, MetaApiError } = await import("./meta-api");
    let caught: unknown = null;
    try {
      await getMediaUrl({
        mediaId: "1077034291635748",
        accessToken: "token-abc",
      });
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(MetaApiError);
    const metaErr = caught as InstanceType<typeof MetaApiError>;
    expect(metaErr.code).toBe(100);
    expect(metaErr.subcode).toBe(33);
    expect(metaErr.fbtraceId).toBe("Az123xyz");
  });
});

