import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { PixelLabClient, stripBase64FromErrorText } from "../src/api-client.js";

// Isolate this file's job log from other test files that run in parallel.
const LOG_DIR = join(tmpdir(), "pixellab-forge-test-api-client");
const LOG_FILE = join(LOG_DIR, "jobs.json");

describe("PixelLabClient", () => {
  let client: PixelLabClient;
  let stderrSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    process.env.PIXELLAB_JOB_LOG_DIR = LOG_DIR;
    vi.useFakeTimers();
    client = new PixelLabClient("test-api-key");
    stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    try { rmSync(LOG_FILE); } catch {}
    delete process.env.PIXELLAB_JOB_LOG_DIR;
  });

  describe("GET requests", () => {
    it("sends authorization header", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ balance: 100 }),
      });
      vi.stubGlobal("fetch", mockFetch);

      await client.get("/balance");

      expect(mockFetch).toHaveBeenCalledWith(
        "https://api.pixellab.ai/v2/balance",
        expect.objectContaining({
          method: "GET",
          headers: expect.objectContaining({
            Authorization: "Bearer test-api-key",
          }),
        }),
      );
    });

    it("throws on non-ok response", async () => {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
        text: () => Promise.resolve("Not found"),
      }));

      await expect(client.get("/missing")).rejects.toThrow("GET /missing failed (404)");
    });
  });

  describe("POST requests", () => {
    it("returns data directly on 200", async () => {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
        status: 200,
        json: () => Promise.resolve({ image: "base64data" }),
      }));

      const result = await client.post("/create-image-pixflux", { description: "test" });
      expect(result).toEqual({ image: "base64data" });
    });

    it("returns immediately on 202 with background_job_id (non-blocking)", async () => {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
        status: 202,
        json: () => Promise.resolve({ background_job_id: "job-123" }),
      }));

      const result = await client.post("/generate-image-v2", {}) as any;
      expect(result.status).toBe("processing");
      expect(result.job_id).toBe("job-123");
      expect(result.endpoint).toBe("/generate-image-v2");
      expect(result.message).toContain("job-123");
    });

    it("returns immediately on 202 with job_id (legacy format)", async () => {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
        status: 202,
        json: () => Promise.resolve({ job_id: "legacy-job" }),
      }));

      const result = await client.post("/create-tileset", {}) as any;
      expect(result.status).toBe("processing");
      expect(result.job_id).toBe("legacy-job");
    });

    it("logs job ID to stderr on 202", async () => {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
        status: 202,
        json: () => Promise.resolve({ background_job_id: "logged-job" }),
      }));

      await client.post("/test", {});
      expect(stderrSpy).toHaveBeenCalledWith(
        expect.stringContaining("logged-job"),
      );
    });
  });

  describe("DELETE requests", () => {
    it("returns success on 204", async () => {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
        ok: true,
        status: 204,
      }));

      const result = await client.delete("/characters/123");
      expect(result).toEqual({ success: true });
    });
  });

  describe("getBinary", () => {
    it("returns base64 data, mime type, and filename from headers", async () => {
      const zipBytes = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2, 3]); // "PK.." + payload
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
        ok: true,
        headers: new Map([
          ["content-type", "application/zip"],
          ["content-disposition", 'attachment; filename="hero.zip"'],
        ]),
        arrayBuffer: () => Promise.resolve(zipBytes.buffer),
      }));

      const result = await client.getBinary("/characters/abc/zip");
      expect(result.mimeType).toBe("application/zip");
      expect(result.filename).toBe("hero.zip");
      expect(Buffer.from(result.data, "base64")).toEqual(Buffer.from(zipBytes));
    });

    it("falls back to octet-stream and undefined filename when headers are absent", async () => {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
        ok: true,
        headers: new Map(),
        arrayBuffer: () => Promise.resolve(new Uint8Array([1, 2]).buffer),
      }));

      const result = await client.getBinary("/characters/abc/zip");
      expect(result.mimeType).toBe("application/octet-stream");
      expect(result.filename).toBeUndefined();
    });

    it("throws on non-ok response", async () => {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
        text: () => Promise.resolve("Not found"),
      }));
      await expect(client.getBinary("/characters/missing/zip")).rejects.toThrow("GET /characters/missing/zip failed (404)");
    });
  });
});

describe("stripBase64FromErrorText", () => {
  it("strips long base64 fields from JSON error bodies", () => {
    const blob = "A".repeat(400);
    const out = stripBase64FromErrorText(JSON.stringify({ error: "bad", image: blob }));
    const parsed = JSON.parse(out);
    expect(parsed.error).toBe("bad");
    expect(parsed.image).toBe("[image data stripped]");
  });

  it("strips long base64 runs from non-JSON text", () => {
    const blob = "B".repeat(300);
    const out = stripBase64FromErrorText(`Upload failed: ${blob} end`);
    expect(out).toContain("[image data stripped]");
    expect(out).not.toContain(blob);
  });

  it("leaves short strings untouched", () => {
    const out = stripBase64FromErrorText(JSON.stringify({ message: "short error" }));
    expect(JSON.parse(out).message).toBe("short error");
  });
});
