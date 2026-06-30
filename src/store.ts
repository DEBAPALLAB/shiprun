import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync } from "node:fs";
import { join } from "node:path";
import type { Finding } from "./types.js";

export type FindingStatus = "open" | "resolved" | "dismissed";

export interface StoredFinding extends Finding {
  status: FindingStatus;
  firstSeen: string;
  lastSeen: string;
  resolvedAt?: string;
  dismissedAt?: string;
  dismissedReason?: string;
}

export interface FindingsStore {
  version: 1;
  findings: Record<string, StoredFinding>;
}

export interface ReconcileResult {
  active: StoredFinding[]; // open, currently detected, not dismissed — what goes in the report
  dismissed: StoredFinding[]; // currently detected but suppressed
  newCount: number;
  resolvedCount: number;
}

function shiprunDir(root: string): string {
  return join(root, ".shiprun");
}

function storePath(root: string): string {
  return join(shiprunDir(root), "findings.json");
}

function historyPath(root: string): string {
  return join(shiprunDir(root), "history.jsonl");
}

export function loadStore(root: string): FindingsStore {
  const path = storePath(root);
  if (!existsSync(path)) {
    return { version: 1, findings: {} };
  }
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return { version: 1, findings: {} };
  }
}

export function saveStore(root: string, store: FindingsStore): void {
  const dir = shiprunDir(root);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(storePath(root), JSON.stringify(store, null, 2), "utf8");
}

export function appendHistory(root: string, entry: Record<string, unknown>): void {
  const dir = shiprunDir(root);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  appendFileSync(historyPath(root), `${JSON.stringify({ timestamp: new Date().toISOString(), ...entry })}\n`, "utf8");
}

/**
 * Merges freshly-detected findings into the persisted store.
 * - New findings are recorded as "open".
 * - Previously-open findings no longer detected are marked "resolved".
 * - Findings marked "dismissed" stay dismissed (and out of the report) even if still detected.
 */
export function reconcile(root: string, current: Finding[]): ReconcileResult {
  const store = loadStore(root);
  const now = new Date().toISOString();
  const currentIds = new Set(current.map((f) => f.id));

  let newCount = 0;
  let resolvedCount = 0;

  for (const finding of current) {
    const existing = store.findings[finding.id];
    if (!existing) {
      store.findings[finding.id] = { ...finding, status: "open", firstSeen: now, lastSeen: now };
      newCount++;
    } else {
      existing.lastSeen = now;
      // refresh detail/severity/line in case the underlying check evolved
      existing.title = finding.title;
      existing.detail = finding.detail;
      existing.severity = finding.severity;
      existing.line = finding.line;
      if (existing.status === "resolved") {
        existing.status = "open"; // it's back
      }
    }
  }

  for (const [id, stored] of Object.entries(store.findings)) {
    if (stored.status === "open" && !currentIds.has(id)) {
      stored.status = "resolved";
      stored.resolvedAt = now;
      resolvedCount++;
    }
  }

  saveStore(root, store);

  const active = Object.values(store.findings).filter((f) => f.status === "open");
  const dismissed = Object.values(store.findings).filter((f) => f.status === "dismissed" && currentIds.has(f.id));

  return { active, dismissed, newCount, resolvedCount };
}

export function dismissFinding(root: string, id: string, reason?: string): StoredFinding | undefined {
  const store = loadStore(root);
  const finding = store.findings[id];
  if (!finding) return undefined;
  finding.status = "dismissed";
  finding.dismissedAt = new Date().toISOString();
  if (reason) finding.dismissedReason = reason;
  saveStore(root, store);
  return finding;
}

export function reopenFinding(root: string, id: string): StoredFinding | undefined {
  const store = loadStore(root);
  const finding = store.findings[id];
  if (!finding) return undefined;
  finding.status = "open";
  finding.dismissedAt = undefined;
  finding.dismissedReason = undefined;
  finding.resolvedAt = undefined;
  saveStore(root, store);
  return finding;
}

export function listAllFindings(root: string): StoredFinding[] {
  const store = loadStore(root);
  return Object.values(store.findings);
}
