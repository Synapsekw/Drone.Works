use serde::{Deserialize, Serialize};
#[cfg(target_arch = "wasm32")]
use tsify_next::Tsify;

use super::{EncodedKeychainFeaturePoint, KeychainFeaturePoint};

/// Request data only. Provider transport belongs to Drone.Works' trusted broker.
#[derive(Debug, Default, Serialize, Clone)]
#[cfg_attr(target_arch = "wasm32", derive(Tsify))]
pub struct KeychainsRequest {
    pub version: u16,
    pub department: u8,
    #[serde(rename = "keychainsArray")]
    pub keychains: Vec<Vec<EncodedKeychainFeaturePoint>>,
}

/// Response data only. The untrusted parser has no provider transport.
#[derive(Debug, Deserialize)]
pub struct KeychainsResponse {
    pub data: Option<Vec<Vec<KeychainFeaturePoint>>>,
    pub result: KeychainResponseResult,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KeychainResponseResult {
    pub code: u8,
    pub msg: String,
}
