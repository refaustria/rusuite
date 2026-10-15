//! `DATEVALUE(date_text)`.

use crate::ast::ErrorKind;
use crate::functions::datetime::serial::parse_date_text;
use crate::functions::Arity;
use crate::value::Value;

function!(
    /// Serial number (time part dropped) of date text; see the accepted
    /// forms in `parse_date_text`. Non-text and unparsable text are `#VALUE!`.
    DateValue, "DATEVALUE", Arity::exact(1), |args, ctx| {
    match ctx.scalar(&args[0]) {
        Value::Text(t) => parse_date_text(&t)
            .map(|n| Value::Number(n.floor()))
            .ok_or(ErrorKind::Value),
        Value::Error(e) => Err(e),
        _ => Err(ErrorKind::Value),
    }
});
