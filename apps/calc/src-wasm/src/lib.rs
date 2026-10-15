#![forbid(unsafe_code)]
//! Rusuite Calc WebAssembly shell (ADR 0005 §2): one [`CalcHost`] per page
//! behind [`dispatch`]. No document logic lives here.

use std::cell::RefCell;

use calc_core::{CalcDocument, CalcHost};
use wasm_bindgen::prelude::wasm_bindgen;

/// Milliseconds per day.
const MS_PER_DAY: f64 = 86_400_000.0;
/// Excel serial of 1970-01-01 (1900 date system).
const UNIX_EPOCH_SERIAL: f64 = 25_569.0;

/// Excel serial date-time of `utc_ms` (milliseconds since the Unix epoch)
/// in a time zone `offset_min` minutes *behind* UTC (the sign convention of
/// JavaScript's `Date.prototype.getTimezoneOffset`).
#[must_use]
pub fn excel_serial(utc_ms: f64, offset_min: f64) -> f64 {
    UNIX_EPOCH_SERIAL + (utc_ms - offset_min * 60_000.0) / MS_PER_DAY
}

/// The clock for `NOW()`/`TODAY()`: local time from `js_sys::Date`.
#[cfg(target_arch = "wasm32")]
fn browser_now() -> f64 {
    let d = js_sys::Date::new_0();
    excel_serial(d.get_time(), d.get_timezone_offset())
}

/// Host builds (unit tests) use the engine's default system clock.
#[cfg(not(target_arch = "wasm32"))]
fn install_clock(_host: &mut CalcHost) {}

/// Installs the browser clock. Called before every request because
/// `openXlsx`/`newDocument`/`loadSnapshotJson` replace the workbook (and
/// with it the engine's clock).
#[cfg(target_arch = "wasm32")]
fn install_clock(host: &mut CalcHost) {
    host.doc_mut()
        .workbook_mut()
        .engine_mut()
        .set_now(browser_now);
}

thread_local! {
    static HOST: RefCell<CalcHost> = RefCell::new(CalcHost::new(CalcDocument::new()));
}

/// Health check; same text as the Tauri `ping` command.
#[wasm_bindgen]
#[must_use]
pub fn ping() -> String {
    format!("Rusuite Calc {}", env!("CARGO_PKG_VERSION"))
}

/// Runs one `calc_core::dispatch` request (JSON in, JSON out) against the
/// page's document.
#[wasm_bindgen]
#[must_use]
pub fn dispatch(request: &str) -> String {
    HOST.with(|host| {
        let mut host = host.borrow_mut();
        install_clock(&mut host);
        calc_core::dispatch(&mut host, request)
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::Value;

    fn call(request: &str) -> Value {
        serde_json::from_str(&dispatch(request)).unwrap()
    }

    #[test]
    fn ping_text() {
        assert!(ping().starts_with("Rusuite Calc "));
    }

    #[test]
    fn dispatch_info_and_errors() {
        let v = call(r#"{"type":"info"}"#);
        assert_eq!(v["ok"]["type"], "info");
        assert_eq!(v["ok"]["info"]["sheets"][0]["name"], "Sheet1");
        for req in [r#"{"type":"nope"}"#, "not json"] {
            assert_eq!(call(req)["err"]["code"], "bad_request");
        }
    }

    #[test]
    fn dispatch_keeps_state_between_calls() {
        let v = call(
            r#"{"type":"apply","command":{"type":"setInput","sheet":0,"row":0,"col":0,"input":"=2+3"}}"#,
        );
        assert_eq!(
            v["ok"]["envelope"]["patch"]["cells"][0]["cells"][0]["display"],
            "5"
        );
        assert_eq!(call(r#"{"type":"documentState"}"#)["ok"]["dirty"], true);
    }

    #[test]
    fn serial_dates() {
        // 1970-01-01T00:00Z is serial 25569 in UTC.
        assert_eq!(excel_serial(0.0, 0.0), 25_569.0);
        // 2026-10-15T12:00Z in CEST (UTC+2, offset -120) is 14:00 local.
        let utc_ms = 1_792_065_600_000.0;
        let serial = excel_serial(utc_ms, -120.0);
        assert_eq!(serial.floor(), 46_310.0);
        assert!((serial.fract() - 14.0 / 24.0).abs() < 1e-9);
    }
}
