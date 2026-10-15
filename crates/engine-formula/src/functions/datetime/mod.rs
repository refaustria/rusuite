//! Date and time functions (1900 date system with the Lotus leap-year bug).

pub(crate) mod calendar;
pub mod date;
pub mod datedif;
pub mod datevalue;
pub mod day;
pub mod days;
pub mod edate;
pub mod hour;
pub mod month;
pub mod networkdays;
pub mod now;
pub mod serial;
#[cfg(test)]
mod tests;
pub mod time;
pub mod timevalue;
pub mod today;
pub mod weekday;
pub mod weeknum;
pub mod year;
pub mod yearfrac;

use super::FunctionRegistry;

/// Registers every function of this family.
pub fn register(r: &mut FunctionRegistry) {
    r.register(Box::new(today::Today));
    r.register(Box::new(now::Now));
    r.register(Box::new(date::Date));
    r.register(Box::new(year::Year));
    r.register(Box::new(month::Month));
    r.register(Box::new(day::Day));
    r.register(Box::new(weekday::Weekday));
    r.register(Box::new(days::Days));
    r.register(Box::new(datevalue::DateValue));
    r.register(Box::new(timevalue::TimeValue));
    r.register(Box::new(time::Time));
    r.register(Box::new(hour::Hour));
    r.register(Box::new(hour::Minute));
    r.register(Box::new(hour::Second));
    r.register(Box::new(edate::EDate));
    r.register(Box::new(edate::EoMonth));
    r.register(Box::new(networkdays::NetworkDays));
    r.register(Box::new(networkdays::NetworkDaysIntl));
    r.register(Box::new(networkdays::WorkDay));
    r.register(Box::new(networkdays::WorkDayIntl));
    r.register(Box::new(datedif::DateDif));
    r.register(Box::new(yearfrac::YearFrac));
    r.register(Box::new(weeknum::WeekNum));
    r.register(Box::new(weeknum::IsoWeekNum));
}
