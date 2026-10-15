//! `RAND()` and the shared generator.

use std::sync::atomic::{AtomicU64, Ordering};

use crate::functions::{Arity, CallContext};
use crate::value::Value;

static STATE: AtomicU64 = AtomicU64::new(0x9E37_79B9_7F4A_7C15);

/// A uniform number in `[0, 1)`: SplitMix64 over a global counter mixed
/// with the evaluation clock (no OS entropy, so it also works on wasm).
pub(crate) fn random01(ctx: &CallContext) -> f64 {
    let c = STATE.fetch_add(0x9E37_79B9_7F4A_7C15, Ordering::Relaxed);
    let mut z = c ^ ctx.now().to_bits().rotate_left(17);
    z = (z ^ (z >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
    z = (z ^ (z >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
    z ^= z >> 31;
    (z >> 11) as f64 / (1u64 << 53) as f64
}

function!(
    /// A uniform random number in `[0, 1)`; volatile.
    Rand, "RAND", Arity::exact(0), volatile, |_args, ctx| {
    Ok(Value::Number(random01(ctx)))
});
