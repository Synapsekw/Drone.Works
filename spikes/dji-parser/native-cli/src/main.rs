use dji_log_parser::frame::Frame;
use dji_log_parser::keychain::KeychainFeaturePoint;
use dji_log_parser::DJILog;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::BTreeSet;
use std::env;
use std::fs;
use std::io::{self, Read};
use std::panic::{catch_unwind, AssertUnwindSafe};
use std::time::Instant;

const MAX_INPUT_BYTES: u64 = 262_144;
const PREFIX_SIZE: usize = 100;
const VERSION_OFFSET: usize = 10;
const MAX_TERMINAL_TIME_GAP_SECONDS: f64 = 1.0;
const PARSER_ID: &str = "dji-log-parser";
const PARSER_VERSION: &str = "0.5.7";
const PARSER_SOURCE_COMMIT: &str = "e2e0775670a8391b4f7ecc40fca4cb01ea4a90fa";

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum EnvelopeStatus {
    Complete,
    IncompleteTerminalRecord,
    Invalid,
    Unavailable,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum OutputMode {
    Summary,
    Intermediate,
    KeychainRequest,
}

#[derive(Deserialize)]
struct SensitiveInput {
    keychains: Vec<Vec<KeychainFeaturePoint>>,
}

#[derive(Serialize)]
struct Validation {
    keychain_received: bool,
    secret_in_arguments: bool,
    secret_in_environment: bool,
    frame_count_positive: bool,
    time_monotonic: bool,
    coordinates_in_bounds: bool,
    battery_in_bounds: bool,
}

#[derive(Serialize)]
struct Capabilities {
    location: bool,
    battery: bool,
    signal: bool,
    attitude: bool,
}

#[derive(Serialize)]
struct Metrics {
    frames_count: usize,
    read_ms: f64,
    parse_ms: f64,
    decode_ms: f64,
    worker_total_ms: f64,
    max_rss_bytes: u64,
    completion_ratio: Option<f64>,
}

#[derive(Serialize)]
struct Success {
    schema_version: u8,
    kind: &'static str,
    status: &'static str,
    failure_code: Option<&'static str>,
    validation: Validation,
    capabilities: Capabilities,
    metrics: Metrics,
}

#[derive(Serialize)]
struct Failure {
    schema_version: u8,
    kind: &'static str,
    status: &'static str,
    failure_code: &'static str,
}

#[derive(Serialize)]
struct IntermediateParser {
    id: &'static str,
    version: &'static str,
    source_commit: &'static str,
}

#[derive(Serialize)]
struct IntermediateSource {
    sha256: String,
    bytes: usize,
    format_family: &'static str,
    format_version: u8,
}

#[derive(Serialize)]
struct SourceIdentifiers {
    aircraft_serials: Vec<String>,
    battery_serials: Vec<String>,
    camera_serials: Vec<String>,
    controller_serials: Vec<String>,
}

#[derive(Serialize)]
struct ImportedDetails {
    takeoff_time_utc: String,
    declared_duration_ms: Option<u64>,
    declared_distance_m: Option<f32>,
    declared_max_height_m: Option<f32>,
    declared_max_horizontal_speed_mps: Option<f32>,
    declared_max_vertical_speed_mps: Option<f32>,
    aircraft_name: Option<String>,
    aircraft_model: serde_json::Value,
    application_platform: serde_json::Value,
    application_version: Option<String>,
    identifiers: SourceIdentifiers,
}

#[derive(Serialize)]
struct PositionSample {
    latitude_deg: f64,
    longitude_deg: f64,
}

#[derive(Serialize)]
struct VelocitySample {
    x_mps: Option<f32>,
    y_mps: Option<f32>,
    z_mps: Option<f32>,
}

#[derive(Serialize)]
struct AttitudeSample {
    pitch_deg: Option<f32>,
    roll_deg: Option<f32>,
    yaw_deg: Option<f32>,
}

#[derive(Serialize)]
struct BatterySample {
    charge_percent: u8,
    voltage_v: Option<f32>,
    current_a: Option<f32>,
    temperature_c: Option<f32>,
}

#[derive(Serialize)]
struct GpsSample {
    satellites: u8,
    signal_level: u8,
    position_used: bool,
}

#[derive(Serialize)]
struct SignalSample {
    uplink_percent: Option<u8>,
    downlink_percent: Option<u8>,
}

#[derive(Serialize)]
struct TelemetrySample {
    elapsed_ms: Option<u64>,
    position: Option<PositionSample>,
    altitude_msl_m: Option<f32>,
    height_agl_m: Option<f32>,
    velocity: VelocitySample,
    attitude: AttitudeSample,
    battery: Option<BatterySample>,
    gps: GpsSample,
    signal: Option<SignalSample>,
}

#[derive(Serialize)]
struct IntermediateFlight {
    flight_index: u8,
    imported: ImportedDetails,
    capabilities: Vec<&'static str>,
    sample_count: usize,
    samples: Vec<TelemetrySample>,
}

#[derive(Serialize)]
struct IntermediateResult {
    schema_version: u8,
    kind: &'static str,
    parser: IntermediateParser,
    source: IntermediateSource,
    flights: Vec<IntermediateFlight>,
}

fn fail(code: &'static str) -> ! {
    let output = Failure {
        schema_version: 1,
        kind: "decode_summary",
        status: "decode_failed",
        failure_code: code,
    };
    let _ = serde_json::to_writer(io::stdout(), &output);
    println!();
    std::process::exit(2);
}

fn inspect_record_envelopes(bytes: &[u8]) -> EnvelopeStatus {
    if bytes.len() < PREFIX_SIZE {
        return EnvelopeStatus::Invalid;
    }
    if bytes[VERSION_OFFSET] < 13 {
        return EnvelopeStatus::Unavailable;
    }

    let detail_offset = u64::from_le_bytes(bytes[0..8].try_into().unwrap());
    let Ok(mut offset) = usize::try_from(detail_offset) else {
        return EnvelopeStatus::Invalid;
    };
    if offset < PREFIX_SIZE || offset > bytes.len() {
        return EnvelopeStatus::Invalid;
    }

    while offset < bytes.len() {
        let remaining = bytes.len() - offset;
        if remaining < 3 {
            return EnvelopeStatus::IncompleteTerminalRecord;
        }
        let size = u16::from_le_bytes([bytes[offset + 1], bytes[offset + 2]]) as usize;
        if size <= 2 {
            return EnvelopeStatus::Invalid;
        }
        let Some(record_bytes) = 3usize
            .checked_add(size)
            .and_then(|value| value.checked_add(1))
        else {
            return EnvelopeStatus::Invalid;
        };
        if record_bytes > remaining {
            return EnvelopeStatus::IncompleteTerminalRecord;
        }
        if bytes[offset + record_bytes - 1] != 0xff {
            return EnvelopeStatus::Invalid;
        }
        offset += record_bytes;
    }

    EnvelopeStatus::Complete
}

fn completion_ratio(frames: &[Frame], declared_time: f64) -> Option<f64> {
    if !declared_time.is_finite() || declared_time <= 0.0 {
        return None;
    }
    let observed_time = frames
        .iter()
        .map(|frame| frame.osd.fly_time as f64)
        .filter(|value| value.is_finite())
        .fold(0.0_f64, f64::max);
    Some((observed_time / declared_time).clamp(0.0, 1.0))
}

fn has_material_terminal_gap(completion_ratio: Option<f64>, declared_time: f64) -> bool {
    completion_ratio
        .map(|ratio| declared_time * (1.0 - ratio) > MAX_TERMINAL_TIME_GAP_SECONDS)
        .unwrap_or(false)
}

fn should_classify_truncated(
    envelope_status: EnvelopeStatus,
    completion_ratio: Option<f64>,
    declared_time: f64,
    decoded_prefix_valid: bool,
) -> bool {
    envelope_status == EnvelopeStatus::IncompleteTerminalRecord
        && decoded_prefix_valid
        && has_material_terminal_gap(completion_ratio, declared_time)
}

fn max_rss_bytes() -> u64 {
    let mut usage = std::mem::MaybeUninit::<libc::rusage>::zeroed();
    if unsafe { libc::getrusage(libc::RUSAGE_SELF, usage.as_mut_ptr()) } != 0 {
        return 0;
    }
    let value = unsafe { usage.assume_init() }.ru_maxrss as u64;
    if cfg!(target_os = "macos") {
        value
    } else {
        value.saturating_mul(1024)
    }
}

fn summarize(frames: &[Frame], secret: &str) -> (Validation, Capabilities) {
    let arguments = env::args().collect::<Vec<_>>().join(" ");
    let secret_in_arguments = !secret.is_empty() && arguments.contains(secret);
    let secret_in_environment =
        !secret.is_empty() && env::vars().any(|(_, value)| value.contains(secret));
    let mut previous_time = f32::NEG_INFINITY;
    let mut time_monotonic = true;
    let mut coordinates_in_bounds = true;
    let mut battery_in_bounds = true;
    let mut location = false;
    let mut battery = false;
    let mut signal = false;
    let mut attitude = false;

    for frame in frames {
        let fly_time = frame.osd.fly_time;
        if fly_time.is_finite() {
            if fly_time < previous_time {
                time_monotonic = false;
            }
            previous_time = fly_time;
        }

        let latitude = frame.osd.latitude;
        let longitude = frame.osd.longitude;
        if latitude.is_finite() && longitude.is_finite() {
            location |= latitude != 0.0 || longitude != 0.0;
            coordinates_in_bounds &=
                (-90.0..=90.0).contains(&latitude) && (-180.0..=180.0).contains(&longitude);
        } else {
            coordinates_in_bounds = false;
        }

        battery = true;
        battery_in_bounds &= frame.battery.charge_level <= 100;
        signal |= frame.rc.uplink_signal.is_some() || frame.rc.downlink_signal.is_some();
        attitude |=
            frame.osd.pitch.is_finite() || frame.osd.roll.is_finite() || frame.osd.yaw.is_finite();
    }

    (
        Validation {
            keychain_received: !secret.is_empty(),
            secret_in_arguments,
            secret_in_environment,
            frame_count_positive: !frames.is_empty(),
            time_monotonic,
            coordinates_in_bounds,
            battery_in_bounds,
        },
        Capabilities {
            location,
            battery,
            signal,
            attitude,
        },
    )
}

fn output_mode(arguments: &[String]) -> Option<(String, OutputMode)> {
    match arguments {
        [path] => Some((path.clone(), OutputMode::Summary)),
        [path, flag, value] if flag == "--output" && value == "summary" => {
            Some((path.clone(), OutputMode::Summary))
        }
        [path, flag, value] if flag == "--output" && value == "intermediate" => {
            Some((path.clone(), OutputMode::Intermediate))
        }
        [path, flag, value] if flag == "--output" && value == "keychain-request" => {
            Some((path.clone(), OutputMode::KeychainRequest))
        }
        _ => None,
    }
}

fn finite_f32(value: f32) -> Option<f32> {
    value.is_finite().then_some(value)
}

fn non_empty(value: &str) -> Option<String> {
    let trimmed = value.trim_matches(char::from(0)).trim();
    (!trimmed.is_empty()).then(|| trimmed.to_string())
}

fn insert_non_empty(values: &mut BTreeSet<String>, value: &str) {
    if let Some(value) = non_empty(value) {
        values.insert(value);
    }
}

fn intermediate_sample(frame: &Frame, battery_seen: &mut bool) -> TelemetrySample {
    let latitude = frame.osd.latitude;
    let longitude = frame.osd.longitude;
    let position = (latitude.is_finite()
        && longitude.is_finite()
        && (-90.0..=90.0).contains(&latitude)
        && (-180.0..=180.0).contains(&longitude)
        && (latitude != 0.0 || longitude != 0.0))
        .then_some(PositionSample {
            latitude_deg: latitude,
            longitude_deg: longitude,
        });

    let has_battery_evidence = frame.battery.charge_level > 0
        || frame.battery.voltage != 0.0
        || frame.battery.current != 0.0
        || frame.battery.current_capacity > 0
        || frame.battery.full_capacity > 0
        || frame.battery.temperature != 0.0
        || frame
            .battery
            .cell_voltages
            .iter()
            .any(|value| *value != 0.0);
    *battery_seen |= has_battery_evidence;

    let signal = (frame.rc.uplink_signal.is_some() || frame.rc.downlink_signal.is_some())
        .then_some(SignalSample {
            uplink_percent: frame.rc.uplink_signal,
            downlink_percent: frame.rc.downlink_signal,
        });

    TelemetrySample {
        elapsed_ms: frame
            .osd
            .fly_time
            .is_finite()
            .then(|| (f64::from(frame.osd.fly_time.max(0.0)) * 1000.0).round() as u64),
        position,
        altitude_msl_m: finite_f32(frame.osd.altitude),
        height_agl_m: finite_f32(frame.osd.height),
        velocity: VelocitySample {
            x_mps: finite_f32(frame.osd.x_speed),
            y_mps: finite_f32(frame.osd.y_speed),
            z_mps: finite_f32(frame.osd.z_speed),
        },
        attitude: AttitudeSample {
            pitch_deg: finite_f32(frame.osd.pitch),
            roll_deg: finite_f32(frame.osd.roll),
            yaw_deg: finite_f32(frame.osd.yaw),
        },
        battery: (*battery_seen).then_some(BatterySample {
            charge_percent: frame.battery.charge_level,
            voltage_v: finite_f32(frame.battery.voltage),
            current_a: finite_f32(frame.battery.current),
            temperature_c: finite_f32(frame.battery.temperature),
        }),
        gps: GpsSample {
            satellites: frame.osd.gps_num,
            signal_level: frame.osd.gps_level,
            position_used: frame.osd.is_gpd_used,
        },
        signal,
    }
}

fn intermediate_result(
    source_sha256: String,
    source_bytes: usize,
    format_version: u8,
    parser: &DJILog,
    frames: &[Frame],
) -> IntermediateResult {
    let mut aircraft_serials = BTreeSet::new();
    let mut battery_serials = BTreeSet::new();
    let mut camera_serials = BTreeSet::new();
    let mut controller_serials = BTreeSet::new();
    insert_non_empty(&mut aircraft_serials, &parser.details.aircraft_sn);
    insert_non_empty(&mut battery_serials, &parser.details.battery_sn);
    insert_non_empty(&mut camera_serials, &parser.details.camera_sn);
    insert_non_empty(&mut controller_serials, &parser.details.rc_sn);
    for frame in frames {
        insert_non_empty(&mut aircraft_serials, &frame.recover.aircraft_sn);
        insert_non_empty(&mut battery_serials, &frame.recover.battery_sn);
        insert_non_empty(&mut camera_serials, &frame.recover.camera_sn);
        insert_non_empty(&mut controller_serials, &frame.recover.rc_sn);
    }

    let mut battery_seen = false;
    let samples = frames
        .iter()
        .map(|frame| intermediate_sample(frame, &mut battery_seen))
        .collect::<Vec<_>>();
    let mut capabilities = BTreeSet::new();
    for sample in &samples {
        if sample.position.is_some() {
            capabilities.insert("position");
        }
        if sample.altitude_msl_m.is_some() || sample.height_agl_m.is_some() {
            capabilities.insert("altitude");
        }
        if sample.velocity.x_mps.is_some()
            || sample.velocity.y_mps.is_some()
            || sample.velocity.z_mps.is_some()
        {
            capabilities.insert("velocity");
        }
        if sample.attitude.pitch_deg.is_some()
            || sample.attitude.roll_deg.is_some()
            || sample.attitude.yaw_deg.is_some()
        {
            capabilities.insert("attitude");
        }
        if sample.battery.is_some() {
            capabilities.insert("battery");
        }
        if sample.signal.is_some() {
            capabilities.insert("signal");
        }
        capabilities.insert("gps");
    }

    let declared_duration_ms = parser
        .details
        .total_time
        .is_finite()
        .then(|| (parser.details.total_time.max(0.0) * 1000.0).round() as u64);
    IntermediateResult {
        schema_version: 1,
        kind: "dji_parser_intermediate",
        parser: IntermediateParser {
            id: PARSER_ID,
            version: PARSER_VERSION,
            source_commit: PARSER_SOURCE_COMMIT,
        },
        source: IntermediateSource {
            sha256: source_sha256,
            bytes: source_bytes,
            format_family: "dji_txt",
            format_version,
        },
        flights: vec![IntermediateFlight {
            flight_index: 0,
            imported: ImportedDetails {
                takeoff_time_utc: parser.details.start_time.to_rfc3339(),
                declared_duration_ms,
                declared_distance_m: finite_f32(parser.details.total_distance),
                declared_max_height_m: finite_f32(parser.details.max_height),
                declared_max_horizontal_speed_mps: finite_f32(parser.details.max_horizontal_speed),
                declared_max_vertical_speed_mps: finite_f32(parser.details.max_vertical_speed),
                aircraft_name: non_empty(&parser.details.aircraft_name),
                aircraft_model: serde_json::to_value(&parser.details.product_type)
                    .unwrap_or(serde_json::Value::Null),
                application_platform: serde_json::to_value(&parser.details.app_platform)
                    .unwrap_or(serde_json::Value::Null),
                application_version: non_empty(&parser.details.app_version),
                identifiers: SourceIdentifiers {
                    aircraft_serials: aircraft_serials.into_iter().collect(),
                    battery_serials: battery_serials.into_iter().collect(),
                    camera_serials: camera_serials.into_iter().collect(),
                    controller_serials: controller_serials.into_iter().collect(),
                },
            },
            capabilities: capabilities.into_iter().collect(),
            sample_count: samples.len(),
            samples,
        }],
    }
}

fn main() {
    let started = Instant::now();
    let arguments = env::args().skip(1).collect::<Vec<_>>();
    let (path, output_mode) = output_mode(&arguments).unwrap_or_else(|| fail("invalid_arguments"));

    let read_started = Instant::now();
    let bytes = fs::read(path).unwrap_or_else(|_| fail("fixture_unavailable"));
    let read_ms = read_started.elapsed().as_secs_f64() * 1000.0;
    let source_bytes = bytes.len();
    let format_version = bytes.get(VERSION_OFFSET).copied().unwrap_or_default();
    let source_sha256 = format!("{:x}", Sha256::digest(&bytes));
    let envelope_status = inspect_record_envelopes(&bytes);
    if envelope_status == EnvelopeStatus::Invalid {
        fail("decode_failed");
    }

    let parse_started = Instant::now();
    let parser = DJILog::from_bytes(bytes).unwrap_or_else(|_| fail("invalid_or_corrupt_prefix"));
    let parse_ms = parse_started.elapsed().as_secs_f64() * 1000.0;

    if output_mode == OutputMode::KeychainRequest {
        let request = parser
            .keychains_request()
            .unwrap_or_else(|_| fail("invalid_keychain_request"));
        let output = serde_json::json!({
            "schema_version": 1,
            "kind": "keychain_request",
            "request": request,
        });
        serde_json::to_writer(io::stdout(), &output)
            .unwrap_or_else(|_| fail("serialization_failed"));
        println!();
        return;
    }

    let mut input_bytes = Vec::new();
    if io::stdin()
        .take(MAX_INPUT_BYTES + 1)
        .read_to_end(&mut input_bytes)
        .is_err()
        || input_bytes.len() as u64 > MAX_INPUT_BYTES
    {
        fail("parser_input_limit");
    }
    let sensitive: SensitiveInput =
        serde_json::from_slice(&input_bytes).unwrap_or_else(|_| fail("invalid_keychain_response"));
    input_bytes.fill(0);
    let secret = sensitive
        .keychains
        .first()
        .and_then(|group| group.first())
        .map(|point| point.aes_key.clone())
        .unwrap_or_default();

    // The pinned upstream decoder contains unchecked reads. Convert any panic into a
    // structured child failure; the supervisor still treats the process as untrusted.
    std::panic::set_hook(Box::new(|_| {}));
    let decode_started = Instant::now();
    let frames = match catch_unwind(AssertUnwindSafe(|| {
        parser.frames(Some(sensitive.keychains))
    })) {
        Ok(Ok(frames)) => frames,
        Ok(Err(_)) => fail("decode_failed"),
        Err(_) => fail("parser_internal_error"),
    };
    let decode_ms = decode_started.elapsed().as_secs_f64() * 1000.0;
    let declared_time = parser.details.total_time;
    let completion_ratio = completion_ratio(&frames, declared_time);
    let (validation, capabilities) = summarize(&frames, &secret);
    let decoded_prefix_valid = validation.frame_count_positive
        && validation.time_monotonic
        && validation.coordinates_in_bounds
        && validation.battery_in_bounds;
    if should_classify_truncated(
        envelope_status,
        completion_ratio,
        declared_time,
        decoded_prefix_valid,
    ) {
        fail("truncated_records");
    }

    if output_mode == OutputMode::Intermediate {
        let output = intermediate_result(
            source_sha256,
            source_bytes,
            format_version,
            &parser,
            &frames,
        );
        serde_json::to_writer(io::stdout(), &output)
            .unwrap_or_else(|_| fail("serialization_failed"));
        println!();
        return;
    }

    let output = Success {
        schema_version: 1,
        kind: "decode_summary",
        status: "decoded",
        failure_code: None,
        validation,
        capabilities,
        metrics: Metrics {
            frames_count: frames.len(),
            read_ms,
            parse_ms,
            decode_ms,
            worker_total_ms: started.elapsed().as_secs_f64() * 1000.0,
            max_rss_bytes: max_rss_bytes(),
            completion_ratio,
        },
    };
    serde_json::to_writer(io::stdout(), &output).unwrap_or_else(|_| fail("serialization_failed"));
    println!();
}

#[cfg(test)]
mod tests {
    use super::*;

    fn v14_bytes(record: &[u8]) -> Vec<u8> {
        let mut bytes = vec![0; PREFIX_SIZE];
        bytes[0..8].copy_from_slice(&(PREFIX_SIZE as u64).to_le_bytes());
        bytes[VERSION_OFFSET] = 14;
        bytes.extend_from_slice(record);
        bytes
    }

    #[test]
    fn accepts_complete_v14_record_envelopes() {
        let bytes = v14_bytes(&[1, 3, 0, 4, 5, 6, 0xff]);
        assert_eq!(inspect_record_envelopes(&bytes), EnvelopeStatus::Complete);
    }

    #[test]
    fn identifies_an_incomplete_terminal_record() {
        let bytes = v14_bytes(&[1, 8, 0, 4, 5]);
        assert_eq!(
            inspect_record_envelopes(&bytes),
            EnvelopeStatus::IncompleteTerminalRecord
        );
    }

    #[test]
    fn rejects_an_invalid_record_terminator() {
        let bytes = v14_bytes(&[1, 3, 0, 4, 5, 6, 0]);
        assert_eq!(inspect_record_envelopes(&bytes), EnvelopeStatus::Invalid);
    }

    #[test]
    fn requires_all_three_truncation_signals() {
        assert!(!should_classify_truncated(
            EnvelopeStatus::Complete,
            Some(0.45),
            100.0,
            true
        ));
        assert!(!should_classify_truncated(
            EnvelopeStatus::IncompleteTerminalRecord,
            Some(1.0),
            100.0,
            true
        ));
        assert!(!should_classify_truncated(
            EnvelopeStatus::IncompleteTerminalRecord,
            Some(0.45),
            100.0,
            false
        ));
        assert!(should_classify_truncated(
            EnvelopeStatus::IncompleteTerminalRecord,
            Some(0.45),
            100.0,
            true
        ));
    }

    #[test]
    fn parses_explicit_intermediate_output_mode() {
        assert_eq!(
            output_mode(&[
                "fixture.bin".to_string(),
                "--output".to_string(),
                "keychain-request".to_string(),
            ]),
            Some(("fixture.bin".to_string(), OutputMode::KeychainRequest))
        );
        assert_eq!(
            output_mode(&[
                "fixture.bin".to_string(),
                "--output".to_string(),
                "intermediate".to_string(),
            ]),
            Some(("fixture.bin".to_string(), OutputMode::Intermediate))
        );
        assert_eq!(
            output_mode(&["fixture.bin".to_string()]),
            Some(("fixture.bin".to_string(), OutputMode::Summary))
        );
    }

    #[test]
    fn intermediate_sample_keeps_unavailable_position_null() {
        let mut frame = Frame::default();
        frame.osd.latitude = 0.0;
        frame.osd.longitude = 0.0;
        frame.osd.fly_time = 1.25;
        let mut battery_seen = false;
        let sample = intermediate_sample(&frame, &mut battery_seen);
        let first = serde_json::to_vec(&sample).unwrap();
        let second = serde_json::to_vec(&sample).unwrap();

        assert!(sample.position.is_none());
        assert!(sample.battery.is_none());
        assert_eq!(sample.elapsed_ms, Some(1250));
        assert_eq!(first, second);
    }
}
