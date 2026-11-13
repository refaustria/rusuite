//! Test harness: a real relay on a local port and WebSocket clients speaking the binary protocol.
#![allow(dead_code)]

use std::collections::VecDeque;
use std::net::SocketAddr;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;

use futures_util::{SinkExt, StreamExt};
use notes_relay::{router, Limits, ManualClock, Relay};
use notes_sync::protocol::{self, ClientMsg, DocSeq, ErrorCode, RelayMsg};
use notes_sync::*;
use tokio::net::TcpStream;
use tokio_tungstenite::tungstenite::Message;
use tokio_tungstenite::{MaybeTlsStream, WebSocketStream};

pub const T0: u64 = 1_800_000_000;

pub struct Server {
    pub addr: SocketAddr,
    pub relay: Arc<Relay>,
    pub clock: ManualClock,
    pub dir: PathBuf,
}

impl Drop for Server {
    fn drop(&mut self) {
        self.relay.shutdown();
        let _ = std::fs::remove_dir_all(&self.dir);
    }
}

pub fn tmp_dir(name: &str) -> PathBuf {
    let mut r = [0u8; 8];
    rand_core::RngCore::fill_bytes(&mut OsRng, &mut r);
    let d = PathBuf::from(env!("CARGO_TARGET_TMPDIR")).join(format!(
        "notes-relay-{name}-{}",
        r.iter().map(|b| format!("{b:02x}")).collect::<String>()
    ));
    std::fs::create_dir_all(&d).unwrap();
    d
}

pub async fn start(port: u16, limits: Limits) -> Server {
    start_in(port, limits, tmp_dir("t")).await
}

pub async fn start_in(port: u16, limits: Limits, dir: PathBuf) -> Server {
    let clock = ManualClock::new(T0);
    let relay = Relay::new(&dir, limits, Arc::new(clock.clone())).unwrap();
    let listener = tokio::net::TcpListener::bind(("127.0.0.1", port))
        .await
        .unwrap();
    let addr = listener.local_addr().unwrap();
    let app = router(relay.clone());
    let mut stop = relay.shutdown_signal();
    tokio::spawn(async move {
        let _ = axum::serve(listener, app)
            .with_graceful_shutdown(async move {
                let _ = stop.changed().await;
            })
            .await;
    });
    Server {
        addr,
        relay,
        clock,
        dir,
    }
}

pub struct Client {
    ws: WebSocketStream<MaybeTlsStream<TcpStream>>,
    pub keys: DeviceKeys,
    pub challenge: [u8; 32],
    backlog: VecDeque<RelayMsg>,
}

impl Client {
    pub async fn connect(addr: SocketAddr, keys: DeviceKeys) -> Client {
        let (ws, _) = tokio_tungstenite::connect_async(format!("ws://{addr}/api/notes/ws"))
            .await
            .unwrap();
        let mut c = Client {
            ws,
            keys,
            challenge: [0; 32],
            backlog: VecDeque::new(),
        };
        match c.next_raw().await {
            Some(RelayMsg::Challenge { nonce, protocol }) => {
                assert_eq!(protocol, protocol::PROTOCOL_VERSION);
                c.challenge = nonce;
            }
            other => panic!("expected a challenge, got {other:?}"),
        }
        c
    }

    pub async fn new_device(addr: SocketAddr) -> Client {
        Client::connect(addr, DeviceKeys::generate(&mut OsRng)).await
    }

    pub async fn send(&mut self, m: &ClientMsg) {
        self.ws.send(Message::binary(m.encode())).await.unwrap();
    }

    pub async fn send_raw(&mut self, m: Message) {
        self.ws.send(m).await.unwrap();
    }

    async fn next_raw_timeout(&mut self, ms: u64) -> Option<RelayMsg> {
        loop {
            match tokio::time::timeout(Duration::from_millis(ms), self.ws.next()).await {
                Err(_) => return None,
                Ok(None) | Ok(Some(Err(_))) => return None,
                Ok(Some(Ok(Message::Binary(b)))) => {
                    return Some(RelayMsg::decode(&b).expect("relay message"))
                }
                Ok(Some(Ok(Message::Close(_)))) => return None,
                Ok(Some(Ok(_))) => continue,
            }
        }
    }

    async fn next_raw(&mut self) -> Option<RelayMsg> {
        self.next_raw_timeout(5000).await
    }

    /// The next message (backlog first).
    pub async fn recv(&mut self) -> RelayMsg {
        if let Some(m) = self.backlog.pop_front() {
            return m;
        }
        self.next_raw().await.expect("a message within 5 s")
    }

    /// Waits for the first message matching `f`; others are kept for later.
    pub async fn wait_for(&mut self, f: impl Fn(&RelayMsg) -> bool) -> RelayMsg {
        if let Some(i) = self.backlog.iter().position(&f) {
            return self.backlog.remove(i).unwrap();
        }
        loop {
            let m = self
                .next_raw()
                .await
                .expect("the awaited message within 5 s");
            if f(&m) {
                return m;
            }
            self.backlog.push_back(m);
        }
    }

    /// Nothing arrives within `ms` (backlog included).
    pub async fn assert_quiet(&mut self, ms: u64) {
        assert!(
            self.backlog.is_empty(),
            "unexpected backlog: {:?}",
            self.backlog
        );
        if let Some(m) = self.next_raw_timeout(ms).await {
            panic!("unexpected message: {m:?}");
        }
    }

    /// Everything queued so far plus whatever arrives within `ms`.
    pub async fn drain(&mut self, ms: u64) -> Vec<RelayMsg> {
        let mut v: Vec<_> = self.backlog.drain(..).collect();
        while let Some(m) = self.next_raw_timeout(ms).await {
            v.push(m);
        }
        v
    }

    /// Subscribes and returns the messages up to the last `CaughtUp` (or the single non-member answer).
    pub async fn subscribe(&mut self, nb: NotebookId, docs: &[(DocId, u64)]) -> Vec<RelayMsg> {
        let docs: Vec<DocSeq> = docs
            .iter()
            .map(|&(doc_id, seq)| DocSeq { doc_id, seq })
            .collect();
        let n = docs.len();
        let msg = protocol::subscribe(&self.keys, &self.challenge, nb, docs);
        self.send(&msg).await;
        let first = self
            .wait_for(|m| {
                matches!(
                    m,
                    RelayMsg::Subscribed { .. }
                        | RelayMsg::Pending { .. }
                        | RelayMsg::Revoked { .. }
                        | RelayMsg::Error { .. }
                )
            })
            .await;
        let mut out = vec![first.clone()];
        if matches!(first, RelayMsg::Subscribed { .. }) {
            let mut caught = 0;
            while caught < n {
                let m = self.recv().await;
                if matches!(m, RelayMsg::CaughtUp { .. }) {
                    caught += 1;
                }
                out.push(m);
            }
        }
        out
    }

    /// Publishes and waits for `Accepted`/`Rejected` with the same tag.
    pub async fn publish(&mut self, tag: u32, env: &Envelope) -> Result<u64, ErrorCode> {
        self.send(&ClientMsg::Publish {
            tag,
            envelope: env.clone(),
        })
        .await;
        match self
            .wait_for(|m| {
                matches!(m, RelayMsg::Accepted { tag: t, .. } | RelayMsg::Rejected { tag: t, .. } if *t == tag)
            })
            .await
        {
            RelayMsg::Accepted { seq, .. } => Ok(seq),
            RelayMsg::Rejected { code, .. } => Err(code),
            _ => unreachable!(),
        }
    }

    pub async fn close(mut self) {
        let _ = self.ws.close(None).await;
    }
}

/// The client-side state of one member device for one notebook.
pub struct Peer {
    pub c: Client,
    pub ring: Keyring,
    pub chain: MemberChain,
    pub nb: NotebookId,
}

impl Peer {
    pub fn id(&self) -> DeviceId {
        self.c.keys.device_id()
    }

    pub fn seal(&self, doc: DocId, kind: Kind, plaintext: &[u8]) -> Envelope {
        Envelope::seal(
            &self.c.keys,
            self.ring.current().unwrap(),
            self.nb,
            doc,
            kind,
            0,
            plaintext,
            &mut OsRng,
        )
        .unwrap()
    }

    /// Verifies (live rules) and decrypts a delivered envelope.
    pub fn open_live(&self, env: &Envelope) -> Result<Vec<u8>, SyncError> {
        self.chain.authorize(env)?;
        env.open(&self.ring)
    }

    pub fn open_historic(&self, env: &Envelope) -> Result<Vec<u8>, SyncError> {
        self.chain.authorize_historic(env)?;
        env.open(&self.ring)
    }

    /// Drains the connection and applies member lists and key wraps; returns the drained messages.
    pub async fn sync(&mut self, ms: u64) -> Vec<RelayMsg> {
        let msgs = self.c.drain(ms).await;
        self.absorb(&msgs);
        msgs
    }

    /// Applies member lists and key wraps found in `msgs`.
    pub fn absorb(&mut self, msgs: &[RelayMsg]) {
        for m in msgs {
            match m {
                RelayMsg::MemberList { envelope } => {
                    self.chain.apply(envelope).unwrap();
                }
                RelayMsg::KeyWrap { envelope } => {
                    let r = unwrap_keyring(envelope, &self.c.keys, &self.chain).unwrap();
                    for e in r.epochs() {
                        self.ring.insert(r.get(e).unwrap().clone());
                    }
                }
                _ => {}
            }
        }
    }
}

/// Ana creates and shares a notebook on the relay.
pub async fn create_shared(addr: SocketAddr, name: &str) -> Peer {
    let mut c = Client::new_device(addr).await;
    let nb = NotebookId::random(&mut OsRng);
    let (ring, chain, genesis) = create_share(&c.keys, nb, name, &mut OsRng);
    assert_eq!(c.publish(1, &genesis).await, Ok(1));
    let r = c.subscribe(nb, &[]).await;
    assert!(matches!(&r[0], RelayMsg::Subscribed { member_lists, .. } if member_lists.len() == 1));
    Peer { c, ring, chain, nb }
}

/// The full invite flow over the relay: `owner` invites a new device with `role`; returns the admitted member.
pub async fn invite(owner: &mut Peer, addr: SocketAddr, role: Role, name: &str, now: u64) -> Peer {
    let inv = Invite::create(owner.nb, role, "", now, &mut OsRng).unwrap();
    let mut pending = PendingInvites::default();
    pending.add(&inv);
    let link = inv.to_fragment();

    // The invitee opens the link on a new device.
    let inv2 = Invite::from_fragment(&link).unwrap();
    let mut c = Client::new_device(addr).await;
    let r = c.subscribe(inv2.notebook_id, &[]).await;
    assert_eq!(
        r,
        vec![RelayMsg::Pending {
            notebook_id: owner.nb
        }]
    );
    let join = join_request(&inv2, &c.keys, name, now, &mut OsRng).unwrap();
    assert_eq!(c.publish(7, &join).await, Ok(0));

    // The owner's device sees it live and admits.
    let RelayMsg::JoinRequest { envelope } = owner
        .c
        .wait_for(|m| matches!(m, RelayMsg::JoinRequest { .. }))
        .await
    else {
        unreachable!()
    };
    let req = pending.open(&envelope, now).unwrap();
    assert_eq!(req.role, role);
    let (list, wrap) = admit(&owner.chain, &owner.c.keys, &owner.ring, &req, &mut OsRng).unwrap();
    let v = owner.chain.latest().version + 1;
    assert_eq!(owner.c.publish(8, &list).await, Ok(v));
    owner.chain.apply(&list).unwrap();
    assert_eq!(owner.c.publish(9, &wrap).await, Ok(0));

    // The invitee is told, subscribes as a member and unwraps the keyring.
    let m = c.wait_for(|m| matches!(m, RelayMsg::Admitted { .. })).await;
    assert_eq!(
        m,
        RelayMsg::Admitted {
            notebook_id: owner.nb
        }
    );
    let r = c.subscribe(owner.nb, &[]).await;
    let RelayMsg::Subscribed {
        member_lists,
        key_wraps,
        join_requests,
        ..
    } = &r[0]
    else {
        panic!("{r:?}")
    };
    assert!(join_requests.is_empty() || role.can_manage());
    let chain = MemberChain::from_envelopes(member_lists).unwrap();
    assert_eq!(chain.latest(), owner.chain.latest());
    assert_eq!(key_wraps.len(), 1);
    let ring = unwrap_keyring(&key_wraps[0], &c.keys, &chain).unwrap();
    Peer {
        c,
        ring,
        chain,
        nb: owner.nb,
    }
}

pub fn delivered(msgs: &[RelayMsg]) -> Vec<(u64, Envelope)> {
    msgs.iter()
        .filter_map(|m| match m {
            RelayMsg::Deliver { seq, envelope } => Some((*seq, envelope.clone())),
            _ => None,
        })
        .collect()
}

/// Every byte under `dir`, recursively.
pub fn all_bytes(dir: &std::path::Path) -> Vec<(PathBuf, Vec<u8>)> {
    let mut out = Vec::new();
    for e in std::fs::read_dir(dir).unwrap().flatten() {
        let p = e.path();
        if p.is_dir() {
            out.extend(all_bytes(&p));
        } else {
            out.push((p.clone(), std::fs::read(&p).unwrap()));
        }
    }
    out
}

pub fn contains(hay: &[u8], needle: &[u8]) -> bool {
    hay.windows(needle.len()).any(|w| w == needle)
}
