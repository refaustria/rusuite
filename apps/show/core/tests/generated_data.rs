//! Writes the data files the Show UI imports next to the generated
//! TypeScript types (like ts-rs, during `cargo test -p show-core`):
//! `apps/show/src/generated/tableStyles.json` (PowerPoint's built-in
//! table styles, [`model_show::builtin_table_styles`]) and
//! `presetInfo.json` (every preset's adjust values with their defaults
//! and its default shape name) and `shapePathSamples.json` (the core's
//! outlines, text rectangles and handles of a few presets, the fixture of
//! the UI's handle and text-rectangle tests), and `animInfo.json` (P9-S4:
//! every animation effect's and transition kind's directions, options and
//! defaults, the motion path presets' default paths – the tables the
//! Animations and Transitions tabs build their galleries from).

use std::path::PathBuf;

use model_show::{builtin_table_styles, Adjust, Effect, Preset, TransitionKind};
use serde_json::{json, Map, Value};
use show_core::{PathKind, PathQuery};

fn out_dir() -> PathBuf {
    let root = std::env::var("TS_RS_EXPORT_DIR").unwrap_or_else(|_| "../../..".into());
    PathBuf::from(root).join("apps/show/src/generated")
}

fn write_if_changed(name: &str, value: &Value) {
    let dir = out_dir();
    std::fs::create_dir_all(&dir).unwrap();
    let path = dir.join(name);
    let text = serde_json::to_string(value).unwrap() + "\n";
    if std::fs::read_to_string(&path).ok().as_deref() != Some(text.as_str()) {
        std::fs::write(&path, text).unwrap();
    }
}

#[test]
fn table_styles_json() {
    let styles = serde_json::to_value(builtin_table_styles()).unwrap();
    assert_eq!(styles.as_array().unwrap().len(), 74);
    write_if_changed("tableStyles.json", &styles);
}

#[test]
fn preset_info_json() {
    let mut out = Map::new();
    for p in Preset::ALL {
        let defaults: Map<String, Value> = p
            .adjust_defaults()
            .iter()
            .map(|(n, v)| ((*n).to_owned(), json!(v)))
            .collect();
        out.insert(
            p.prst().to_owned(),
            json!({ "name": p.default_name(), "adjust": defaults }),
        );
    }
    assert_eq!(out.len(), Preset::ALL.len());
    write_if_changed("presetInfo.json", &Value::Object(out));
}

#[test]
fn shape_path_samples_json() {
    let mut out = Map::new();
    for (prst, w, h) in [
        ("roundRect", 1_000_000.0, 500_000.0),
        ("rightArrow", 2_000_000.0, 1_000_000.0),
        ("wedgeRectCallout", 1_000_000.0, 400_000.0),
        ("star5", 1_000_000.0, 1_000_000.0),
        ("pie", 1_000_000.0, 1_000_000.0),
        ("uturnArrow", 1_000_000.0, 1_000_000.0),
        ("ellipse", 1_000_000.0, 600_000.0),
    ] {
        let q = PathQuery {
            kind: PathKind::Preset(Preset::from_prst(prst).unwrap()),
            w,
            h,
            adjust: Adjust::new(),
        };
        let mut v = serde_json::to_value(q.compute()).unwrap();
        // the fixture needs the data, not the outline
        v.as_object_mut().unwrap().insert("paths".into(), json!([]));
        out.insert(prst.to_owned(), json!({ "w": w, "h": h, "paths": v }));
    }
    write_if_changed("shapePathSamples.json", &Value::Object(out));
}

#[test]
fn anim_info_json() {
    let name = |v: serde_json::Value| v.as_str().unwrap_or_default().to_owned();
    let mut effects = Map::new();
    for e in Effect::ALL {
        let dirs: Vec<Value> = e.directions().iter().map(|d| json!(d)).collect();
        let mut paths = Map::new();
        for d in std::iter::once(None).chain(e.directions().iter().map(|d| Some(*d))) {
            if let Some(p) = model_show::motion::default_path(e, d) {
                let key = d.map_or("default".to_owned(), |d| name(json!(d)));
                paths.insert(key, json!(p));
            }
        }
        effects.insert(
            name(json!(e)),
            json!({
                "class": e.class(),
                "directions": dirs,
                "defaultDirection": e.default_direction(),
                "defaultDurationMs": e.default_duration_ms(),
                "defaultAmount": e.default_amount(),
                "defaultColor": e.default_color(),
                "paths": paths,
            }),
        );
    }
    let mut transitions = Map::new();
    for k in TransitionKind::ALL {
        transitions.insert(
            name(json!(k)),
            json!({
                "directions": k.directions(),
                "defaultDirection": k.default_direction(),
                "galleryDirection": k.gallery_direction(),
                "options": k.options(),
                "defaultOption": k.default_option(),
                "defaultDurationMs": k.default_duration_ms(),
                "extension": k.is_extension(),
            }),
        );
    }
    let order: Vec<Value> = Effect::ALL.iter().map(|e| json!(e)).collect();
    let torder: Vec<Value> = TransitionKind::ALL.iter().map(|k| json!(k)).collect();
    write_if_changed(
        "animInfo.json",
        &json!({
            "effectOrder": order,
            "effects": effects,
            "transitionOrder": torder,
            "transitions": transitions,
        }),
    );
}
