//! Opens an OPC package and writes it back: `rewrite <in> <out>`.

use std::process::ExitCode;

use fmt_ooxml::Package;

fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let [input, output] = args.as_slice() else {
        eprintln!("usage: rewrite <in> <out>");
        return ExitCode::from(2);
    };
    match Package::open_path(input).and_then(|pkg| pkg.write_path(output)) {
        Ok(()) => ExitCode::SUCCESS,
        Err(e) => {
            eprintln!("rewrite: {input}: {e}");
            ExitCode::FAILURE
        }
    }
}
