//! Search across notebooks: diacritics/case, prefix, AND, phrase, ranking; perf bench (release, ignored).
mod common;

use common::{create_page, host_with_section, ok, Mirror, T0};
use notes_core::{NotesHost, SearchIndex};
use serde_json::{json, Value};

fn search(host: &mut NotesHost, q: &str) -> Vec<String> {
    let hits = ok(host, json!({"type": "search", "query": q}));
    hits["hits"]
        .as_array()
        .unwrap()
        .iter()
        .map(|h| h["title"].as_str().unwrap().to_string())
        .collect()
}

fn setup() -> NotesHost {
    let (mut host, inbox) = host_with_section();
    for (title, body) in [
        ("Café in Wien", "Melange und Sachertorte am Nachmittag."),
        (
            "Groceries",
            "Buy coffee beans, oat milk and a café crème filter.",
        ),
        ("Résumé", "Ärger mit der Straßenbahn; big red fox jumps."),
        ("Fox notes", "The red big fox is quick."),
    ] {
        let doc = create_page(&mut host, &inbox, title);
        let mut m = Mirror::open(&mut host, &doc);
        m.block_text(0).insert(0, body).unwrap();
        m.commit_and_send(&mut host, &doc, T0);
    }
    host
}

#[test]
fn case_and_diacritics_insensitive_prefix_and() {
    let mut host = setup();
    assert_eq!(
        search(&mut host, "CAFE"),
        ["Café in Wien", "Groceries"],
        "title hit ranks first"
    );
    assert_eq!(search(&mut host, "ärg"), ["Résumé"]);
    assert_eq!(
        search(&mut host, "arger STRASS"),
        Vec::<String>::new(),
        "ß is not folded to ss"
    );
    assert_eq!(search(&mut host, "resume"), ["Résumé"]);
    assert_eq!(
        search(&mut host, "melan sacher"),
        ["Café in Wien"],
        "prefix per word, AND"
    );
    assert_eq!(search(&mut host, "melange coffee"), Vec::<String>::new());
    assert_eq!(
        search(&mut host, "wien melange"),
        ["Café in Wien"],
        "terms may split between title and body"
    );
}

#[test]
fn phrases_with_quotes() {
    let mut host = setup();
    let mut both = search(&mut host, "red fox");
    both.sort();
    assert_eq!(both, ["Fox notes", "Résumé"]);
    assert_eq!(search(&mut host, "\"big red fox\""), ["Résumé"]);
    assert_eq!(search(&mut host, "\"red big\""), ["Fox notes"]);
    assert_eq!(
        search(&mut host, "\"oat mi\""),
        ["Groceries"],
        "last phrase word by prefix"
    );
}

#[test]
fn ranking_snippet_and_scope() {
    let mut host = setup();
    // "fox": title + body hit ranks before body only.
    assert_eq!(search(&mut host, "fox"), ["Fox notes", "Résumé"]);
    let hits = ok(&mut host, json!({"type": "search", "query": "sacher"}));
    let h: &Value = &hits["hits"][0];
    assert_eq!(h["snippet"], "Melange und Sachertorte am Nachmittag.");
    assert_eq!(h["ranges"], json!([[12, 23]]));
    assert_eq!(
        ok(
            &mut host,
            json!({"type": "search", "query": "sacher", "notebook": "other"})
        )["hits"],
        json!([])
    );
    // Renamed and deleted pages.
    let node = h["docId"].as_str().unwrap().to_string();
    let node = host
        .notebook_doc("nb")
        .unwrap()
        .node_of_page_doc(&node)
        .unwrap();
    ok(
        &mut host,
        json!({"type": "rename", "notebook": "nb", "node": node, "title": "Kaffeehaus"}),
    );
    assert_eq!(search(&mut host, "kaffee"), ["Kaffeehaus"]);
    ok(
        &mut host,
        json!({"type": "delete", "notebook": "nb", "node": node}),
    );
    assert!(search(&mut host, "kaffee").is_empty());
}

/// Performance target: < 100 ms per query for 500 pages × 2 000 words. Numbers only mean something in release:
/// `cargo test --release -p notes-core --test search -- --ignored --nocapture`.
#[test]
#[ignore = "bench: run in release"]
fn bench_500_pages_2000_words() {
    struct Rng(u64);
    impl Rng {
        fn next(&mut self) -> u64 {
            self.0 ^= self.0 << 13;
            self.0 ^= self.0 >> 7;
            self.0 ^= self.0 << 17;
            self.0
        }
    }
    let mut rng = Rng(0x9E37_79B9_7F4A_7C15);
    let syll = [
        "ka", "lo", "mi", "ne", "ru", "sa", "te", "vo", "zi", "bé", "dö", "fü", "gra", "hel", "jun",
    ];
    let vocab: Vec<String> = (0..20_000)
        .map(|_| {
            (0..2 + rng.next() % 3)
                .map(|_| syll[(rng.next() % syll.len() as u64) as usize])
                .collect()
        })
        .collect();
    let mut ix = SearchIndex::new();
    let t = std::time::Instant::now();
    for p in 0..500 {
        let text: Vec<&str> = (0..2000)
            .map(|_| vocab[(rng.next() % vocab.len() as u64) as usize].as_str())
            .collect();
        ix.upsert(
            "nb",
            &format!("pg-{p}"),
            &format!("Page {p} {}", vocab[p]),
            &text.join(" "),
        );
    }
    println!("index build 500 × 2000 words: {:?}", t.elapsed());
    let all = |_: &str, _: &str| true;
    let mut worst = std::time::Duration::ZERO;
    for q in [
        "ka",
        "kalo",
        "döfü",
        "graheljun",
        "\"ka lo\"",
        "mi ne ru",
        "zz",
        "bé",
        "Page 42",
        "s",
    ] {
        let t = std::time::Instant::now();
        let n = ix.search(q, None, 50, &all).len();
        let el = t.elapsed();
        worst = worst.max(el);
        println!("query {q:>12}: {n:>3} hits in {el:?}");
    }
    println!("worst query: {worst:?}");
    assert!(worst.as_millis() < 100, "worst query {worst:?}");
}
