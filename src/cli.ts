#!/usr/bin/env node
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { Command } from "commander";
import pc from "picocolors";
import { runScan } from "./scan.js";
import { renderMarkdown, readinessScore } from "./report.js";
import { reconcile, dismissFinding, reopenFinding, listAllFindings, appendHistory } from "./store.js";
import type { FindingStatus } from "./store.js";

const program = new Command();

program
  .name("shiprun")
  .description("Scans your vibe-coded Next.js + Supabase app and tells you exactly what's missing to make it production-ready.")
  .version("0.3.0");

program
  .command("scan", { isDefault: true })
  .description("Scan the current repo and write an open-findings checklist to SHIPRUN.md")
  .option("-o, --out <file>", "output file", "SHIPRUN.md")
  .action(async (opts: { out: string }) => {
    const root = process.cwd();
    console.log(pc.dim(`Scanning ${root} ...`));

    const { stack, findings } = await runScan(root);

    if (!stack.isNextJs) {
      console.log(pc.yellow("Warning: this doesn't look like a Next.js project. Checks are tuned for Next.js + Supabase and may find little."));
    }

    const { active, dismissed, newCount, resolvedCount } = reconcile(root, findings);

    const markdown = renderMarkdown(stack, active, { newCount, resolvedCount, dismissedCount: dismissed.length });
    const outPath = join(root, opts.out);
    writeFileSync(outPath, markdown, "utf8");

    appendHistory(root, {
      totalDetected: findings.length,
      open: active.length,
      newCount,
      resolvedCount,
      dismissedCount: dismissed.length,
    });

    const critical = active.filter((f) => f.severity === "critical").length;
    const high = active.filter((f) => f.severity === "high").length;
    const score = readinessScore(active);
    const scoreColor = score >= 90 ? pc.green : score >= 70 ? pc.yellow : pc.red;

    console.log("");
    console.log(scoreColor(pc.bold(`Readiness: ${score}/100`)));
    console.log(
      pc.bold(`${active.length} open finding(s)`) +
        (critical ? pc.red(`  ${critical} critical`) : "") +
        (high ? pc.yellow(`  ${high} high`) : "") +
        (newCount ? pc.dim(`  (${newCount} new)`) : "") +
        (resolvedCount ? pc.green(`  ${resolvedCount} resolved`) : "")
    );
    console.log(pc.dim(`Written to ${opts.out}`));
  });

program
  .command("dismiss <id>")
  .description("Suppress a finding so future scans don't include it in SHIPRUN.md")
  .option("-r, --reason <reason>", "why this is being dismissed")
  .action((id: string, opts: { reason?: string }) => {
    const root = process.cwd();
    const finding = dismissFinding(root, id, opts.reason);
    if (!finding) {
      console.log(pc.red(`No finding with id "${id}" found. Run "shiprun scan" first, or "shiprun list --all" to see known ids.`));
      process.exitCode = 1;
      return;
    }
    console.log(pc.green(`Dismissed: ${finding.title}`));
  });

program
  .command("reopen <id>")
  .description("Undo a dismissal (or a resolution) so the finding is open again")
  .action((id: string) => {
    const root = process.cwd();
    const finding = reopenFinding(root, id);
    if (!finding) {
      console.log(pc.red(`No finding with id "${id}" found.`));
      process.exitCode = 1;
      return;
    }
    console.log(pc.green(`Reopened: ${finding.title}`));
  });

program
  .command("list")
  .description("List findings known to shiprun for this repo")
  .option("-a, --all", "include resolved and dismissed findings", false)
  .action((opts: { all: boolean }) => {
    const root = process.cwd();
    const all = listAllFindings(root);
    const toShow = opts.all ? all : all.filter((f) => f.status === "open");

    if (toShow.length === 0) {
      console.log(pc.dim(opts.all ? "No findings recorded yet. Run \"shiprun scan\" first." : "No open findings."));
      return;
    }

    const statusColor: Record<FindingStatus, (s: string) => string> = {
      open: pc.red,
      resolved: pc.green,
      dismissed: pc.dim,
    };

    for (const f of toShow) {
      console.log(`${statusColor[f.status](f.status.padEnd(9))} ${pc.dim(f.id)}  ${f.title}`);
    }
  });

program.parseAsync(process.argv);
