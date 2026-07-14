import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { test } from "node:test";
import {
  validateKeychainRequest,
  validateKeychainResponse,
} from "../src/keychain/validation.mjs";

const wireFeaturePoint = "FR_Standardization_Feature_Base_1";

test("accepts the finite DJI wire feature-point identifiers", () => {
  const request = validateKeychainRequest({
    version: 4,
    department: 7,
    keychainsArray: [[{
      featurePoint: wireFeaturePoint,
      aesCiphertext: randomBytes(256).toString("base64"),
    }]],
  });
  const response = validateKeychainResponse([[
    {
      featurePoint: wireFeaturePoint,
      aesKey: randomBytes(32).toString("base64"),
      aesIv: randomBytes(16).toString("base64"),
    },
  ]]);

  assert.equal(request.valid, true);
  assert.equal(response.valid, true);
});

test("rejects feature-point identifiers outside the exact allowlist", () => {
  const result = validateKeychainRequest({
    version: 4,
    department: 7,
    keychainsArray: [[{
      featurePoint: `${wireFeaturePoint}_unexpected`,
      aesCiphertext: randomBytes(256).toString("base64"),
    }]],
  });

  assert.equal(result.valid, false);
  assert.equal(result.code, "invalid_keychain_request");
});
