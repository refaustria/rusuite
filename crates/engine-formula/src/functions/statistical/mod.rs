//! Statistical functions.

use super::FunctionRegistry;

pub mod correl;
pub mod large;
pub mod means;
pub mod median;
pub mod mode;
pub mod percentile;
pub mod percentrank;
pub mod quartile;
pub mod rank;
pub mod regression;
pub mod stdev;
#[cfg(test)]
mod tests;
pub mod trend;
pub mod var;

/// Registers every function of this family.
pub fn register(r: &mut FunctionRegistry) {
    r.register(Box::new(median::Median));
    r.register(Box::new(mode::Mode));
    r.register(Box::new(mode::ModeSngl));
    r.register(Box::new(var::Var));
    r.register(Box::new(var::VarS));
    r.register(Box::new(var::VarP));
    r.register(Box::new(var::VarPLegacy));
    r.register(Box::new(stdev::Stdev));
    r.register(Box::new(stdev::StdevS));
    r.register(Box::new(stdev::StdevP));
    r.register(Box::new(stdev::StdevPLegacy));
    r.register(Box::new(large::Large));
    r.register(Box::new(large::Small));
    r.register(Box::new(rank::Rank));
    r.register(Box::new(rank::RankEq));
    r.register(Box::new(rank::RankAvg));
    r.register(Box::new(percentile::Percentile));
    r.register(Box::new(percentile::PercentileInc));
    r.register(Box::new(percentile::PercentileExc));
    r.register(Box::new(quartile::Quartile));
    r.register(Box::new(quartile::QuartileInc));
    r.register(Box::new(quartile::QuartileExc));
    r.register(Box::new(percentrank::PercentRank));
    r.register(Box::new(percentrank::PercentRankInc));
    r.register(Box::new(correl::Correl));
    r.register(Box::new(correl::Covar));
    r.register(Box::new(correl::CovarianceP));
    r.register(Box::new(correl::CovarianceS));
    r.register(Box::new(regression::Slope));
    r.register(Box::new(regression::Intercept));
    r.register(Box::new(regression::Rsq));
    r.register(Box::new(regression::Forecast));
    r.register(Box::new(regression::ForecastLinear));
    r.register(Box::new(trend::Trend));
    r.register(Box::new(means::GeoMean));
    r.register(Box::new(means::HarMean));
    r.register(Box::new(means::DevSq));
    r.register(Box::new(means::AveDev));
}

/// Sorted copy (ascending).
pub(crate) fn sorted(v: &[f64]) -> Vec<f64> {
    let mut s = v.to_vec();
    s.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
    s
}

/// Mean of a non-empty slice.
pub(crate) fn mean(v: &[f64]) -> f64 {
    v.iter().sum::<f64>() / v.len() as f64
}

/// Sum of squared deviations from the mean.
pub(crate) fn sum_sq_dev(v: &[f64]) -> f64 {
    let m = mean(v);
    v.iter().map(|x| (x - m) * (x - m)).sum()
}

/// Percentile of an ascending slice by linear interpolation at the
/// 0-based position `pos` (clamped to the slice).
pub(crate) fn interpolate(sorted: &[f64], pos: f64) -> f64 {
    let n = sorted.len();
    let lo = pos.floor().clamp(0.0, (n - 1) as f64) as usize;
    let hi = (lo + 1).min(n - 1);
    let frac = pos - lo as f64;
    sorted[lo] + (sorted[hi] - sorted[lo]) * frac
}
