//! `HYPERLINK(link_location, [friendly_name])`.

use crate::functions::Arity;

function!(
    /// The friendly name if given, else the link location (the link
    /// itself is a UI concern).
    Hyperlink, "HYPERLINK", Arity::range(1, 2), |args, ctx| {
    Ok(ctx.scalar(args.get(1).unwrap_or(&args[0])))
});
