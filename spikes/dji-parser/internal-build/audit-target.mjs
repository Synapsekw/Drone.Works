import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

function packageKey(value) {
  const name = value?.name;
  const version = value?.version;
  return name && version ? `${name}@${version}` : null;
}

function warningEntries(warnings = {}) {
  return Object.entries(warnings).flatMap(([category, entries]) => (
    Array.isArray(entries) ? entries.map((entry) => ({ ...entry, category })) : []
  ));
}

function findingSummary(finding) {
  return {
    package: packageKey(finding.package),
    advisory: finding.advisory?.id ?? null,
    category: finding.category ?? "vulnerability",
  };
}

export function summarizeTargetAudit(audit, sbom, options = {}) {
  const targetPackages = new Set((sbom.components ?? []).map(packageKey).filter(Boolean));
  const vulnerabilities = audit.vulnerabilities?.list ?? [];
  const warnings = warningEntries(audit.warnings);
  const targetVulnerabilities = vulnerabilities.filter((finding) => targetPackages.has(packageKey(finding.package)));
  const targetWarnings = warnings.filter((finding) => targetPackages.has(packageKey(finding.package)));

  return {
    schema_version: 1,
    policy: {
      deny_vulnerabilities: true,
      deny_warnings: options.denyWarnings === true,
    },
    target_components: targetPackages.size,
    full_lockfile: {
      vulnerabilities: vulnerabilities.length,
      warnings: warnings.length,
    },
    target: {
      vulnerabilities: targetVulnerabilities.map(findingSummary),
      warnings: targetWarnings.map(findingSummary),
    },
    excluded_non_target: {
      vulnerabilities: vulnerabilities.length - targetVulnerabilities.length,
      warnings: warnings.length - targetWarnings.length,
    },
    passed: targetVulnerabilities.length === 0 && (
      options.denyWarnings !== true || targetWarnings.length === 0
    ),
  };
}

function run(lockPath, sbomPath) {
  for (const path of [lockPath, sbomPath]) {
    if (!existsSync(path)) throw new Error(`Required audit input is missing: ${path}`);
  }

  const audit = spawnSync("cargo", ["audit", "--json", "--file", lockPath], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (audit.error) throw audit.error;
  if (![0, 1].includes(audit.status)) {
    throw new Error(`cargo audit failed with status ${audit.status}: ${audit.stderr.trim()}`);
  }

  const summary = summarizeTargetAudit(
    JSON.parse(audit.stdout),
    JSON.parse(readFileSync(sbomPath, "utf8")),
    { denyWarnings: process.argv[4] === "deny-warnings" },
  );
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  if (!summary.passed) process.exitCode = 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (!process.argv[2] || !process.argv[3]) {
    throw new Error(
      "Usage: node audit-target.mjs <Cargo.lock> <target-sbom.json> [deny-warnings]",
    );
  }
  run(resolve(process.argv[2]), resolve(process.argv[3]));
}
