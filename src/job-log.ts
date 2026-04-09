import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

interface JobEntry {
  id: string;
  endpoint: string;
  status: "pending" | "completed" | "failed";
  created: string; // ISO timestamp
  completed?: string;
}

const LOG_DIR = join(tmpdir(), "pixellab-forge");
const LOG_FILE = join(LOG_DIR, "jobs.json");
const MAX_ENTRIES = 200;
const TTL_HOURS = 24;

function ensureDir() {
  try {
    mkdirSync(LOG_DIR, { recursive: true });
  } catch {
    // already exists
  }
}

function readLog(): JobEntry[] {
  try {
    return JSON.parse(readFileSync(LOG_FILE, "utf-8")) as JobEntry[];
  } catch {
    return [];
  }
}

function writeLog(entries: JobEntry[]) {
  ensureDir();
  writeFileSync(LOG_FILE, JSON.stringify(entries, null, 2));
}

/** Remove completed jobs older than TTL and cap total entries */
function prune(entries: JobEntry[]): JobEntry[] {
  const cutoff = Date.now() - TTL_HOURS * 60 * 60 * 1000;

  const pruned = entries.filter((e) => {
    // Always keep pending jobs (they might still be recoverable)
    if (e.status === "pending") return true;
    // Remove completed/failed jobs older than TTL
    const ts = new Date(e.completed ?? e.created).getTime();
    return ts > cutoff;
  });

  // Cap at MAX_ENTRIES, keeping newest
  if (pruned.length > MAX_ENTRIES) {
    return pruned.slice(pruned.length - MAX_ENTRIES);
  }
  return pruned;
}

export function logJobStart(jobId: string, endpoint: string) {
  const entries = prune(readLog());
  entries.push({
    id: jobId,
    endpoint,
    status: "pending",
    created: new Date().toISOString(),
  });
  writeLog(entries);
}

export function logJobComplete(jobId: string) {
  const entries = readLog();
  const entry = entries.find((e) => e.id === jobId);
  if (entry) {
    entry.status = "completed";
    entry.completed = new Date().toISOString();
    writeLog(prune(entries));
  }
}

export function logJobFailed(jobId: string) {
  const entries = readLog();
  const entry = entries.find((e) => e.id === jobId);
  if (entry) {
    entry.status = "failed";
    entry.completed = new Date().toISOString();
    writeLog(prune(entries));
  }
}

export function getPendingJobs(): JobEntry[] {
  return readLog().filter((e) => e.status === "pending");
}

export function getJobLog(): JobEntry[] {
  return prune(readLog());
}

export function getJobEndpoint(jobId: string): string | undefined {
  const entry = readLog().find((e) => e.id === jobId);
  return entry?.endpoint;
}
