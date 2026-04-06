import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { PixelLabClient } from "../src/api-client.js";

describe("PixelLabClient", () => {
  let client: PixelLabClient;
  let stderrSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.useFakeTimers();
    client = new PixelLabClient("test-api-key");
    stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
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

    it("polls on 202 with background_job_id", async () => {
      let callCount = 0;
      vi.stubGlobal("fetch", vi.fn().mockImplementation((url: string) => {
        if (url.includes("/background-jobs/")) {
          callCount++;
          if (callCount < 3) {
            return Promise.resolve({
              ok: true,
              status: 200,
              json: () => Promise.resolve({ status: "processing" }),
            });
          }
          return Promise.resolve({
            ok: true,
            status: 200,
            json: () => Promise.resolve({ status: "completed", image: "done" }),
          });
        }
        return Promise.resolve({
          status: 202,
          json: () => Promise.resolve({ background_job_id: "job-123" }),
        });
      }));

      const promise = client.post("/generate-image-v2", {});
      // Advance through 3 poll cycles (2s each)
      for (let i = 0; i < 3; i++) {
        await vi.advanceTimersByTimeAsync(2000);
      }
      const result = await promise as any;
      expect(result.status).toBe("completed");
      expect(result.image).toBe("done");
      expect(callCount).toBe(3);
    });

    it("polls on 202 with job_id (legacy format)", async () => {
      vi.stubGlobal("fetch", vi.fn().mockImplementation((url: string) => {
        if (url.includes("/background-jobs/")) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: () => Promise.resolve({ status: "completed", data: "result" }),
          });
        }
        return Promise.resolve({
          status: 202,
          json: () => Promise.resolve({ job_id: "legacy-job" }),
        });
      }));

      const promise = client.post("/create-tileset", {});
      await vi.advanceTimersByTimeAsync(2000);
      const result = await promise as any;
      expect(result.status).toBe("completed");
    });

    it("handles 423 (still processing) during polling", async () => {
      let pollCount = 0;
      vi.stubGlobal("fetch", vi.fn().mockImplementation((url: string) => {
        if (url.includes("/background-jobs/")) {
          pollCount++;
          if (pollCount === 1) {
            return Promise.resolve({ status: 423 });
          }
          return Promise.resolve({
            ok: true,
            status: 200,
            json: () => Promise.resolve({ status: "completed" }),
          });
        }
        return Promise.resolve({
          status: 202,
          json: () => Promise.resolve({ background_job_id: "job-423" }),
        });
      }));

      const promise = client.post("/test", {});
      await vi.advanceTimersByTimeAsync(4000);
      await promise;
      expect(pollCount).toBe(2);
    });

    it("logs job ID to stderr on 202", async () => {
      vi.stubGlobal("fetch", vi.fn().mockImplementation((url: string) => {
        if (url.includes("/background-jobs/")) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: () => Promise.resolve({ status: "completed" }),
          });
        }
        return Promise.resolve({
          status: 202,
          json: () => Promise.resolve({ background_job_id: "logged-job" }),
        });
      }));

      const promise = client.post("/test", {});
      await vi.advanceTimersByTimeAsync(2000);
      await promise;
      expect(stderrSpy).toHaveBeenCalledWith(
        expect.stringContaining("logged-job"),
      );
    });

    it("throws with job ID on poll failure", async () => {
      vi.stubGlobal("fetch", vi.fn().mockImplementation((url: string) => {
        if (url.includes("/background-jobs/")) {
          return Promise.resolve({
            ok: false,
            status: 500,
            text: () => Promise.resolve("Internal error"),
          });
        }
        return Promise.resolve({
          status: 202,
          json: () => Promise.resolve({ background_job_id: "fail-job" }),
        });
      }));

      // Attach the rejection handler BEFORE advancing timers
      const promise = client.post("/test", {}).catch((e: Error) => e);
      await vi.advanceTimersByTimeAsync(2000);
      const error = await promise;
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toContain("fail-job");
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
});
