//! Reads an `.xlsx` into the model and writes it back.
//!
//! ```text
//! cargo run -q -p fmt-xlsx --example rewrite -- in.xlsx out.xlsx
//! ```
//!
//! Warnings about dropped content go to stderr. Used by
//! `scripts/roundtrip.sh` via `RUSUITE_REWRITE`.

use std::process::ExitCode;

fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let [input, output] = args.as_slice() else {
        eprintln!("usage: rewrite <in.xlsx> <out.xlsx>");
        return ExitCode::from(2);
    };
    match run(input, output) {
        Ok(()) => ExitCode::SUCCESS,
        Err(e) => {
            eprintln!("rewrite failed: {e}");
            ExitCode::FAILURE
        }
    }
}

fn run(input: &str, output: &str) -> fmt_xlsx::Result<()> {
    let loaded = fmt_xlsx::read_with_context(&std::fs::read(input)?)?;
    for w in &loaded.warnings {
        eprintln!("warning: {w}");
    }
    let bytes = fmt_xlsx::write_with_context(&loaded.workbook, &loaded.context)?;
    std::fs::write(output, bytes)?;
    Ok(())
}
