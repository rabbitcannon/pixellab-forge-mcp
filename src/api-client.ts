import { logJobStart, logJobComplete, logJobFailed } from "./job-log.js";

const BASE_URL = "https://api.pixellab.ai/v2";
const POLL_INTERVAL_MS = 2000;
const MAX_POLL_ATTEMPTS = 300; // 10 minutes max
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 5000;

export class PixelLabClient {
  private apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  private headers(contentType = "application/json"): Record<string, string> {
    return {
      Authorization: `Bearer ${this.apiKey}`,
      "Content-Type": contentType,
    };
  }

  async get(path: string): Promise<unknown> {
    const res = await fetch(`${BASE_URL}${path}`, {
      method: "GET",
      headers: this.headers(),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`GET ${path} failed (${res.status}): ${text}`);
    }
    return res.json();
  }

  async delete(path: string): Promise<unknown> {
    const res = await fetch(`${BASE_URL}${path}`, {
      method: "DELETE",
      headers: this.headers(),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`DELETE ${path} failed (${res.status}): ${text}`);
    }
    if (res.status === 204) return { success: true };
    return res.json();
  }

  async patch(path: string, body: unknown): Promise<unknown> {
    const res = await fetch(`${BASE_URL}${path}`, {
      method: "PATCH",
      headers: this.headers(),
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`PATCH ${path} failed (${res.status}): ${text}`);
    }
    return res.json();
  }

  async post(path: string, body: unknown): Promise<unknown> {
    const res = await fetch(`${BASE_URL}${path}`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify(body),
    });

    if (res.status === 200) {
      return res.json();
    }

    if (res.status === 202) {
      const data = (await res.json()) as { job_id?: string; background_job_id?: string };
      const jobId = data.job_id ?? data.background_job_id;
      if (jobId) {
        return this.pollJob(jobId, path);
      }
      return data;
    }

    const text = await res.text();
    throw new Error(`POST ${path} failed (${res.status}): ${text}`);
  }

  private async pollJob(jobId: string, endpoint: string): Promise<unknown> {
    process.stderr.write(`[pixelforge-mcp] Background job started: ${jobId} (${endpoint})\n`);
    logJobStart(jobId, endpoint);

    for (let i = 0; i < MAX_POLL_ATTEMPTS; i++) {
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));

      let res: Response;
      try {
        res = await fetch(`${BASE_URL}/background-jobs/${jobId}`, {
          method: "GET",
          headers: this.headers(),
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        process.stderr.write(`[pixelforge-mcp] Poll error for job ${jobId}: ${message}, retrying...\n`);

        let recovered = false;
        for (let retry = 0; retry < MAX_RETRIES; retry++) {
          await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS * (retry + 1)));
          try {
            res = await fetch(`${BASE_URL}/background-jobs/${jobId}`, {
              method: "GET",
              headers: this.headers(),
            });
            recovered = true;
            break;
          } catch {
            process.stderr.write(`[pixelforge-mcp] Retry ${retry + 1}/${MAX_RETRIES} failed for job ${jobId}\n`);
          }
        }

        if (!recovered) {
          logJobFailed(jobId);
          throw new Error(
            `Lost connection while polling job ${jobId} after ${MAX_RETRIES} retries. Use get_job_status with job_id "${jobId}" to retrieve the result later.`
          );
        }
      }

      if (res!.status === 423) {
        continue;
      }

      if (!res!.ok) {
        const text = await res!.text();
        logJobFailed(jobId);
        throw new Error(
          `Job ${jobId} poll failed (${res!.status}): ${text}`
        );
      }

      const data = (await res!.json()) as { status?: string };
      if (data.status === "processing" || data.status === "pending") {
        continue;
      }

      logJobComplete(jobId);
      return data;
    }

    // Timed out but job may still finish - leave as pending in the log
    throw new Error(
      `Job ${jobId} is still processing after ${MAX_POLL_ATTEMPTS * POLL_INTERVAL_MS / 1000}s. Use get_job_status with job_id "${jobId}" to check on it later.`
    );
  }
}
