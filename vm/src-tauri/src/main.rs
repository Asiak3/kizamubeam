// No extra console window on Windows
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod headless;

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    if args.iter().any(|a| a == "--headless" || a == "--help" || a == "-h") {
        std::process::exit(headless::run(&args));
    }
    kizamubeam_vm_lib::run()
}
