//! `LET`, `LAMBDA` and the lambda helper functions (`MAP`, `REDUCE`,
//! `SCAN`, `BYROW`, `BYCOL`, `MAKEARRAY`, `ISOMITTED`).
//!
//! Names bound by `LET` and lambda parameters live in a scope stack
//! (thread-local, like the name nesting depth of the evaluator): an
//! identifier is looked up there before the defined names. A binding
//! holds an [`Operand`] (a range stays a range: `LET(x,A1:A3,SUM(x))`),
//! a lambda, or "omitted" (a parameter the caller left out). A lambda is
//! called as `LAMBDA(x,x+1)(2)`, through a `LET` name (`LET(f,LAMBDA(x,x*2),f(3))`),
//! through a defined name whose definition is a `LAMBDA` (`=Double(4)`)
//! or by a helper function. A lambda as a cell value is `#CALC!`; calls
//! nested deeper than [`MAX_LAMBDA_DEPTH`] give `#NUM!`.

use std::cell::{Cell, RefCell};
use std::rc::Rc;

use crate::ast::{is_valid_name, ErrorKind, Expr};
use crate::eval::{eval_array, range_value, EvalContext, Operand};
use crate::functions::FunctionRegistry;
use crate::value::Value;

pub mod helpers;
pub mod let_;

#[cfg(test)]
mod tests;

/// Registers every function of this family.
pub fn register(r: &mut FunctionRegistry) {
    r.register(Box::new(let_::Let));
    r.register(Box::new(let_::Lambda));
    r.register(Box::new(let_::IsOmitted));
    r.register(Box::new(helpers::Map));
    r.register(Box::new(helpers::Reduce));
    r.register(Box::new(helpers::Scan));
    r.register(Box::new(helpers::ByRow));
    r.register(Box::new(helpers::ByCol));
    r.register(Box::new(helpers::MakeArray));
}

/// Nesting limit of lambda calls (recursive named lambdas).
pub const MAX_LAMBDA_DEPTH: u32 = 64;

/// A lambda: parameter names and the body.
#[derive(Debug, Clone, PartialEq)]
pub struct LambdaFn {
    pub params: Vec<String>,
    pub body: Expr,
}

/// What a `LET` name or a lambda parameter is bound to.
#[derive(Debug, Clone)]
pub(crate) enum Binding {
    Value(Operand),
    Lambda(Rc<LambdaFn>),
    /// A parameter the caller did not pass (`ISOMITTED` is `TRUE`).
    Omitted,
}

thread_local! {
    static SCOPE: RefCell<Vec<(String, Binding)>> = const { RefCell::new(Vec::new()) };
    static DEPTH: Cell<u32> = const { Cell::new(0) };
}

/// The innermost binding of `name` (case-insensitive).
pub(crate) fn lookup(name: &str) -> Option<Binding> {
    let name = strip_xlpm(name);
    SCOPE.with(|s| {
        s.borrow()
            .iter()
            .rev()
            .find(|(n, _)| n.eq_ignore_ascii_case(name))
            .map(|(_, b)| b.clone())
    })
}

/// Whether any `LET`/lambda scope is open (cheap check for the evaluator).
pub(crate) fn scope_open() -> bool {
    SCOPE.with(|s| !s.borrow().is_empty())
}

/// Runs `f` with `bindings` pushed onto the scope.
pub(crate) fn with_bindings<R>(bindings: Vec<(String, Binding)>, f: impl FnOnce() -> R) -> R {
    let n = bindings.len();
    SCOPE.with(|s| s.borrow_mut().extend(bindings));
    let out = f();
    SCOPE.with(|s| {
        let mut s = s.borrow_mut();
        let len = s.len();
        s.truncate(len.saturating_sub(n));
    });
    out
}

/// The value of an operand as a function result.
pub(crate) fn operand_value(op: Operand, ctx: &EvalContext) -> Value {
    match op {
        Operand::Range(r) => range_value(r, ctx),
        Operand::Scalar(v) => v,
    }
}

/// A `LAMBDA(...)` call's parameters and body (`None` for an invalid
/// parameter list).
fn build(args: &[Expr]) -> Option<LambdaFn> {
    let (body, params) = args.split_last()?;
    let mut names: Vec<String> = Vec::with_capacity(params.len());
    for p in params {
        let Expr::Name(n) = p else {
            return None;
        };
        let n = strip_xlpm(n);
        if !is_valid_name(n) || names.iter().any(|m| m.eq_ignore_ascii_case(n)) {
            return None;
        }
        names.push(n.to_string());
    }
    Some(LambdaFn {
        params: names,
        body: body.clone(),
    })
}

/// A parameter name without the `_xlpm.` prefix files use.
pub fn strip_xlpm(name: &str) -> &str {
    name.get(..6)
        .filter(|p| p.eq_ignore_ascii_case("_xlpm."))
        .map_or(name, |_| &name[6..])
}

/// The lambda an expression stands for: a `LAMBDA(...)` call, a name
/// bound to one, or a defined name defined as one.
pub(crate) fn lambda_of(e: &Expr, ctx: &EvalContext) -> Option<Rc<LambdaFn>> {
    match e {
        Expr::Call { name, args } if name.eq_ignore_ascii_case("LAMBDA") => {
            build(args).map(Rc::new)
        }
        Expr::Name(n) => named_lambda(n, ctx),
        _ => None,
    }
}

/// The lambda called `name`: a `LET` name or lambda parameter bound to
/// one, else a defined name defined as `LAMBDA(...)`.
pub(crate) fn named_lambda(name: &str, ctx: &EvalContext) -> Option<Rc<LambdaFn>> {
    match lookup(name) {
        Some(Binding::Lambda(l)) => return Some(l),
        Some(_) => return None,
        None => {}
    }
    match ctx.provider.defined_name(name, ctx.current.sheet)? {
        Expr::Call { name, args } if name.eq_ignore_ascii_case("LAMBDA") => {
            build(args).map(Rc::new)
        }
        _ => None,
    }
}

/// How an argument expression binds to a parameter.
pub(crate) fn bind_arg(e: &Expr, ctx: &EvalContext) -> Binding {
    if matches!(e, Expr::Missing) {
        return Binding::Omitted;
    }
    if let Some(l) = lambda_of(e, ctx) {
        return Binding::Lambda(l);
    }
    Binding::Value(eval_array(e, ctx))
}

/// Calls `f` with already bound arguments (fewer than its parameters:
/// the rest are omitted; more: `#VALUE!`).
pub(crate) fn call_bound(f: &LambdaFn, args: Vec<Binding>, ctx: &EvalContext) -> Value {
    if args.len() > f.params.len() {
        return Value::Error(ErrorKind::Value);
    }
    let depth = DEPTH.with(Cell::get);
    if depth >= MAX_LAMBDA_DEPTH {
        return Value::Error(ErrorKind::Num);
    }
    let mut bindings: Vec<(String, Binding)> = f.params.iter().cloned().zip(args).collect();
    for p in f.params.iter().skip(bindings.len()) {
        bindings.push((p.clone(), Binding::Omitted));
    }
    DEPTH.with(|d| d.set(depth + 1));
    let out = with_bindings(bindings, || {
        if lambda_of(&f.body, ctx).is_some() {
            // A lambda result cannot be a value.
            return Value::Error(ErrorKind::Calc);
        }
        operand_value(eval_array(&f.body, ctx), ctx)
    });
    DEPTH.with(|d| d.set(depth));
    out
}

/// Calls `f` with argument expressions (evaluated in the caller's scope).
pub(crate) fn invoke(f: &LambdaFn, args: &[Expr], ctx: &EvalContext) -> Value {
    let bound = args.iter().map(|a| bind_arg(a, ctx)).collect();
    call_bound(f, bound, ctx)
}

/// Calls `f` with values.
pub(crate) fn call_values(f: &LambdaFn, values: Vec<Value>, ctx: &EvalContext) -> Value {
    call_bound(
        f,
        values
            .into_iter()
            .map(|v| Binding::Value(Operand::Scalar(v)))
            .collect(),
        ctx,
    )
}
