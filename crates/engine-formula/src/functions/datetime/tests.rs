//! Tests for the Phase 8 date and time functions.

use crate::ast::ErrorKind;
use crate::functions::test_support::{close, err};

#[test]
fn time_conversions() {
    close("=TIMEVALUE(\"12:00 AM\")", 0.0);
    close("=TIMEVALUE(\"12:30 PM\")", 12.5 / 24.0);
    close("=TIMEVALUE(\"11 PM\")", 23.0 / 24.0);
    assert_eq!(err("=TIMEVALUE(\"13:00 PM\")"), ErrorKind::Value);
    close("=TIME(0,0,86400+30)", 30.0 / 86_400.0);
    close("=HOUR(0.999999)", 0.0);
    close("=MINUTE(TIME(23,59,59.7))", 59.0);
    close("=DATEVALUE(\"2024-02-29\")", 45351.0);
}

#[test]
fn month_arithmetic() {
    close("=EDATE(DATE(2023,1,31),1)", 44985.0); // 2023-02-28
    close("=EDATE(DATE(2024,2,29),12)", 45716.0); // 2025-02-28
    close("=EDATE(DATE(2024,3,31),-1)", 45351.0); // 2024-02-29
    close("=EDATE(\"2024-01-15\",1.9)", 45337.0);
    close("=EOMONTH(DATE(2024,1,15),1)", 45351.0);
    close("=EOMONTH(DATE(2024,12,1),0)", 45657.0);
    assert_eq!(err("=EDATE(-1,1)"), ErrorKind::Num);
}

#[test]
fn working_days() {
    // 2024-01-01 is a Monday.
    close("=NETWORKDAYS(DATE(2024,1,1),DATE(2024,1,7))", 5.0);
    close("=NETWORKDAYS(DATE(2024,1,6),DATE(2024,1,7))", 0.0);
    close(
        "=NETWORKDAYS(DATE(2024,1,1),DATE(2024,1,7),{45293,45294})",
        3.0,
    );
    close(
        "=NETWORKDAYS.INTL(DATE(2024,1,1),DATE(2024,1,7),\"1000001\")",
        5.0,
    );
    close("=NETWORKDAYS.INTL(DATE(2024,1,1),DATE(2024,1,7),17)", 6.0);
    assert_eq!(err("=NETWORKDAYS.INTL(1,7,\"1111111\")"), ErrorKind::Value);
    assert_eq!(err("=NETWORKDAYS.INTL(1,7,\"abc\")"), ErrorKind::Value);
    close("=WORKDAY(DATE(2024,1,5),1)", 45299.0); // Friday -> Monday
    close("=WORKDAY(DATE(2024,1,8),-1)", 45296.0); // Monday -> Friday
    close("=WORKDAY(DATE(2024,1,1),2,45293)", 45295.0); // Tuesday is a holiday
    close("=WORKDAY.INTL(DATE(2024,1,5),1,\"0000011\")", 45299.0);
    close("=WORKDAY.INTL(DATE(2024,1,5),1,7)", 45298.0 + 0.0);
}

#[test]
fn date_differences() {
    close("=DATEDIF(DATE(2024,1,31),DATE(2024,2,29),\"M\")", 0.0);
    close("=DATEDIF(DATE(2024,1,31),DATE(2024,3,31),\"M\")", 2.0);
    close("=DATEDIF(DATE(2000,2,29),DATE(2024,2,28),\"Y\")", 23.0);
    close("=DATEDIF(DATE(2024,1,15),DATE(2024,1,15),\"D\")", 0.0);
    close("=DATEDIF(DATE(2023,12,20),DATE(2024,1,5),\"YM\")", 0.0);
    close("=DATEDIF(DATE(2023,12,20),DATE(2024,1,5),\"MD\")", 16.0);
    close("=DATEDIF(DATE(2024,3,10),DATE(2024,3,10),\"yd\")", 0.0);
}

#[test]
fn year_fractions() {
    close("=YEARFRAC(DATE(2024,1,31),DATE(2024,3,31))", 2.0 / 12.0);
    close("=YEARFRAC(DATE(2024,2,29),DATE(2025,2,28))", 1.0);
    close("=YEARFRAC(DATE(2023,6,1),DATE(2024,6,1),1)", 366.0 / 366.0);
    close(
        "=YEARFRAC(DATE(2024,1,1),DATE(2024,12,31),3)",
        365.0 / 365.0,
    );
    close("=YEARFRAC(DATE(2024,1,31),DATE(2024,2,29),4)", 29.0 / 360.0);
}

#[test]
fn week_numbers() {
    // 2021-01-01 is a Friday.
    close("=WEEKNUM(DATE(2021,1,1))", 1.0);
    close("=WEEKNUM(DATE(2021,1,3))", 2.0);
    close("=WEEKNUM(DATE(2021,1,4),2)", 2.0);
    close("=WEEKNUM(DATE(2021,1,1),21)", 53.0);
    close("=ISOWEEKNUM(DATE(2021,1,4))", 1.0);
    close("=ISOWEEKNUM(DATE(2026,12,31))", 53.0);
    close("=WEEKNUM(DATE(2024,12,31),11)", 53.0);
}
