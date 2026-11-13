//! Every scripted scenario in `scenarios/` must pass.

use matchmaking::scenario::{load_dir, run};

#[test]
fn all_scripted_scenarios_pass() {
    let dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("scenarios");
    let scenarios = load_dir(&dir).expect("scenarios load");
    assert!(!scenarios.is_empty());
    let mut failures = Vec::new();
    for (file, scenario) in &scenarios {
        let report = run(scenario);
        for step in &report.steps {
            if let Some(Err(why)) = &step.check {
                failures.push(format!("{file}: {} -> {why}", step.text));
            }
        }
    }
    assert!(failures.is_empty(), "\n{}", failures.join("\n"));
}
