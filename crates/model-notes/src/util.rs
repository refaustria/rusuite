//! Small helpers over the Loro API.
use loro::{
    CommitOptions, Container, LoroDoc, LoroList, LoroMap, LoroText, LoroValue, ValueOrContainer,
};

/// Commits pending operations with `now` (Unix ms) as the change timestamp (Loro stores seconds). The core has
/// no clock of its own; callers pass the UI's clock.
pub(crate) fn commit_at(doc: &LoroDoc, now: i64) {
    doc.commit_with(CommitOptions::new().timestamp(now.div_euclid(1000)));
}

pub(crate) fn as_map(v: Option<ValueOrContainer>) -> Option<LoroMap> {
    match v {
        Some(ValueOrContainer::Container(Container::Map(m))) => Some(m),
        _ => None,
    }
}

pub(crate) fn as_list(v: Option<ValueOrContainer>) -> Option<LoroList> {
    match v {
        Some(ValueOrContainer::Container(Container::List(l))) => Some(l),
        _ => None,
    }
}

#[allow(dead_code)]
pub(crate) fn as_text(v: Option<ValueOrContainer>) -> Option<LoroText> {
    match v {
        Some(ValueOrContainer::Container(Container::Text(t))) => Some(t),
        _ => None,
    }
}

pub(crate) fn value(v: Option<ValueOrContainer>) -> Option<LoroValue> {
    match v {
        Some(ValueOrContainer::Value(v)) => Some(v),
        _ => None,
    }
}

pub(crate) fn get_str(map: &LoroMap, key: &str) -> Option<String> {
    match value(map.get(key)) {
        Some(LoroValue::String(s)) => Some(s.to_string()),
        _ => None,
    }
}

pub(crate) fn get_i64(map: &LoroMap, key: &str) -> Option<i64> {
    match value(map.get(key)) {
        Some(LoroValue::I64(i)) => Some(i),
        Some(LoroValue::Double(d)) => Some(d as i64),
        _ => None,
    }
}

pub(crate) fn get_f64(map: &LoroMap, key: &str) -> Option<f64> {
    match value(map.get(key)) {
        Some(LoroValue::I64(i)) => Some(i as f64),
        Some(LoroValue::Double(d)) => Some(d),
        _ => None,
    }
}

pub(crate) fn get_bool(map: &LoroMap, key: &str) -> Option<bool> {
    match value(map.get(key)) {
        Some(LoroValue::Bool(b)) => Some(b),
        _ => None,
    }
}

/// JSON → Loro value (numbers that fit become `I64`, others `Double`).
pub(crate) fn json_to_loro(v: &serde_json::Value) -> LoroValue {
    match v {
        serde_json::Value::Null => LoroValue::Null,
        serde_json::Value::Bool(b) => LoroValue::Bool(*b),
        serde_json::Value::Number(n) => match n.as_i64() {
            Some(i) => LoroValue::I64(i),
            None => LoroValue::Double(n.as_f64().unwrap_or(0.0)),
        },
        serde_json::Value::String(s) => LoroValue::from(s.as_str()),
        serde_json::Value::Array(a) => {
            LoroValue::from(a.iter().map(json_to_loro).collect::<Vec<_>>())
        }
        serde_json::Value::Object(o) => {
            let m: std::collections::HashMap<String, LoroValue> = o
                .iter()
                .map(|(k, v)| (k.clone(), json_to_loro(v)))
                .collect();
            LoroValue::from(m)
        }
    }
}

pub(crate) fn loro_to_json(v: &LoroValue) -> serde_json::Value {
    use loro::ToJson;
    v.to_json_value()
}
