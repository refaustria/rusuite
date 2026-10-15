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

/// Installs the browser clock as the engine's process-wide default, once,
/// before any workbook is opened (readers recalculate while loading).
#[cfg(target_arch = "wasm32")]
#[wasm_bindgen(start)]
fn init() {
    engine_formula::set_default_clock(browser_now);
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
    fn default_clock_reaches_new_engines() {
        engine_formula::set_default_clock(|| 45306.5);
        let mut engine = engine_formula::Engine::new();
        let c = engine_formula::CellCoord {
            sheet: engine_formula::SheetId(0),
            row: 0,
            col: 0,
        };
        engine.set_input(c, "=TODAY()").unwrap();
        assert_eq!(format!("{:?}", engine.value(c)), "Number(45306.0)");
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
    #[test]
    fn recovery_snapshot_roundtrip() {
        // The page keeps recovery entries in IndexedDB; the core only
        // produces and restores the snapshot JSON.
        let snap = call(r#"{"type":"recoverySnapshot"}"#);
        assert_eq!(snap["ok"]["type"], "recoverySnapshot");
        let request =
            serde_json::json!({"type": "restoreRecovery", "json": snap["ok"]["json"], "name": "r"});
        assert!(call(&request.to_string())["ok"].is_object());
        let st = call(r#"{"type":"documentState"}"#);
        assert_eq!(
            (&st["ok"]["dirty"], &st["ok"]["name"]),
            (&Value::Bool(true), &Value::from("r"))
        );
    }
}
