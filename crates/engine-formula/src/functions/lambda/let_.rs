//! `LET(name1, value1, [name2, value2, ...], calculation)`,
//! `LAMBDA([parameter1, ...], calculation)` and `ISOMITTED(argument)`.

use crate::ast::{is_valid_name, ErrorKind, Expr};
use crate::eval::eval_array;
use crate::functions::lambda::{
    bind_arg, lambda_of, lookup, operand_value, strip_xlpm, with_bindings, Binding,
};
use crate::functions::{Arity, CallContext, Function};
use crate::value::Value;

/// Binds names to values, then evaluates the calculation with them. Each
/// value may use the names before it. A name must be a valid name (not a
/// cell reference); an even argument count is `#VALUE!`.
pub struct Let;

impl Function for Let {
    fn name(&self) -> &'static str {
        "LET"
    }

    fn arity(&self) -> Arity {
        Arity::range(3, 253)
    }

    fn call(&self, args: &[Expr], ctx: &mut CallContext) -> Value {
        if args.len() % 2 == 0 {
            return Value::Error(ErrorKind::Value);
        }
        let ectx = *ctx.eval_context();
        let (calc, pairs) = args.split_last().expect("at least three arguments");
        // Bind one pair at a time so later values see earlier names.
        fn bind_from(pairs: &[Expr], calc: &Expr, ectx: &crate::eval::EvalContext) -> Value {
            let Some((pair, rest)) = pairs.split_first_chunk::<2>() else {
                if lambda_of(calc, ectx).is_some() {
                    return Value::Error(ErrorKind::Calc);
                }
                return operand_value(eval_array(calc, ectx), ectx);
            };
            let Expr::Name(name) = &pair[0] else {
                return Value::Error(ErrorKind::Value);
            };
            let name = strip_xlpm(name);
            if !is_valid_name(name) {
                return Value::Error(ErrorKind::Value);
            }
            let binding = bind_arg(&pair[1], ectx);
            with_bindings(vec![(name.to_string(), binding)], || {
                bind_from(rest, calc, ectx)
            })
        }
        bind_from(pairs, calc, &ectx)
    }
}

/// A lambda as a value is `#CALC!` (call it: `LAMBDA(x,x+1)(2)`).
pub struct Lambda;

impl Function for Lambda {
    fn name(&self) -> &'static str {
        "LAMBDA"
    }

    fn arity(&self) -> Arity {
        Arity::range(1, 254)
    }

    fn call(&self, args: &[Expr], ctx: &mut CallContext) -> Value {
        match lambda_of(
            &Expr::Call {
                name: "LAMBDA".into(),
                args: args.to_vec(),
            },
            ctx.eval_context(),
        ) {
            Some(_) => Value::Error(ErrorKind::Calc),
            None => Value::Error(ErrorKind::Value),
        }
    }
}

/// Whether a lambda parameter was left out by the caller.
pub struct IsOmitted;

impl Function for IsOmitted {
    fn name(&self) -> &'static str {
        "ISOMITTED"
    }

    fn arity(&self) -> Arity {
        Arity::exact(1)
    }

    fn call(&self, args: &[Expr], _ctx: &mut CallContext) -> Value {
        Value::Bool(match &args[0] {
            Expr::Name(n) => matches!(lookup(strip_xlpm(n)), Some(Binding::Omitted)),
            Expr::Missing => true,
            _ => false,
        })
    }
}
