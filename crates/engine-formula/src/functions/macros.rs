//! Declarative boilerplate for small functions: one invocation per file
//! defines the unit struct and its [`Function`](crate::functions::Function)
//! implementation.

/// `function!(Struct, "NAME", arity, |args, ctx| { ... Ok(value) })`
///
/// The block returns `Result<Value, ErrorKind>`; `Err(e)` becomes
/// `Value::Error(e)`. Add `volatile` after the arity for volatile functions.
macro_rules! function {
    ($(#[$m:meta])* $S:ident, $name:literal, $arity:expr, volatile, |$args:ident, $ctx:ident| $body:block) => {
        $(#[$m])*
        pub struct $S;
        impl $crate::functions::Function for $S {
            fn name(&self) -> &'static str {
                $name
            }
            fn arity(&self) -> $crate::functions::Arity {
                $arity
            }
            fn is_volatile(&self) -> bool {
                true
            }
            fn call(
                &self,
                $args: &[$crate::ast::Expr],
                $ctx: &mut $crate::functions::CallContext,
            ) -> $crate::value::Value {
                let run = || -> Result<$crate::value::Value, $crate::ast::ErrorKind> { $body };
                match run() {
                    Ok(v) => v,
                    Err(e) => $crate::value::Value::Error(e),
                }
            }
        }
    };
    ($(#[$m:meta])* $S:ident, $name:literal, $arity:expr, |$args:ident, $ctx:ident| $body:block) => {
        $(#[$m])*
        pub struct $S;
        impl $crate::functions::Function for $S {
            fn name(&self) -> &'static str {
                $name
            }
            fn arity(&self) -> $crate::functions::Arity {
                $arity
            }
            fn call(
                &self,
                $args: &[$crate::ast::Expr],
                $ctx: &mut $crate::functions::CallContext,
            ) -> $crate::value::Value {
                let run = || -> Result<$crate::value::Value, $crate::ast::ErrorKind> { $body };
                match run() {
                    Ok(v) => v,
                    Err(e) => $crate::value::Value::Error(e),
                }
            }
        }
    };
}

/// `num1!(Struct, "NAME", |x| expr)`: one numeric argument, `expr` is a
/// `Result<f64, ErrorKind>`.
macro_rules! num1 {
    ($(#[$m:meta])* $S:ident, $name:literal, |$x:ident| $body:expr) => {
        function!($(#[$m])* $S, $name, $crate::functions::Arity::exact(1), |args, ctx| {
            let $x = ctx.number(&args[0])?;
            let r: Result<f64, $crate::ast::ErrorKind> = $body;
            Ok($crate::value::Value::from_result(r))
        });
    };
}

/// `num2!(Struct, "NAME", |x, y| expr)`: two numeric arguments.
macro_rules! num2 {
    ($(#[$m:meta])* $S:ident, $name:literal, |$x:ident, $y:ident| $body:expr) => {
        function!($(#[$m])* $S, $name, $crate::functions::Arity::exact(2), |args, ctx| {
            let $x = ctx.number(&args[0])?;
            let $y = ctx.number(&args[1])?;
            let r: Result<f64, $crate::ast::ErrorKind> = $body;
            Ok($crate::value::Value::from_result(r))
        });
    };
}
