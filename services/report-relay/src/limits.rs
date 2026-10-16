//! In-memory rate limits (survive nothing: a restart forgets them). Sliding one-hour windows:
//! 1 report per app instance, 5 per client IP, 100 in total. A slot is reserved before the report goes to GitHub and
//! released again when GitHub refuses it, so a failed report does not lock the user out.

use std::collections::{HashMap, VecDeque};
use std::net::IpAddr;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};

pub const WINDOW_SECS: u64 = 3600;
pub const PER_INSTANCE: usize = 1;
pub const PER_IP: usize = 5;
pub const GLOBAL: usize = 100;
/// Above this many tracked keys, expired ones are swept on the next request.
const SWEEP_AT: usize = 10_000;

/// Seconds since the Unix epoch (injectable for tests).
pub trait Clock: Send + Sync {
    fn now(&self) -> u64;
}

pub struct SystemClock;

impl Clock for SystemClock {
    fn now(&self) -> u64 {
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(0)
    }
}

/// A clock the tests move by hand.
#[derive(Clone, Default)]
pub struct ManualClock(Arc<AtomicU64>);

impl ManualClock {
    pub fn new(start: u64) -> Self {
        ManualClock(Arc::new(AtomicU64::new(start)))
    }
    pub fn advance(&self, secs: u64) {
        self.0.fetch_add(secs, Ordering::SeqCst);
    }
}

impl Clock for ManualClock {
    fn now(&self) -> u64 {
        self.0.load(Ordering::SeqCst)
    }
}

/// Which limit refused a report, and when it may be retried.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Limited {
    pub scope: &'static str,
    pub retry_after_seconds: u64,
}

/// A reserved slot: `release` it when the report was not delivered.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Ticket {
    instance: String,
    ip: IpAddr,
    at: u64,
}

#[derive(Default)]
struct Windows {
    instance: HashMap<String, VecDeque<u64>>,
    ip: HashMap<IpAddr, VecDeque<u64>>,
    global: VecDeque<u64>,
}

pub struct RateLimiter {
    clock: Arc<dyn Clock>,
    windows: Mutex<Windows>,
}

fn prune(q: &mut VecDeque<u64>, now: u64) {
    while q.front().is_some_and(|&t| t + WINDOW_SECS <= now) {
        q.pop_front();
    }
}

/// `None` if `q` has room below `max`, else the seconds until its oldest entry expires.
fn check(q: Option<&VecDeque<u64>>, max: usize, now: u64) -> Option<u64> {
    let q = q?;
    if q.len() < max {
        return None;
    }
    let oldest = *q.front()?;
    Some((oldest + WINDOW_SECS).saturating_sub(now).max(1))
}

fn remove(q: &mut VecDeque<u64>, at: u64) {
    if let Some(i) = q.iter().rposition(|&t| t == at) {
        q.remove(i);
    }
}

impl RateLimiter {
    pub fn new(clock: Arc<dyn Clock>) -> Self {
        RateLimiter {
            clock,
            windows: Mutex::new(Windows::default()),
        }
    }

    pub fn now(&self) -> u64 {
        self.clock.now()
    }

    /// Reserves a slot for `instance` from `ip`, or says which limit is reached.
    pub fn acquire(&self, instance: &str, ip: IpAddr) -> Result<Ticket, Limited> {
        let now = self.clock.now();
        let mut w = self.windows.lock().unwrap_or_else(|e| e.into_inner());
        prune(&mut w.global, now);
        if let Some(q) = w.instance.get_mut(instance) {
            prune(q, now);
        }
        if let Some(q) = w.ip.get_mut(&ip) {
            prune(q, now);
        }
        if w.instance.len() + w.ip.len() > SWEEP_AT {
            w.instance.retain(|_, q| {
                prune(q, now);
                !q.is_empty()
            });
            w.ip.retain(|_, q| {
                prune(q, now);
                !q.is_empty()
            });
        }
        let limits = [
            (
                "instance",
                check(w.instance.get(instance), PER_INSTANCE, now),
            ),
            ("ip", check(w.ip.get(&ip), PER_IP, now)),
            ("global", check(Some(&w.global), GLOBAL, now)),
        ];
        if let Some((scope, Some(retry))) = limits.into_iter().find(|(_, r)| r.is_some()) {
            return Err(Limited {
                scope,
                retry_after_seconds: retry,
            });
        }
        w.instance
            .entry(instance.to_owned())
            .or_default()
            .push_back(now);
        w.ip.entry(ip).or_default().push_back(now);
        w.global.push_back(now);
        Ok(Ticket {
            instance: instance.to_owned(),
            ip,
            at: now,
        })
    }

    /// Gives a slot back (GitHub did not accept the report).
    pub fn release(&self, ticket: Ticket) {
        let mut w = self.windows.lock().unwrap_or_else(|e| e.into_inner());
        if let Some(q) = w.instance.get_mut(&ticket.instance) {
            remove(q, ticket.at);
        }
        if let Some(q) = w.ip.get_mut(&ticket.ip) {
            remove(q, ticket.at);
        }
        remove(&mut w.global, ticket.at);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn limiter() -> (RateLimiter, ManualClock) {
        let clock = ManualClock::new(1_000_000);
        (RateLimiter::new(Arc::new(clock.clone())), clock)
    }

    fn ip(n: u8) -> IpAddr {
        IpAddr::from([10, 0, 0, n])
    }

    #[test]
    fn one_per_instance_per_hour() {
        let (l, clock) = limiter();
        assert!(l.acquire("a", ip(1)).is_ok());
        let e = l.acquire("a", ip(2)).unwrap_err();
        assert_eq!(e.scope, "instance");
        assert_eq!(e.retry_after_seconds, 3600);
        clock.advance(1800);
        assert_eq!(l.acquire("a", ip(2)).unwrap_err().retry_after_seconds, 1800);
        clock.advance(1800);
        assert!(l.acquire("a", ip(2)).is_ok());
    }

    #[test]
    fn five_per_ip_per_hour() {
        let (l, clock) = limiter();
        for i in 0..5 {
            clock.advance(10);
            assert!(l.acquire(&format!("i{i}"), ip(1)).is_ok());
        }
        let e = l.acquire("i5", ip(1)).unwrap_err();
        assert_eq!(e.scope, "ip");
        assert_eq!(e.retry_after_seconds, 3600 - 40);
        assert!(l.acquire("i5", ip(2)).is_ok());
    }

    #[test]
    fn hundred_in_total() {
        let (l, _) = limiter();
        for i in 0..100u32 {
            let addr = IpAddr::from(i.to_be_bytes());
            assert!(l.acquire(&format!("i{i}"), addr).is_ok());
        }
        assert_eq!(l.acquire("x", ip(200)).unwrap_err().scope, "global");
    }

    #[test]
    fn release_gives_the_slot_back() {
        let (l, _) = limiter();
        let t = l.acquire("a", ip(1)).unwrap();
        l.release(t);
        assert!(l.acquire("a", ip(1)).is_ok());
    }
}
