import { logJobStart } from "./job-log.js";

const BASE_URL = "https://api.pixellab.ai/v2";

function stripBase64FromErrorText(text: string): string {
  try {
    const json = JSON.parse(text);
    stripBase64Fields(json);
    return JSON.stringify(json);
  } catch {
    return text.replace(/[A-Za-z0-9+/]{200,}={0,2}/g, "[image data stripped]");
  }
}

function stripBase64Fields(val: unknown): void {
  if (!val || typeof val !== "object") return;
  if (Array.isArray(val)) {
    val.forEach(stripBase64Fields);
    return;
  }
  const obj = val as Record<string, unknown>;
  for (const key of Object.keys(obj)) {
    const v = obj[key];
    if (typeof v === "string" && v.length > 200 && /^[A-Za-z0-9+/]/.test(v)) {
      obj[key] = "[image data stripped]";
    } else {
      stripBase64Fields(v);
    }
  }
}

function debugLog(msg: string) {
  process.stderr.write(`[pixellab-forge-mcp] ${msg}\n`);
}

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

  async getBinary(path: string): Promise<{ data: string; mimeType: string; filename?: string }> {
    const res = await fetch(`${BASE_URL}${path}`, {
      method: "GET",
      headers: this.headers(),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`GET ${path} failed (${res.status}): ${text}`);
    }
    const mimeType = res.headers.get("content-type") ?? "application/octet-stream";
    const disposition = res.headers.get("content-disposition") ?? "";
    const filenameMatch = disposition.match(/filename[^;=\n]*=["']?([^"';\n]+)/i);
    const filename = filenameMatch ? filenameMatch[1].trim() : undefined;
    const buf = await res.arrayBuffer();
    const data = Buffer.from(buf).toString("base64");
    return { data, mimeType, filename };
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
    const jsonBody = JSON.stringify(body);
    debugLog(`POST ${path} — payload size: ${jsonBody.length} bytes`);

    // Extract description for job logging
    const desc = body && typeof body === "object"
      ? (body as Record<string, unknown>).description as string | undefined
        ?? (body as Record<string, unknown>).text as string | undefined
      : undefined;

    const res = await fetch(`${BASE_URL}${path}`, {
      method: "POST",
      headers: this.headers(),
      body: jsonBody,
    });

    debugLog(`POST ${path} — response status: ${res.status}`);

    if (res.status === 200) {
      return res.json();
    }

    if (res.status === 202) {
      const data = (await res.json()) as { job_id?: string; background_job_id?: string };
      const jobId = data.job_id ?? data.background_job_id;
      debugLog(`POST ${path} — background job: ${jobId}`);
      if (jobId) {
        logJobStart(jobId, path, desc);
      }
      return {
        status: "processing",
        job_id: jobId,
        endpoint: path,
        message: `Job ${jobId} is processing. Use get_job_status with this job_id to check progress and retrieve results.`,
      };
    }

    const text = await res.text();
    debugLog(`POST ${path} — ERROR ${res.status}: ${text}`);
    throw new Error(`POST ${path} failed (${res.status}): ${stripBase64FromErrorText(text)}`);
  }
}
