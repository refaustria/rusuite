//! Lifting of scalar functions over arrays (Excel 365): an array (or a
//! multi-cell range) passed to an argument that takes a single value
//! makes the function evaluate once per element, and the call returns
//! the array of results (`=LEN(A1:A3)` spills three lengths). Arrays of
//! different sizes are combined like the operands of an operator: an
//! extent of 1 repeats, positions outside a shorter array are `#N/A`.
//!
//! [`lift_spec`] lists, per function, which arguments are lifted. The
//! evaluator applies it in array mode ([`crate::eval::eval_array`]).

use std::collections::HashMap;
use std::sync::LazyLock;

/// Which arguments of a function take one value (and are lifted).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Lift {
    /// Every argument.
    All,
    /// Only these (0-based) arguments.
    Only(&'static [usize]),
    /// Every argument from this index on.
    From(usize),
    /// Lazy functions (`IF`, `IFERROR`, `CHOOSE`): the first argument; when
    /// it is an array, every other argument as well.
    Selector,
}

impl Lift {
    /// Whether argument `i` is lifted (for [`Lift::Selector`]: the first).
    pub fn lifts(self, i: usize) -> bool {
        match self {
            Lift::All => true,
            Lift::Only(list) => list.contains(&i),
            Lift::From(k) => i >= k,
            Lift::Selector => i == 0,
        }
    }
}

const ALL: &[&str] = &[
    // Math and trigonometry.
    "ABS",
    "ACOS",
    "ASIN",
    "ATAN",
    "ATAN2",
    "CEILING",
    "CEILING.MATH",
    "COMBIN",
    "COS",
    "COSH",
    "DEGREES",
    "EVEN",
    "EXP",
    "FACT",
    "FACTDOUBLE",
    "FLOOR",
    "FLOOR.MATH",
    "INT",
    "LN",
    "LOG",
    "LOG10",
    "MOD",
    "MROUND",
    "ODD",
    "PERMUT",
    "POWER",
    "QUOTIENT",
    "RADIANS",
    "RANDBETWEEN",
    "ROUND",
    "ROUNDDOWN",
    "ROUNDUP",
    "SIGN",
    "SIN",
    "SINH",
    "SQRT",
    "SQRTPI",
    "TAN",
    "TANH",
    "TRUNC",
    "MUNIT",
    // Text.
    "CHAR",
    "CLEAN",
    "CODE",
    "CONCATENATE",
    "EXACT",
    "FIND",
    "FIXED",
    "LEFT",
    "LEN",
    "LOWER",
    "MID",
    "NUMBERVALUE",
    "PROPER",
    "REPLACE",
    "REPT",
    "RIGHT",
    "SEARCH",
    "SUBSTITUTE",
    "TEXT",
    "TRIM",
    "UNICHAR",
    "UNICODE",
    "UPPER",
    "VALUE",
    // Information.
    "ISBLANK",
    "ISERR",
    "ISERROR",
    "ISEVEN",
    "ISLOGICAL",
    "ISNA",
    "ISNONTEXT",
    "ISNUMBER",
    "ISODD",
    "ISTEXT",
    "N",
    "T",
    // Logical.
    "NOT",
    // Date and time.
    "DATE",
    "DATEDIF",
    "DATEVALUE",
    "DAY",
    "DAYS",
    "EDATE",
    "EOMONTH",
    "HOUR",
    "ISOWEEKNUM",
    "MINUTE",
    "MONTH",
    "SECOND",
    "TIME",
    "TIMEVALUE",
    "WEEKDAY",
    "WEEKNUM",
    "YEAR",
    "YEARFRAC",
    // Financial (scalar).
    "DB",
    "DDB",
    "EFFECT",
    "FV",
    "IPMT",
    "NOMINAL",
    "NPER",
    "PMT",
    "PPMT",
    "PV",
    "SLN",
    "SYD",
    // Lookup.
    "ADDRESS",
];

static SPECS: LazyLock<HashMap<&'static str, Lift>> = LazyLock::new(|| {
    let mut m: HashMap<&'static str, Lift> = ALL.iter().map(|&n| (n, Lift::All)).collect();
    for n in ["IF", "IFERROR", "IFNA", "CHOOSE"] {
        m.insert(n, Lift::Selector);
    }
    // The lookup value / criteria; the ranges keep their meaning.
    for n in ["VLOOKUP", "HLOOKUP", "MATCH", "XMATCH", "XLOOKUP", "LOOKUP"] {
        m.insert(n, Lift::Only(&[0]));
    }
    for n in ["COUNTIF", "SUMIF", "AVERAGEIF"] {
        m.insert(n, Lift::Only(&[1]));
    }
    m.insert("INDEX", Lift::Only(&[1, 2]));
    m.insert("LARGE", Lift::Only(&[1]));
    m.insert("SMALL", Lift::Only(&[1]));
    m.insert("PERCENTILE", Lift::Only(&[1]));
    m.insert("PERCENTILE.INC", Lift::Only(&[1]));
    m.insert("PERCENTILE.EXC", Lift::Only(&[1]));
    m.insert("QUARTILE", Lift::Only(&[1]));
    m.insert("QUARTILE.INC", Lift::Only(&[1]));
    m.insert("QUARTILE.EXC", Lift::Only(&[1]));
    m.insert("RANK", Lift::Only(&[0, 2]));
    m.insert("RANK.EQ", Lift::Only(&[0, 2]));
    m.insert("RANK.AVG", Lift::Only(&[0, 2]));
    m
});

/// The lifting rule of a function (`None`: not lifted; the function reads
/// arrays itself or takes ranges).
pub fn lift_spec(name: &str) -> Option<Lift> {
    if name.bytes().any(|b| b.is_ascii_lowercase()) {
        return SPECS.get(name.to_ascii_uppercase().as_str()).copied();
    }
    SPECS.get(name).copied()
}
