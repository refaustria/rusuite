//! The relay with real WebSocket clients (tokio-tungstenite) speaking the binary protocol of `notes_sync::protocol`.

mod common;

use std::collections::BTreeSet;

use common::*;
use notes_relay::Limits;
use notes_sync::protocol;
use notes_sync::protocol::{ClientMsg, ErrorCode, RelayMsg, StopSharing};
use notes_sync::*;
use tokio::io::{AsyncReadExt, AsyncWriteExt};

const MARK: &str = "PLAINTEXT-MARKER-7f3a";

/// The brief's port for the relay tests (P11-N5a → 5120); the other tests use free ports so they can run in parallel.
const PORT: u16 = 5120;

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn session_converges_catches_up_compacts_and_stores_no_plaintext() {
    let s = start(PORT, Limits::default()).await;
    let mut ana = create_shared(s.addr, &format!("Ana {MARK}-name")).await;
    let mut ben = invite(
        &mut ana,
        s.addr,
        Role::Edit,
        &format!("Ben {MARK}-name"),
        T0,
    )
    .await;
    assert_eq!(
        ben.chain
            .latest()
            .display_name(&ben.ring, &ana.id())
            .unwrap(),
        format!("Ana {MARK}-name")
    );
    ana.sync(50).await;

    // Both subscribe to one page and type concurrently: each sees the other's opaque updates, in relay order.
    let doc = DocId::random(&mut OsRng);
    for m in [&mut ana, &mut ben] {
        let r = m.c.subscribe(m.nb, &[(doc, 0)]).await;
        assert!(matches!(r.last(), Some(RelayMsg::CaughtUp { last: 0, .. })));
    }
    let mut seqs = Vec::new();
    for i in 0..5u32 {
        let a = ana.seal(doc, Kind::Update, format!("{MARK} ana {i}").as_bytes());
        let b = ben.seal(doc, Kind::Update, format!("{MARK} ben {i}").as_bytes());
        ana.c
            .send(&ClientMsg::Publish {
                tag: 100 + i,
                envelope: a,
            })
            .await;
        ben.c
            .send(&ClientMsg::Publish {
                tag: 200 + i,
                envelope: b,
            })
            .await;
    }
    let mut seen_by = |msgs: Vec<RelayMsg>, me: &Peer, other: &str| -> BTreeSet<String> {
        let mut got = BTreeSet::new();
        for m in msgs {
            match m {
                RelayMsg::Deliver { seq, envelope } => {
                    let p = String::from_utf8(me.open_live(&envelope).unwrap()).unwrap();
                    assert!(
                        p.contains(other),
                        "only the other side's updates are forwarded"
                    );
                    got.insert(p);
                    seqs.push(seq);
                }
                RelayMsg::Accepted { seq, .. } => {
                    seqs.push(seq);
                }
                other => panic!("unexpected {other:?}"),
            }
        }
        got
    };
    let a_msgs = ana.c.drain(300).await;
    let b_msgs = ben.c.drain(300).await;
    let ana_got = seen_by(a_msgs, &ana, "ben");
    let ben_got = seen_by(b_msgs, &ben, "ana");
    assert_eq!(ana_got.len(), 5);
    assert_eq!(ben_got.len(), 5);
    seqs.sort();
    seqs.dedup();
    assert_eq!(
        seqs,
        (1..=10).collect::<Vec<u64>>(),
        "one sequence number per update"
    );

    // Presence reaches the other subscriber and is never stored.
    let p = ben.seal(doc, Kind::Presence, format!("{MARK} cursor").as_bytes());
    ben.c
        .send(&ClientMsg::Publish {
            tag: 0,
            envelope: p,
        })
        .await;
    let RelayMsg::Presence { envelope } = ana
        .c
        .wait_for(|m| matches!(m, RelayMsg::Presence { .. }))
        .await
    else {
        unreachable!()
    };
    assert_eq!(
        ana.open_live(&envelope).unwrap(),
        format!("{MARK} cursor").into_bytes()
    );
    ben.c.assert_quiet(100).await;

    // A blob.
    let blob = DocId::random(&mut OsRng);
    let env = ana.seal(blob, Kind::Blob, format!("{MARK} image bytes").as_bytes());
    assert_eq!(ana.c.publish(300, &env).await, Ok(0));
    ben.c
        .send(&ClientMsg::FetchBlob {
            notebook_id: ben.nb,
            blob_id: blob,
        })
        .await;
    let RelayMsg::Blob { envelope } = ben.c.wait_for(|m| matches!(m, RelayMsg::Blob { .. })).await
    else {
        unreachable!()
    };
    assert_eq!(
        ben.open_live(&envelope).unwrap(),
        format!("{MARK} image bytes").into_bytes()
    );
    ben.c
        .send(&ClientMsg::FetchBlob {
            notebook_id: ben.nb,
            blob_id: DocId([3; 16]),
        })
        .await;
    assert!(matches!(ben.c.recv().await, RelayMsg::BlobMissing { .. }));

    // A late joiner (read-only) catches up from the log alone.
    let mut cleo = invite(&mut ana, s.addr, Role::Read, "Cleo", T0 + 60).await;
    ana.sync(50).await;
    ben.sync(50).await;
    let r = cleo.c.subscribe(cleo.nb, &[(doc, 0)]).await;
    let RelayMsg::Subscribed { docs, .. } = &r[0] else {
        panic!()
    };
    assert_eq!(
        docs,
        &vec![protocol::DocSeq {
            doc_id: doc,
            seq: 10
        }]
    );
    let got = delivered(&r);
    assert_eq!(
        got.iter().map(|(s, _)| *s).collect::<Vec<_>>(),
        (1..=10).collect::<Vec<_>>()
    );
    let mut all = BTreeSet::new();
    for (_, e) in &got {
        all.insert(String::from_utf8(cleo.open_historic(e).unwrap()).unwrap());
    }
    let mut union = ana_got.clone();
    union.extend(ben_got.clone());
    assert_eq!(all, union, "the late joiner converges on the same payloads");
    // Read-only: updates refused, presence allowed.
    let u = cleo.seal(doc, Kind::Update, b"nope");
    assert_eq!(cleo.c.publish(1, &u).await, Err(ErrorCode::Forbidden));
    let snap = Envelope::seal(
        &cleo.c.keys,
        cleo.ring.current().unwrap(),
        cleo.nb,
        doc,
        Kind::Snapshot,
        3,
        b"s",
        &mut OsRng,
    )
    .unwrap();
    assert_eq!(cleo.c.publish(2, &snap).await, Err(ErrorCode::Forbidden));

    // Compaction: Ana uploads a snapshot covering seq 8; the log keeps only 9 and 10.
    let log_path = s
        .dir
        .join(ana.nb.to_hex())
        .join("docs")
        .join(format!("{}.log", doc.to_hex()));
    let before = std::fs::metadata(&log_path).unwrap().len();
    let snap = Envelope::seal(
        &ana.c.keys,
        ana.ring.current().unwrap(),
        ana.nb,
        doc,
        Kind::Snapshot,
        8,
        format!("{MARK} snapshot").as_bytes(),
        &mut OsRng,
    )
    .unwrap();
    assert_eq!(ana.c.publish(400, &snap).await, Ok(8));
    assert!(std::fs::metadata(&log_path).unwrap().len() < before / 3);
    assert_eq!(
        ana.c.publish(401, &snap).await,
        Err(ErrorCode::Outdated),
        "nothing new"
    );
    let too_far = Envelope::seal(
        &ana.c.keys,
        ana.ring.current().unwrap(),
        ana.nb,
        doc,
        Kind::Snapshot,
        11,
        b"s",
        &mut OsRng,
    )
    .unwrap();
    assert_eq!(
        ana.c.publish(402, &too_far).await,
        Err(ErrorCode::Malformed),
        "covers beyond the log"
    );
    // A new device of Cleo's starting from scratch gets the snapshot (as seq 8) and 9, 10.
    let mut fresh = Client::connect(
        s.addr,
        DeviceKeys::from_bytes(&cleo.c.keys.to_bytes()).unwrap(),
    )
    .await;
    let r = fresh.subscribe(cleo.nb, &[(doc, 0)]).await;
    let got = delivered(&r);
    assert_eq!(
        got.iter().map(|(s, _)| *s).collect::<Vec<_>>(),
        vec![8, 9, 10]
    );
    assert_eq!(got[0].1.kind, Kind::Snapshot);
    assert_eq!(
        cleo.open_historic(&got[0].1).unwrap(),
        format!("{MARK} snapshot").into_bytes()
    );
    // Someone who already had seq 9 gets only 10; someone up to date gets nothing.
    let r = fresh.subscribe(cleo.nb, &[(doc, 9)]).await;
    assert_eq!(
        delivered(&r).iter().map(|(s, _)| *s).collect::<Vec<_>>(),
        vec![10]
    );
    let r = fresh.subscribe(cleo.nb, &[(doc, 10)]).await;
    assert!(delivered(&r).is_empty());
    assert!(matches!(
        r.last(),
        Some(RelayMsg::CaughtUp { last: 10, .. })
    ));
    fresh.close().await;

    // After the session: no plaintext marker anywhere in the relay's storage, no names.
    let files = all_bytes(&s.dir);
    assert!(files.len() > 8, "{files:?}");
    for (path, bytes) in &files {
        for needle in [MARK.as_bytes(), b"Cleo".as_slice(), b"cursor".as_slice()] {
            assert!(
                !contains(bytes, needle),
                "{} contains plaintext",
                path.display()
            );
        }
    }
    for m in [ana, ben, cleo] {
        m.c.close().await;
    }
}

/// Review focus 4: a revoked device keeps editing offline → rejected by the relay, visible on its device, never
/// applied for others; remaining members' offline edits survive via re-encryption.
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn revoked_device_is_rejected_and_remaining_members_reencrypt() {
    let limits = Limits {
        epoch_grace_secs: 300,
        ..Limits::default()
    };
    let s = start(0, limits).await;
    let mut ana = create_shared(s.addr, "Ana").await;
    let mut ben = invite(&mut ana, s.addr, Role::Edit, "Ben", T0).await;
    let mut cleo = invite(&mut ana, s.addr, Role::Edit, "Cleo", T0).await;
    ana.sync(50).await;
    ben.sync(50).await;
    let doc = DocId::random(&mut OsRng);
    for m in [&mut ana, &mut ben, &mut cleo] {
        m.c.subscribe(m.nb, &[(doc, 0)]).await;
    }
    let early = cleo.seal(doc, Kind::Update, b"cleo before removal");
    assert_eq!(cleo.c.publish(1, &early).await, Ok(1));
    ana.c
        .wait_for(|m| matches!(m, RelayMsg::Deliver { .. }))
        .await;
    ben.c
        .wait_for(|m| matches!(m, RelayMsg::Deliver { .. }))
        .await;

    // Ben goes offline and keeps typing (epoch 0).
    let ben_offline_1 = ben.seal(doc, Kind::Update, b"ben offline 1");
    let ben_offline_2 = ben.seal(doc, Kind::Update, b"ben offline 2");

    // Ana removes Cleo: new list (epoch 1) and a key wrap for Ben.
    let (list, wraps) = remove_member(
        &ana.chain,
        &ana.c.keys,
        &mut ana.ring,
        &cleo.id(),
        &mut OsRng,
    )
    .unwrap();
    assert_eq!(ana.c.publish(10, &list).await, Ok(4));
    ana.chain.apply(&list).unwrap();
    assert_eq!(wraps.len(), 1);
    assert_eq!(ana.c.publish(11, &wraps[0]).await, Ok(0));

    // Cleo's open connection is told at once.
    let m = cleo
        .c
        .wait_for(|m| matches!(m, RelayMsg::Revoked { .. }))
        .await;
    assert_eq!(
        m,
        RelayMsg::Revoked {
            notebook_id: cleo.nb
        }
    );

    // Cleo keeps editing offline with the epoch-0 key and later tries to sync: rejected, visibly, on her device…
    let offline = cleo.seal(doc, Kind::Update, b"cleo after removal");
    assert_eq!(cleo.c.publish(2, &offline).await, Err(ErrorCode::NotMember));
    let p = cleo.seal(doc, Kind::Presence, b"cleo cursor");
    cleo.c
        .send(&ClientMsg::Publish {
            tag: 0,
            envelope: p,
        })
        .await;
    assert!(matches!(
        cleo.c.recv().await,
        RelayMsg::Error {
            code: ErrorCode::NotMember,
            ..
        }
    ));
    // …also after reconnecting: the subscription says "revoked" and delivers nothing.
    let keys = DeviceKeys::from_bytes(&cleo.c.keys.to_bytes()).unwrap();
    let mut cleo2 = Client::connect(s.addr, keys).await;
    assert_eq!(
        cleo2.subscribe(cleo.nb, &[(doc, 0)]).await,
        vec![RelayMsg::Revoked {
            notebook_id: cleo.nb
        }]
    );
    assert_eq!(cleo2.publish(3, &offline).await, Err(ErrorCode::NotMember));
    cleo2
        .send(&ClientMsg::FetchBlob {
            notebook_id: cleo.nb,
            blob_id: doc,
        })
        .await;
    assert!(matches!(
        cleo2.recv().await,
        RelayMsg::Error {
            code: ErrorCode::NotSubscribed,
            ..
        }
    ));

    // Ben comes back: receives the new list and his key wrap, nothing from Cleo.
    let msgs = ben.c.drain(200).await;
    assert!(
        delivered(&msgs).is_empty(),
        "the revoked device's edits never reach others: {msgs:?}"
    );
    ben.absorb(&msgs);
    assert_eq!(ben.chain.latest().epoch, 1);
    assert_eq!(ben.ring.current().unwrap().epoch(), 1);
    // Even if a (malicious) relay forwarded Cleo's offline edit, Ben's device would refuse it.
    assert_eq!(ben.chain.authorize(&offline), Err(SyncError::NotMember));
    // Her pre-removal edit stays valid history.
    assert_eq!(ben.open_historic(&early).unwrap(), b"cleo before removal");

    // Ben's queued epoch-0 edit within the grace window: accepted.
    assert_eq!(ben.c.publish(20, &ben_offline_1).await, Ok(2));
    // After the grace window: stale → re-encrypt with the new epoch → accepted.
    s.clock.advance(301);
    assert_eq!(
        ben.c.publish(21, &ben_offline_2).await,
        Err(ErrorCode::StaleEpoch)
    );
    let re = ben_offline_2
        .reencrypt(
            &ben.ring,
            ben.ring.current().unwrap(),
            &ben.c.keys,
            &mut OsRng,
        )
        .unwrap();
    assert_eq!(re.epoch, 1);
    assert_eq!(ben.c.publish(22, &re).await, Ok(3));
    let got = delivered(&ana.c.drain(200).await);
    assert_eq!(got.len(), 2);
    assert_eq!(ana.open_live(&got[1].1).unwrap(), b"ben offline 2");
    // Cleo has no epoch-1 key: whatever she synced before, newer content stays unreadable to her.
    assert_eq!(re.open(&cleo.ring), Err(SyncError::MissingEpochKey(1)));
    assert!(
        cleo2.subscribe(cleo.nb, &[]).await
            == vec![RelayMsg::Revoked {
                notebook_id: cleo.nb
            }]
    );

    // A future epoch is refused.
    let future = Envelope::seal(
        &ben.c.keys,
        &NotebookKey::generate(2, &mut OsRng),
        ben.nb,
        doc,
        Kind::Update,
        0,
        b"x",
        &mut OsRng,
    )
    .unwrap();
    assert_eq!(ben.c.publish(23, &future).await, Err(ErrorCode::WrongEpoch));
    // Key wraps for removed devices are refused.
    let w = wrap_keyring(
        &ana.c.keys,
        ana.nb,
        &cleo.c.keys.public(),
        &ana.ring,
        &mut OsRng,
    )
    .unwrap();
    assert_eq!(ana.c.publish(12, &w).await, Err(ErrorCode::NotMember));
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn size_quota_and_rate_limits() {
    let limits = Limits {
        notebook_quota_bytes: 24 * 1024,
        envelope_max_bytes: 2048,
        blob_max_bytes: 8 * 1024,
        messages_per_sec: 20,
        ..Limits::default()
    };
    let s = start(0, limits).await;
    let mut ana = create_shared(s.addr, "Ana").await;
    let doc = DocId::random(&mut OsRng);
    ana.c.subscribe(ana.nb, &[(doc, 0)]).await;

    let big = ana.seal(doc, Kind::Update, &[7u8; 2048]);
    assert_eq!(ana.c.publish(1, &big).await, Err(ErrorCode::TooLarge));
    let blob = ana.seal(DocId::random(&mut OsRng), Kind::Blob, &[1u8; 6000]);
    assert_eq!(ana.c.publish(2, &blob).await, Ok(0));
    let huge_blob = ana.seal(DocId::random(&mut OsRng), Kind::Blob, &[1u8; 9000]);
    assert_eq!(ana.c.publish(3, &huge_blob).await, Err(ErrorCode::TooLarge));

    // Fill the quota (paced below the rate limit).
    let mut tag = 10;
    let quota = loop {
        let u = ana.seal(doc, Kind::Update, &[9u8; 1500]);
        tag += 1;
        match ana.c.publish(tag, &u).await {
            Ok(_) => tokio::time::sleep(std::time::Duration::from_millis(60)).await,
            Err(e) => break e,
        }
        assert!(tag < 40, "quota never reached");
    };
    assert_eq!(quota, ErrorCode::QuotaExceeded);
    // A snapshot that frees space is still accepted (compaction is the way out).
    let last = match ana.c.subscribe(ana.nb, &[(doc, 1_000)]).await.last() {
        Some(RelayMsg::CaughtUp { last, .. }) => *last,
        other => panic!("{other:?}"),
    };
    let snap = Envelope::seal(
        &ana.c.keys,
        ana.ring.current().unwrap(),
        ana.nb,
        doc,
        Kind::Snapshot,
        last,
        &[5u8; 1000],
        &mut OsRng,
    )
    .unwrap();
    assert_eq!(ana.c.publish(100, &snap).await, Ok(last));
    let u = ana.seal(doc, Kind::Update, b"fits again");
    assert!(ana.c.publish(101, &u).await.is_ok());

    // Rate limit: a burst of 60 messages, 20/s allowed.
    tokio::time::sleep(std::time::Duration::from_millis(1100)).await;
    let tiny = ana.seal(doc, Kind::Presence, b"p");
    for i in 0..60u32 {
        ana.c
            .send(&ClientMsg::Publish {
                tag: 1000 + i,
                envelope: tiny.clone(),
            })
            .await;
    }
    let msgs = ana.c.drain(300).await;
    let limited = msgs
        .iter()
        .filter(|m| {
            matches!(
                m,
                RelayMsg::Rejected {
                    code: ErrorCode::RateLimited,
                    ..
                }
            )
        })
        .count();
    assert!((30..=45).contains(&limited), "{limited} rate-limited of 60");

    // Text frames and garbage are refused without closing the connection.
    tokio::time::sleep(std::time::Duration::from_millis(1100)).await;
    ana.c
        .send_raw(tokio_tungstenite::tungstenite::Message::text("hello"))
        .await;
    assert!(matches!(
        ana.c.recv().await,
        RelayMsg::Error {
            code: ErrorCode::Malformed,
            ..
        }
    ));
    ana.c
        .send_raw(tokio_tungstenite::tungstenite::Message::binary(vec![
            255u8, 1, 2,
        ]))
        .await;
    assert!(matches!(
        ana.c.recv().await,
        RelayMsg::Error {
            code: ErrorCode::Malformed,
            ..
        }
    ));
    let u = ana.seal(doc, Kind::Update, b"still connected");
    assert!(ana.c.publish(102, &u).await.is_ok());
}

async fn http(addr: std::net::SocketAddr, method: &str, path: &str, body: &[u8]) -> (u16, String) {
    let mut s = tokio::net::TcpStream::connect(addr).await.unwrap();
    let head = format!(
        "{method} {path} HTTP/1.1\r\nHost: x\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
        body.len()
    );
    s.write_all(head.as_bytes()).await.unwrap();
    s.write_all(body).await.unwrap();
    let mut out = Vec::new();
    s.read_to_end(&mut out).await.unwrap();
    let text = String::from_utf8_lossy(&out).to_string();
    let status = text[9..12].parse().unwrap();
    (status, text)
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn stop_sharing_over_websocket_and_http() {
    let s = start(0, Limits::default()).await;
    let (status, body) = http(s.addr, "GET", "/api/notes/health", b"").await;
    assert_eq!(status, 200);
    assert!(body.contains("\"ok\":true"));

    let mut ana = create_shared(s.addr, "Ana").await;
    let mut ben = invite(&mut ana, s.addr, Role::CoOwner, "Ben", T0).await;
    let doc = DocId::random(&mut OsRng);
    assert!(ana
        .c
        .publish(5, &ana.seal(doc, Kind::Update, b"x"))
        .await
        .is_ok());
    let dir = s.dir.join(ana.nb.to_hex());
    assert!(dir.is_dir());

    // Only an owner may stop sharing (a co-owner may not); stale or forged requests are refused.
    ben.c
        .send(&ClientMsg::StopSharing(StopSharing::new(
            &ben.c.keys,
            ben.nb,
            T0,
        )))
        .await;
    assert!(matches!(
        ben.c.recv().await,
        RelayMsg::Error {
            code: ErrorCode::Forbidden,
            ..
        }
    ));
    let stale = StopSharing::new(&ana.c.keys, ana.nb, T0 - 3600);
    ana.c.send(&ClientMsg::StopSharing(stale)).await;
    assert!(matches!(
        ana.c
            .wait_for(|m| matches!(m, RelayMsg::Error { .. }))
            .await,
        RelayMsg::Error {
            code: ErrorCode::Malformed,
            ..
        }
    ));
    let mut forged = StopSharing::new(&ana.c.keys, ana.nb, T0);
    forged.signature[0] ^= 1;
    ana.c.send(&ClientMsg::StopSharing(forged)).await;
    assert!(matches!(
        ana.c
            .wait_for(|m| matches!(m, RelayMsg::Error { .. }))
            .await,
        RelayMsg::Error {
            code: ErrorCode::BadSignature,
            ..
        }
    ));
    let outsider = DeviceKeys::generate(&mut OsRng);
    let (st, _) = http(
        s.addr,
        "DELETE",
        &format!("/api/notes/notebooks/{}", ana.nb.to_hex()),
        &StopSharing::new(&outsider, ana.nb, T0).encode(),
    )
    .await;
    assert_eq!(st, 403);
    assert!(dir.is_dir());

    // The owner stops sharing: everything is gone and subscribers are told.
    ana.c
        .send(&ClientMsg::StopSharing(StopSharing::new(
            &ana.c.keys,
            ana.nb,
            T0,
        )))
        .await;
    assert_eq!(
        ana.c
            .wait_for(|m| matches!(m, RelayMsg::Deleted { .. }))
            .await,
        RelayMsg::Deleted {
            notebook_id: ana.nb
        }
    );
    assert_eq!(
        ben.c
            .wait_for(|m| matches!(m, RelayMsg::Deleted { .. }))
            .await,
        RelayMsg::Deleted {
            notebook_id: ana.nb
        }
    );
    assert!(!dir.exists());
    let r = ben.c.subscribe(ben.nb, &[]).await;
    assert!(matches!(
        r[0],
        RelayMsg::Error {
            code: ErrorCode::NotFound,
            ..
        }
    ));

    // HTTP DELETE does the same.
    let mut other = create_shared(s.addr, "Ana").await;
    let path = format!("/api/notes/notebooks/{}", other.nb.to_hex());
    let req = StopSharing::new(&other.c.keys, other.nb, T0).encode();
    let (st, _) = http(s.addr, "DELETE", "/api/notes/notebooks/zz", &req).await;
    assert_eq!(st, 400);
    let (st, _) = http(s.addr, "DELETE", &path, b"garbage").await;
    assert_eq!(st, 400);
    let (st, _) = http(s.addr, "DELETE", &path, &req).await;
    assert_eq!(st, 204);
    assert!(!s.dir.join(other.nb.to_hex()).exists());
    assert!(matches!(
        other
            .c
            .wait_for(|m| matches!(m, RelayMsg::Deleted { .. }))
            .await,
        RelayMsg::Deleted { .. }
    ));
    let (st, _) = http(s.addr, "DELETE", &path, &req).await;
    assert_eq!(st, 404);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn authentication_membership_and_join_rules() {
    let s = start(0, Limits::default()).await;
    let mut ana = create_shared(s.addr, "Ana").await;
    let doc = DocId::random(&mut OsRng);

    // Unknown notebook, forged proof.
    let mut x = Client::new_device(s.addr).await;
    let r = x.subscribe(NotebookId::random(&mut OsRng), &[]).await;
    assert!(matches!(
        r[0],
        RelayMsg::Error {
            code: ErrorCode::NotFound,
            ..
        }
    ));
    let ClientMsg::Subscribe {
        signing_pub,
        mut proof,
        docs,
        ..
    } = protocol::subscribe(&ana.c.keys, &x.challenge, ana.nb, vec![])
    else {
        unreachable!()
    };
    proof[0] ^= 1;
    x.send(&ClientMsg::Subscribe {
        notebook_id: ana.nb,
        signing_pub,
        proof,
        docs,
    })
    .await;
    assert!(matches!(
        x.recv().await,
        RelayMsg::Error {
            code: ErrorCode::BadSignature,
            ..
        }
    ));
    // A proof made for another connection's challenge (replay) is refused too.
    let replay = protocol::subscribe(&ana.c.keys, &ana.c.challenge, ana.nb, vec![]);
    x.send(&replay).await;
    assert!(matches!(
        x.recv().await,
        RelayMsg::Error {
            code: ErrorCode::BadSignature,
            ..
        }
    ));

    // A captured, validly signed update replayed by a third party: refused (the connection is not its author).
    let u = ana.seal(doc, Kind::Update, b"x");
    assert_eq!(ana.c.publish(1, &u).await, Ok(1));
    assert_eq!(x.publish(2, &u).await, Err(ErrorCode::NotSubscribed));
    // Tampered envelopes.
    let mut t = ana.seal(doc, Kind::Update, b"y");
    t.payload[0] ^= 1;
    assert_eq!(ana.c.publish(3, &t).await, Err(ErrorCode::BadSignature));
    // A non-member's update.
    let mut stranger = Peer {
        c: Client::new_device(s.addr).await,
        ring: ana.ring.clone(),
        chain: ana.chain.clone(),
        nb: ana.nb,
    };
    assert_eq!(
        stranger.c.subscribe(ana.nb, &[]).await,
        vec![RelayMsg::Pending {
            notebook_id: ana.nb
        }]
    );
    let su = stranger.seal(doc, Kind::Update, b"z");
    assert_eq!(stranger.c.publish(4, &su).await, Err(ErrorCode::NotMember));
    // Genesis replay / second genesis for an existing notebook, and forged member lists.
    let (_, _, genesis2) = create_share(&stranger.c.keys, ana.nb, "Mallory", &mut OsRng);
    assert_eq!(
        stranger.c.publish(5, &genesis2).await,
        Err(ErrorCode::NotMember)
    );
    let mut grab = ana.chain.latest().clone();
    grab.version += 1;
    grab.members[0].role = Role::Edit;
    let (_, _, me) = create_share(&stranger.c.keys, ana.nb, "Mallory", &mut OsRng);
    grab.members
        .push(MemberList::from_envelope(&me).unwrap().members[0].clone());
    assert_eq!(
        stranger
            .c
            .publish(6, &grab.to_envelope(&stranger.c.keys))
            .await,
        Err(ErrorCode::NotMember)
    );
    let mut rollback = ana.chain.latest().clone();
    rollback.members[0].role = Role::Owner;
    assert_eq!(
        ana.c.publish(7, &rollback.to_envelope(&ana.c.keys)).await,
        Err(ErrorCode::MemberList)
    );
    // A genesis that is not version 1 does not create a notebook.
    let mut bad = MemberList::from_envelope(&me).unwrap();
    bad.notebook_id = NotebookId::random(&mut OsRng);
    bad.version = 3;
    assert_eq!(
        stranger
            .c
            .publish(8, &bad.to_envelope(&stranger.c.keys))
            .await,
        Err(ErrorCode::MemberList)
    );
    // Snapshot/blob/presence for a doc are all member-only.
    stranger
        .c
        .send(&ClientMsg::Publish {
            tag: 0,
            envelope: stranger.seal(doc, Kind::Presence, b"p"),
        })
        .await;
    assert!(matches!(
        stranger.c.recv().await,
        RelayMsg::Error {
            code: ErrorCode::NotMember,
            ..
        }
    ));

    // Join requests: one per invite; not from members; not without a pending subscription; invalid signature.
    let inv = Invite::create(ana.nb, Role::Edit, "", T0, &mut OsRng).unwrap();
    let j1 = join_request(&inv, &stranger.c.keys, "S", T0, &mut OsRng).unwrap();
    assert_eq!(stranger.c.publish(9, &j1).await, Ok(0));
    let mut other = Client::new_device(s.addr).await;
    other.subscribe(ana.nb, &[]).await;
    let j2 = join_request(&inv, &other.keys, "O", T0, &mut OsRng).unwrap();
    assert_eq!(other.publish(10, &j2).await, Err(ErrorCode::InviteUsed));
    let j3 = join_request(
        &Invite::create(ana.nb, Role::Edit, "", T0, &mut OsRng).unwrap(),
        &ana.c.keys,
        "A",
        T0,
        &mut OsRng,
    )
    .unwrap();
    assert_eq!(ana.c.publish(11, &j3).await, Err(ErrorCode::Forbidden));
    let inv4 = Invite::create(ana.nb, Role::Edit, "", T0, &mut OsRng).unwrap();
    let j4 = join_request(&inv4, &x.keys, "X", T0, &mut OsRng).unwrap();
    assert_eq!(x.publish(12, &j4).await, Err(ErrorCode::NotSubscribed));
    let mut j5 = join_request(&inv4, &other.keys, "O", T0, &mut OsRng).unwrap();
    j5.signature[3] ^= 1;
    assert_eq!(other.publish(13, &j5).await, Err(ErrorCode::BadSignature));
    // The owner sees the open request live and again on subscribe; an editor does not.
    let RelayMsg::JoinRequest { envelope } = ana
        .c
        .wait_for(|m| matches!(m, RelayMsg::JoinRequest { .. }))
        .await
    else {
        unreachable!()
    };
    assert_eq!(envelope, j1);
    let r = ana.c.subscribe(ana.nb, &[]).await;
    assert!(
        matches!(&r[0], RelayMsg::Subscribed { join_requests, .. } if join_requests == &vec![j1.clone()])
    );
    let mut ben = invite(&mut ana, s.addr, Role::Edit, "Ben", T0).await;
    let r = ben.c.subscribe(ben.nb, &[]).await;
    assert!(
        matches!(&r[0], RelayMsg::Subscribed { join_requests, .. } if join_requests.is_empty())
    );
    // Editors may not sign member lists or key wraps.
    let mut l = ben.chain.latest().clone();
    l.version += 1;
    assert_eq!(
        ben.c.publish(14, &l.to_envelope(&ben.c.keys)).await,
        Err(ErrorCode::MemberList)
    );
    let w = wrap_keyring(
        &ben.c.keys,
        ben.nb,
        &ana.c.keys.public(),
        &ben.ring,
        &mut OsRng,
    )
    .unwrap();
    assert_eq!(ben.c.publish(15, &w).await, Err(ErrorCode::Forbidden));
    // Ben's request was consumed by his admission: only the stranger's request is still offered.
    let r = ana.c.subscribe(ana.nb, &[]).await;
    assert!(
        matches!(&r[0], RelayMsg::Subscribed { join_requests, .. } if join_requests == &vec![j1.clone()])
    );
    ben.c.close().await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn restart_reloads_and_sweep_deletes_inactive_notebooks() {
    let dir = tmp_dir("restart");
    let doc = DocId::random(&mut OsRng);
    let (nb, keys) = {
        let s = start_in(0, Limits::default(), dir.clone()).await;
        let mut ana = create_shared(s.addr, "Ana").await;
        ana.c.subscribe(ana.nb, &[(doc, 0)]).await;
        for i in 0..3 {
            assert!(ana
                .c
                .publish(i, &ana.seal(doc, Kind::Update, b"u"))
                .await
                .is_ok());
        }
        let inv = Invite::create(ana.nb, Role::Read, "", T0, &mut OsRng).unwrap();
        let mut j = Client::new_device(s.addr).await;
        j.subscribe(ana.nb, &[]).await;
        assert!(j
            .publish(
                1,
                &join_request(&inv, &j.keys, "J", T0, &mut OsRng).unwrap()
            )
            .await
            .is_ok());
        let keys = DeviceKeys::from_bytes(&ana.c.keys.to_bytes()).unwrap();
        // Keep the directory: forget the server without the Drop cleanup.
        let nb = ana.nb;
        ana.c.close().await;
        s.relay.shutdown();
        std::mem::forget(s);
        (nb, keys)
    };
    let s = start_in(0, Limits::default(), dir.clone()).await;
    let mut c = Client::connect(s.addr, keys).await;
    let r = c.subscribe(nb, &[(doc, 1)]).await;
    assert_eq!(
        delivered(&r).iter().map(|(s, _)| *s).collect::<Vec<_>>(),
        vec![2, 3]
    );
    assert!(
        matches!(&r[0], RelayMsg::Subscribed { join_requests, .. } if join_requests.len() == 1)
    );
    // The join request expires after 7 days; the notebook after 365 days without activity.
    s.clock.advance(8 * 86400);
    s.relay.sweep();
    let r = c.subscribe(nb, &[]).await;
    assert!(
        matches!(&r[0], RelayMsg::Subscribed { join_requests, .. } if join_requests.is_empty())
    );
    assert!(dir.join(nb.to_hex()).is_dir());
    s.clock.advance(366 * 86400);
    s.relay.sweep();
    assert_eq!(
        c.wait_for(|m| matches!(m, RelayMsg::Deleted { .. })).await,
        RelayMsg::Deleted { notebook_id: nb }
    );
    assert!(!dir.join(nb.to_hex()).exists());
}
