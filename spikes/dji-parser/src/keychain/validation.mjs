const FEATURE_POINTS = new Set([
  "BaseFeature",
  "VisionFeature",
  "WaypointFeature",
  "AgricultureFeature",
  "AirLinkFeature",
  "AfterSalesFeature",
  "DJIFlyCustomFeature",
  "PlaintextFeature",
  "FlightHubFeature",
  "GimbalFeature",
  "RCFeature",
  "CameraFeature",
  "BatteryFeature",
  "FlySafeFeature",
  "SecurityFeature",
]);

const MAX_GROUPS = 256;
const MAX_FEATURES_PER_GROUP = 128;
const MAX_REQUEST_BYTES = 256 * 1024;

function isBoundedInteger(value, minimum, maximum) {
  return Number.isSafeInteger(value) && value >= minimum && value <= maximum;
}

function validBase64(value, minimumBytes, maximumBytes) {
  if (typeof value !== "string" || value.length === 0 || value.length > maximumBytes * 2) {
    return false;
  }

  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(value)) {
    return false;
  }

  const decoded = Buffer.from(value, "base64");
  return decoded.length >= minimumBytes
    && decoded.length <= maximumBytes
    && decoded.toString("base64").replaceAll("=", "") === value.replaceAll("=", "");
}

export function validateKeychainRequest(request) {
  if (!request || typeof request !== "object" || Array.isArray(request)) {
    return { valid: false, code: "invalid_keychain_request" };
  }

  if (!isBoundedInteger(request.version, 0, 255)
    || !isBoundedInteger(request.department, 0, 255)
    || !Array.isArray(request.keychainsArray)
    || request.keychainsArray.length === 0
    || request.keychainsArray.length > MAX_GROUPS) {
    return { valid: false, code: "invalid_keychain_request" };
  }

  for (const group of request.keychainsArray) {
    if (!Array.isArray(group) || group.length === 0 || group.length > MAX_FEATURES_PER_GROUP) {
      return { valid: false, code: "invalid_keychain_request" };
    }

    for (const point of group) {
      if (!point
        || typeof point !== "object"
        || !FEATURE_POINTS.has(point.featurePoint)
        || !validBase64(point.aesCiphertext, 1, 4_096)) {
        return { valid: false, code: "invalid_keychain_request" };
      }
    }
  }

  let serializedBytes;
  try {
    serializedBytes = Buffer.byteLength(JSON.stringify(request));
  } catch {
    return { valid: false, code: "invalid_keychain_request" };
  }

  if (serializedBytes > MAX_REQUEST_BYTES) {
    return { valid: false, code: "invalid_keychain_request" };
  }

  return {
    valid: true,
    metadata: {
      request_version: request.version,
      department: request.department,
      groups: request.keychainsArray.length,
      feature_points: request.keychainsArray.reduce((sum, group) => sum + group.length, 0),
      serialized_bytes: serializedBytes,
    },
  };
}

export function validateKeychainResponse(keychains) {
  if (!Array.isArray(keychains)
    || keychains.length === 0
    || keychains.length > MAX_GROUPS) {
    return { valid: false, code: "invalid_keychain_response" };
  }

  for (const group of keychains) {
    if (!Array.isArray(group) || group.length === 0 || group.length > MAX_FEATURES_PER_GROUP) {
      return { valid: false, code: "invalid_keychain_response" };
    }

    for (const point of group) {
      if (!point
        || typeof point !== "object"
        || !FEATURE_POINTS.has(point.featurePoint)
        || !validBase64(point.aesKey, 16, 64)
        || !validBase64(point.aesIv, 12, 32)) {
        return { valid: false, code: "invalid_keychain_response" };
      }
    }
  }

  let serializedBytes;
  try {
    serializedBytes = Buffer.byteLength(JSON.stringify(keychains));
  } catch {
    return { valid: false, code: "invalid_keychain_response" };
  }

  return {
    valid: true,
    metadata: {
      groups: keychains.length,
      feature_points: keychains.reduce((sum, group) => sum + group.length, 0),
      serialized_bytes: serializedBytes,
    },
  };
}
