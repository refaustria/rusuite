//! Reads a `.docx` into the model and writes it back.
//!
//! ```text
//! cargo run -q -p fmt-docx --example rewrite -- in.docx out.docx
//! ```
//!
//! Warnings about dropped content go to stderr. Used by
//! `scripts/roundtrip.sh` via `RUSUITE_REWRITE`.

use std::process::ExitCode;

fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let [input, output] = args.as_slice() else {
        eprintln!("usage: rewrite <in.docx> <out.docx>");
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

fn run(input: &str, output: &str) -> fmt_docx::Result<()> {
    let loaded = fmt_docx::read_with_context(&std::fs::read(input)?)?;
    for w in &loaded.warnings {
        eprintln!("warning: {w}");
    }
    let bytes = fmt_docx::write_with_context(&loaded.document, &loaded.context)?;
    std::fs::write(output, bytes)?;
    Ok(())
}
