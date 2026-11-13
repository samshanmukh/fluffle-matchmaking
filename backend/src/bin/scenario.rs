//! Runs scripted scenarios against the engine and prints what happened.
//!
//!     cargo run --bin scenario                 # every file in scenarios/
//!     cargo run --bin scenario -- path/to/file.json

use std::path::Path;

use matchmaking::scenario::{Scenario, load_dir, load_file, run};

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let targets = if args.is_empty() { vec!["scenarios".to_string()] } else { args };

    let mut scenarios: Vec<(String, Scenario)> = Vec::new();
    for target in &targets {
        let path = Path::new(target);
        let loaded = if path.is_dir() { load_dir(path) } else { load_file(path).map(|s| vec![(target.clone(), s)]) };
        match loaded {
            Ok(list) => scenarios.extend(list),
            Err(e) => {
                eprintln!("{e}");
                std::process::exit(2);
            }
        }
    }

    let mut failed = 0;
    for (file, scenario) in &scenarios {
        let report = run(scenario);
        println!("\n{}  ({file})", report.name);
        if !report.description.is_empty() {
            println!("  {}", report.description);
        }
        for step in &report.steps {
            let time = format!("{:>7.1}s", step.at as f64 / 1000.0);
            match &step.check {
                None => println!("  {time}  {}", step.text),
                Some(Ok(())) => println!("  {time}  ✓ {}", step.text),
                Some(Err(why)) => println!("  {time}  ✗ {}: {why}", step.text),
            }
        }
        if !report.passed() {
            failed += 1;
        }
    }
    println!("\n{} scenario(s), {} failed", scenarios.len(), failed);
    if failed > 0 {
        std::process::exit(1);
    }
}
