//! Financial functions (annuities, depreciation, rates of return).
//!
//! Sign convention as in Excel: money paid out is negative.

use super::FunctionRegistry;

pub mod db;
pub mod ddb;
pub mod effect;
pub mod fv;
pub mod ipmt;
pub mod irr;
pub mod mirr;
pub mod nper;
pub mod npv;
pub mod pmt;
pub mod ppmt;
pub mod pv;
pub mod rate;
pub mod sln;
pub mod syd;
#[cfg(test)]
mod tests;

/// Registers every function of this family.
pub fn register(r: &mut FunctionRegistry) {
    r.register(Box::new(pmt::Pmt));
    r.register(Box::new(ipmt::IPmt));
    r.register(Box::new(ppmt::PPmt));
    r.register(Box::new(fv::Fv));
    r.register(Box::new(pv::Pv));
    r.register(Box::new(npv::Npv));
    r.register(Box::new(irr::Irr));
    r.register(Box::new(rate::Rate));
    r.register(Box::new(nper::NPer));
    r.register(Box::new(sln::Sln));
    r.register(Box::new(syd::Syd));
    r.register(Box::new(db::Db));
    r.register(Box::new(ddb::Ddb));
    r.register(Box::new(effect::Effect));
    r.register(Box::new(effect::Nominal));
    r.register(Box::new(mirr::Mirr));
}

/// Payment per period of an annuity; `typ` 1 = payments at period start.
pub(crate) fn pmt(rate: f64, nper: f64, pv: f64, fv: f64, typ: f64) -> f64 {
    if rate == 0.0 {
        return -(pv + fv) / nper;
    }
    let p = (1.0 + rate).powf(nper);
    -(fv + pv * p) * rate / ((1.0 + rate * typ) * (p - 1.0))
}

/// Future value of an annuity.
pub(crate) fn fv(rate: f64, nper: f64, pmt: f64, pv: f64, typ: f64) -> f64 {
    if rate == 0.0 {
        return -(pv + pmt * nper);
    }
    let p = (1.0 + rate).powf(nper);
    -(pv * p + pmt * (1.0 + rate * typ) * (p - 1.0) / rate)
}

/// Net present value of `values` discounted from period 1.
pub(crate) fn npv(rate: f64, values: &[f64]) -> f64 {
    values
        .iter()
        .enumerate()
        .map(|(i, v)| v / (1.0 + rate).powi(i as i32 + 1))
        .sum()
}

/// `type` argument: any non-zero value means payments at period start.
pub(crate) fn typ(x: f64) -> f64 {
    if x != 0.0 {
        1.0
    } else {
        0.0
    }
}
