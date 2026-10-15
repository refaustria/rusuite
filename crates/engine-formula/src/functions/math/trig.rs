//! Trigonometric functions: `SIN COS TAN ASIN ACOS ATAN ATAN2 SINH COSH
//! TANH DEGREES RADIANS`.
use crate::ast::ErrorKind;

num1!(
    /// Sine (radians).
    Sin, "SIN", |x| Ok(x.sin()));
num1!(
    /// Cosine (radians).
    Cos, "COS", |x| Ok(x.cos()));
num1!(
    /// Tangent (radians).
    Tan, "TAN", |x| Ok(x.tan()));
num1!(
    /// Arcsine; `|x| > 1` is `#NUM!`.
    Asin, "ASIN", |x| if x.abs() > 1.0 { Err(ErrorKind::Num) } else { Ok(x.asin()) });
num1!(
    /// Arccosine; `|x| > 1` is `#NUM!`.
    Acos, "ACOS", |x| if x.abs() > 1.0 { Err(ErrorKind::Num) } else { Ok(x.acos()) });
num1!(
    /// Arctangent.
    Atan, "ATAN", |x| Ok(x.atan()));
num2!(
    /// Arctangent of `y / x` from `x_num, y_num`; both 0 is `#DIV/0!`.
    Atan2, "ATAN2", |x, y| if x == 0.0 && y == 0.0 { Err(ErrorKind::Div0) } else { Ok(y.atan2(x)) });
num1!(
    /// Hyperbolic sine.
    Sinh, "SINH", |x| Ok(x.sinh()));
num1!(
    /// Hyperbolic cosine.
    Cosh, "COSH", |x| Ok(x.cosh()));
num1!(
    /// Hyperbolic tangent.
    Tanh, "TANH", |x| Ok(x.tanh()));
num1!(
    /// Radians to degrees.
    Degrees, "DEGREES", |x| Ok(x.to_degrees()));
num1!(
    /// Degrees to radians.
    Radians, "RADIANS", |x| Ok(x.to_radians()));
