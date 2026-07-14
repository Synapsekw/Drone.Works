import assert from "node:assert/strict";
import { test } from "node:test";
import { summarizeTargetAudit } from "../internal-build/audit-target.mjs";

const audit = {
  vulnerabilities: {
    list: [
      { advisory: { id: "RUSTSEC-TARGET" }, package: { name: "target-crate", version: "1.0.0" } },
      { advisory: { id: "RUSTSEC-NATIVE" }, package: { name: "native-only", version: "2.0.0" } },
    ],
  },
  warnings: {
    unmaintained: [
      { advisory: { id: "RUSTSEC-WARNING" }, package: { name: "native-warning", version: "3.0.0" } },
    ],
  },
};

test("target audit fails for a vulnerability present in the generated SBOM", () => {
  const summary = summarizeTargetAudit(audit, {
    components: [{ name: "target-crate", version: "1.0.0" }],
  });

  assert.equal(summary.passed, false);
  assert.deepEqual(summary.target.vulnerabilities, [{
    package: "target-crate@1.0.0",
    advisory: "RUSTSEC-TARGET",
    category: "vulnerability",
  }]);
  assert.equal(summary.excluded_non_target.vulnerabilities, 1);
  assert.equal(summary.excluded_non_target.warnings, 1);
});

test("target audit passes when full-workspace findings are absent from the generated SBOM", () => {
  const summary = summarizeTargetAudit(audit, {
    components: [{ name: "safe-target", version: "1.0.0" }],
  });

  assert.equal(summary.passed, true);
  assert.deepEqual(summary.target.vulnerabilities, []);
  assert.deepEqual(summary.target.warnings, []);
  assert.equal(summary.excluded_non_target.vulnerabilities, 2);
});
