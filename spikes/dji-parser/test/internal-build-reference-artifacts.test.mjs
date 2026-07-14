import assert from "node:assert/strict";
import { test } from "node:test";
import { expectedReferenceArtifacts } from "../internal-build/reference-artifacts.mjs";

const configuration = {
  reference_artifacts: {
    "parser.js": "common-js",
    "parser.wasm": "default-wasm",
  },
  reference_artifact_overrides: {
    linux: { "parser.wasm": "linux-wasm" },
  },
};

test("internal build selects the Linux artifact reference without weakening common checks", () => {
  assert.deepEqual(expectedReferenceArtifacts(configuration, "linux"), {
    "parser.js": "common-js",
    "parser.wasm": "linux-wasm",
  });
});

test("internal build retains default references on platforms without an override", () => {
  assert.deepEqual(expectedReferenceArtifacts(configuration, "darwin"), {
    "parser.js": "common-js",
    "parser.wasm": "default-wasm",
  });
});
