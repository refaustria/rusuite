//! `IFS(test1, value1, [test2, value2], ...)`.

use crate::ast::ErrorKind;
use crate::functions::Arity;

function!(
    /// Value for the first true test; later pairs are not evaluated. No
    /// true test is `#N/A`; an odd argument count is `#N/A` as well.
    Ifs, "IFS", Arity::range(2, 254), |args, ctx| {
    if args.len() % 2 != 0 {
        return Err(ErrorKind::NA);
    }
    for pair in args.chunks(2) {
        if ctx.bool(&pair[0])? {
            return Ok(ctx.scalar(&pair[1]));
        }
    }
    Err(ErrorKind::NA)
});
