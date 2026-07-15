use dji_log_parser::frame::Frame;
use dji_log_parser::keychain::KeychainFeaturePoint;
use dji_log_parser::DJILog;
use serde::{Deserialize, Serialize};
use std::env;
use std::fs;
use std::io::{self, Read};
use std::panic::{catch_unwind, AssertUnwindSafe};
use std::time::Instant;

const MAX_INPUT_BYTES: u64 = 262_144;

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

fn main() {
    let started = Instant::now();
    let path = env::args()
        .nth(1)
        .unwrap_or_else(|| fail("invalid_arguments"));

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

    let read_started = Instant::now();
    let bytes = fs::read(path).unwrap_or_else(|_| fail("fixture_unavailable"));
    let read_ms = read_started.elapsed().as_secs_f64() * 1000.0;

    let parse_started = Instant::now();
    let parser = DJILog::from_bytes(bytes).unwrap_or_else(|_| fail("invalid_or_corrupt_prefix"));
    let parse_ms = parse_started.elapsed().as_secs_f64() * 1000.0;

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
    let (validation, capabilities) = summarize(&frames, &secret);

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
        },
    };
    serde_json::to_writer(io::stdout(), &output).unwrap_or_else(|_| fail("serialization_failed"));
    println!();
}
