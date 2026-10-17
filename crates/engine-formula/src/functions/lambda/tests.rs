use crate::ast::ErrorKind;
use crate::functions::test_support::{eval, eval_cell, num};
use crate::value::{Array, Value};

fn n(x: f64) -> Value {
    Value::Number(x)
}

fn col(v: &[f64]) -> Value {
    Value::Array(Array::from_rows(v.iter().map(|&x| vec![n(x)]).collect()).unwrap())
}

fn row(v: &[f64]) -> Value {
    Value::Array(Array::from_rows(vec![v.iter().map(|&x| n(x)).collect()]).unwrap())
}

// Fixture: A1:A3 = 1, "x", 3; B1 = TRUE; B2 = "5"; C1 = #DIV/0!; C2 = #N/A.

#[test]
fn let_binds_values_and_ranges() {
    assert_eq!(num("=LET(x,2,x*3)"), 6.0);
    assert_eq!(num("=LET(x,2,y,x+1,x*y)"), 6.0);
    assert_eq!(num("=LET(rng,A1:A3,SUM(rng)*2)"), 8.0);
    assert_eq!(num("=LET(rng,A1:A3,ROWS(rng))"), 3.0);
    // `r` and `c` are not valid names (R1C1 style).
    assert_eq!(eval("=LET(r,1,r)"), Value::Error(ErrorKind::Value));
    assert_eq!(eval_cell("=LET(x,{1;2;3},x*2)"), col(&[2.0, 4.0, 6.0]));
    // Inner names shadow outer ones; names are case-insensitive.
    assert_eq!(num("=LET(x,1,LET(x,5,X)+x)"), 6.0);
    assert_eq!(eval("=LET(x,1,y)"), Value::Error(ErrorKind::Name));
    assert_eq!(eval("=LET(x,1,y,2)"), Value::Error(ErrorKind::Value));
    assert_eq!(eval("=LET(A1,1,A1)"), Value::Error(ErrorKind::Value));
    assert_eq!(num("=LET(_xlpm.x,4,_xlpm.x+x)"), 8.0);
}

#[test]
fn lambdas_are_called() {
    assert_eq!(num("=LAMBDA(x,x+1)(2)"), 3.0);
    assert_eq!(num("=LAMBDA(x,y,x*y)(3,4)"), 12.0);
    assert_eq!(num("=LET(f,LAMBDA(x,x*2),f(5)+f(1))"), 12.0);
    assert_eq!(num("=LET(a,10,f,LAMBDA(x,x+a),f(1))"), 11.0);
    assert_eq!(eval("=LAMBDA(x,x)"), Value::Error(ErrorKind::Calc));
    assert_eq!(eval("=LAMBDA(x,x)(1,2)"), Value::Error(ErrorKind::Value));
    assert_eq!(eval("=LAMBDA(x,x,x)(1)"), Value::Error(ErrorKind::Value));
    assert_eq!(
        crate::parse("=LAMBDA(x,x+1)(2)").unwrap().to_string(),
        "LAMBDA(x,x+1)(2)"
    );
    // Omitted parameters.
    assert_eq!(num("=LAMBDA(x,y,IF(ISOMITTED(y),x,x+y))(4)"), 4.0);
    assert_eq!(num("=LAMBDA(x,y,IF(ISOMITTED(y),x,x+y))(4,1)"), 5.0);
    assert_eq!(eval("=ISOMITTED(A1)"), Value::Bool(false));
}

#[test]
fn helper_functions() {
    assert_eq!(
        eval_cell("=MAP({1;2;3},LAMBDA(v,v*10))"),
        col(&[10.0, 20.0, 30.0])
    );
    assert_eq!(
        eval_cell("=MAP({1,2},{3,4},LAMBDA(a,b,a+b))"),
        row(&[4.0, 6.0])
    );
    assert_eq!(
        eval("=MAP({1,2},{3;4},LAMBDA(a,b,a+b))"),
        Value::Error(ErrorKind::Value)
    );
    assert_eq!(num("=REDUCE(0,{1,2,3,4},LAMBDA(a,v,a+v))"), 10.0);
    assert_eq!(num("=REDUCE(1,{1,2,3,4},LAMBDA(a,v,a*v))"), 24.0);
    assert_eq!(
        eval_cell("=REDUCE(,{1;2},LAMBDA(a,v,IF(ISBLANK(a),v,VSTACK(a,v*3))))"),
        col(&[1.0, 6.0])
    );
    assert_eq!(
        eval_cell("=SCAN(0,{1,2,3},LAMBDA(a,v,a+v))"),
        row(&[1.0, 3.0, 6.0])
    );
    assert_eq!(
        eval_cell("=BYROW({1,2;3,4},LAMBDA(rw,SUM(rw)))"),
        col(&[3.0, 7.0])
    );
    assert_eq!(
        eval_cell("=BYCOL({1,2;3,4},LAMBDA(cl,MAX(cl)))"),
        row(&[3.0, 4.0])
    );
    assert_eq!(
        eval("=BYROW({1,2;3,4},LAMBDA(rw,rw))"),
        Value::Error(ErrorKind::Calc)
    );
    assert_eq!(
        eval_cell("=MAKEARRAY(2,2,LAMBDA(i,j,i*10+j))"),
        Value::Array(
            Array::from_rows(vec![vec![n(11.0), n(12.0)], vec![n(21.0), n(22.0)]]).unwrap()
        )
    );
    assert_eq!(
        eval("=MAKEARRAY(0,2,LAMBDA(i,j,1))"),
        Value::Error(ErrorKind::Value)
    );
    assert_eq!(eval("=MAP({1,2},5)"), Value::Error(ErrorKind::Value));
}

#[test]
fn recursion_is_limited() {
    // A lambda calling itself through LET is not possible (the name is not
    // bound yet inside its own value); deep nesting through helpers is.
    assert_eq!(
        num("=LET(f,LAMBDA(x,x+1),g,LAMBDA(x,f(f(x))),g(g(1)))"),
        5.0
    );
}
