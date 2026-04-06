import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { readFileSync, writeFileSync, rmSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// The job-log module uses a fixed path. We test it as-is.
import {
  logJobStart,
  logJobComplete,
  logJobFailed,
  getPendingJobs,
  getJobLog,
} from "../src/job-log.js";

const LOG_DIR = join(tmpdir(), "pixelforge");
const LOG_FILE = join(LOG_DIR, "jobs.json");

describe("Job log", () => {
  beforeEach(() => {
    // Clear the log file before each test
    try {
      rmSync(LOG_FILE);
    } catch {
      // doesn't exist yet
    }
  });

  afterEach(() => {
    try {
      rmSync(LOG_FILE);
    } catch {
      // cleanup
    }
  });

  it("starts with no jobs", () => {
    expect(getPendingJobs()).toEqual([]);
    expect(getJobLog()).toEqual([]);
  });

  it("logs a new job as pending", () => {
    logJobStart("job-1", "/generate-image-v2");

    const pending = getPendingJobs();
    expect(pending).toHaveLength(1);
    expect(pending[0].id).toBe("job-1");
    expect(pending[0].endpoint).toBe("/generate-image-v2");
    expect(pending[0].status).toBe("pending");
  });

  it("marks a job as completed", () => {
    logJobStart("job-2", "/create-tileset");
    logJobComplete("job-2");

    const pending = getPendingJobs();
    expect(pending).toHaveLength(0);

    const log = getJobLog();
    expect(log).toHaveLength(1);
    expect(log[0].status).toBe("completed");
    expect(log[0].completed).toBeDefined();
  });

  it("marks a job as failed", () => {
    logJobStart("job-3", "/inpaint-v3");
    logJobFailed("job-3");

    const pending = getPendingJobs();
    expect(pending).toHaveLength(0);

    const log = getJobLog();
    expect(log[0].status).toBe("failed");
  });

  it("tracks multiple jobs independently", () => {
    logJobStart("job-a", "/generate-image-v2");
    logJobStart("job-b", "/create-character-with-4-directions");
    logJobStart("job-c", "/animate-character");

    logJobComplete("job-a");
    logJobFailed("job-c");

    const pending = getPendingJobs();
    expect(pending).toHaveLength(1);
    expect(pending[0].id).toBe("job-b");
  });

  it("persists to disk", () => {
    logJobStart("job-disk", "/rotate");

    const raw = readFileSync(LOG_FILE, "utf-8");
    const data = JSON.parse(raw);
    expect(data).toHaveLength(1);
    expect(data[0].id).toBe("job-disk");
  });

  it("prunes completed jobs older than 24h", () => {
    // Write a stale completed entry directly
    const staleEntry = {
      id: "old-job",
      endpoint: "/test",
      status: "completed",
      created: new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString(),
      completed: new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString(),
    };

    mkdirSync(LOG_DIR, { recursive: true });
    writeFileSync(LOG_FILE, JSON.stringify([staleEntry]));

    // Adding a new job triggers pruning
    logJobStart("new-job", "/test");

    const log = getJobLog();
    const ids = log.map((e) => e.id);
    expect(ids).not.toContain("old-job");
    expect(ids).toContain("new-job");
  });

  it("keeps pending jobs even if old", () => {
    // Start with a clean slate
    try { rmSync(LOG_FILE); } catch {}

    const stalePending = {
      id: "old-pending",
      endpoint: "/test",
      status: "pending" as const,
      created: new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString(),
    };

    mkdirSync(LOG_DIR, { recursive: true });
    writeFileSync(LOG_FILE, JSON.stringify([stalePending]));

    logJobStart("new-job", "/test");

    const pending = getPendingJobs();
    const ids = pending.map((e) => e.id);
    expect(ids).toContain("old-pending");
    expect(ids).toContain("new-job");
  });
});
