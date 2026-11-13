//! A scripted scenario runner: a JSON file lists who does what and when, and
//! what should be true afterwards. Scenarios drive the real engine with a
//! scripted clock, so they are exact and repeatable.

use serde::Deserialize;
use serde_json::Value;

use crate::engine::{Answer, Config, Engine, Event, EventKind, Ms, PartnerRequest, Phase};

#[derive(Deserialize)]
pub struct Scenario {
    pub name: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub partner_requests: Vec<PartnerRequest>,
    pub steps: Vec<Step>,
}

#[derive(Deserialize)]
pub struct Step {
    /// Move the clock to this many milliseconds before the step (never backwards).
    #[serde(default)]
    pub at: Option<Ms>,
    #[serde(flatten)]
    pub action: Action,
}

#[derive(Deserialize)]
#[serde(tag = "do", rename_all = "snake_case")]
pub enum Action {
    Join {
        user: String,
        languages: Vec<String>,
        #[serde(default)]
        topic: Option<String>,
    },
    Leave { user: String },
    Ready { user: String },
    Decline {
        user: String,
        #[serde(default)]
        never_again: bool,
    },
    EndCall { user: String },
    Block { user: String, other: String },
    /// Run one pairing pass at the current time.
    Tick,
    /// The last command offered these two to each other.
    ExpectOffer {
        users: [String; 2],
        #[serde(default)]
        languages: Option<Vec<String>>,
        /// The agreed topic, or "none" for a call with no agreed topic.
        #[serde(default)]
        topic: Option<String>,
    },
    /// The last command made no offers at all.
    ExpectNoOffers,
    /// idle, waiting, offered or in_call.
    ExpectPhase { user: String, phase: String },
    /// The last command sent this user an event of this type (and reason, if given).
    ExpectEvent {
        user: String,
        event: String,
        #[serde(default)]
        reason: Option<String>,
    },
}

pub struct StepResult {
    pub at: Ms,
    pub text: String,
    /// `None` for commands; `Some(Ok)`/`Some(Err)` for expectations.
    pub check: Option<Result<(), String>>,
}

pub struct Report {
    pub name: String,
    pub description: String,
    pub steps: Vec<StepResult>,
}

impl Report {
    pub fn passed(&self) -> bool {
        self.steps.iter().all(|s| !matches!(s.check, Some(Err(_))))
    }
}

fn phase_name(p: Phase) -> &'static str {
    match p {
        Phase::Idle => "idle",
        Phase::Waiting => "waiting",
        Phase::Offered { .. } => "offered",
        Phase::InCall { .. } => "in_call",
    }
}

fn respond(e: &mut Engine, user: &str, answer: Answer, never_again: bool, now: Ms) -> Result<Vec<Event>, String> {
    match e.phase(user) {
        Phase::Offered { match_id } => e.respond(user, match_id, answer, never_again, now).map_err(|err| err.to_string()),
        other => Err(format!("{user} has no open offer (they are {})", phase_name(other))),
    }
}

pub fn run(scenario: &Scenario) -> Report {
    let mut engine = Engine::new(Config::default(), &scenario.partner_requests);
    let mut now: Ms = 0;
    let mut last: Vec<Event> = Vec::new();
    let mut steps = Vec::new();

    for step in &scenario.steps {
        if let Some(at) = step.at {
            now = now.max(at);
        }
        let command = |text: String, result: Result<Vec<Event>, String>, last: &mut Vec<Event>| match result {
            Ok(events) => {
                *last = events;
                StepResult { at: now, text, check: None }
            }
            Err(e) => StepResult { at: now, text, check: Some(Err(e)) },
        };
        let result = match &step.action {
            Action::Join { user, languages, topic } => {
                let what = match topic {
                    Some(t) => format!("{user} joins with {} and topic {t}", languages.join(" + ")),
                    None => format!("{user} joins with {}", languages.join(" + ")),
                };
                let r = engine.join(user, languages, topic.as_deref(), now).map(|_| Vec::new()).map_err(|e| e.to_string());
                command(what, r, &mut last)
            }
            Action::Leave { user } => command(format!("{user} leaves"), Ok(engine.leave(user, now)), &mut last),
            Action::Ready { user } => {
                let r = respond(&mut engine, user, Answer::Ready, false, now);
                command(format!("{user} says ready"), r, &mut last)
            }
            Action::Decline { user, never_again } => {
                let r = respond(&mut engine, user, Answer::Decline, *never_again, now);
                let what = if *never_again { format!("{user} declines: don't match me again") } else { format!("{user} declines") };
                command(what, r, &mut last)
            }
            Action::EndCall { user } => {
                let r = engine.end_call(user, now).map_err(|e| e.to_string());
                command(format!("{user} ends the call"), r, &mut last)
            }
            Action::Block { user, other } => {
                let r = engine.block(user, other, now).map_err(|e| e.to_string());
                command(format!("{user} blocks {other}"), r, &mut last)
            }
            Action::Tick => command("pairing pass".to_string(), Ok(engine.tick(now)), &mut last),

            Action::ExpectOffer { users, languages, topic } => {
                let found = last.iter().find_map(|ev| match &ev.kind {
                    EventKind::Offer { partner, languages, topic, .. } if ev.user == users[0] && partner == &users[1] => {
                        Some((languages.clone(), topic.clone()))
                    }
                    _ => None,
                });
                let check = match found {
                    None => Err(format!("no offer between {} and {}", users[0], users[1])),
                    Some((got_langs, got_topic)) => {
                        let mut want_langs = languages.clone();
                        if let Some(l) = want_langs.as_mut() {
                            l.sort();
                        }
                        if want_langs.as_ref().is_some_and(|l| l != &got_langs) {
                            Err(format!("call languages were {got_langs:?}"))
                        } else {
                            match topic.as_deref() {
                                None => Ok(()),
                                Some("none") if got_topic.is_none() => Ok(()),
                                Some(t) if got_topic.as_deref() == Some(t) => Ok(()),
                                Some(_) => Err(format!("agreed topic was {got_topic:?}")),
                            }
                        }
                    }
                };
                let mut text = format!("expect an offer between {} and {}", users[0], users[1]);
                if let Some(l) = languages {
                    text += &format!(" in {}", l.join(" + "));
                }
                if let Some(t) = topic {
                    text += &format!(", topic {t}");
                }
                StepResult { at: now, text, check: Some(check) }
            }
            Action::ExpectNoOffers => {
                let offered: Vec<&str> =
                    last.iter().filter(|ev| matches!(ev.kind, EventKind::Offer { .. })).map(|ev| ev.user.as_str()).collect();
                let check = if offered.is_empty() { Ok(()) } else { Err(format!("offers went to {offered:?}")) };
                StepResult { at: now, text: "expect no offers".to_string(), check: Some(check) }
            }
            Action::ExpectPhase { user, phase } => {
                let got = phase_name(engine.phase(user));
                let check = if got == phase { Ok(()) } else { Err(format!("{user} is {got}")) };
                StepResult { at: now, text: format!("expect {user} to be {phase}"), check: Some(check) }
            }
            Action::ExpectEvent { user, event, reason } => {
                let hit = last.iter().filter(|ev| &ev.user == user).any(|ev| {
                    let v = serde_json::to_value(&ev.kind).unwrap_or(Value::Null);
                    v["type"] == event.as_str() && reason.as_ref().is_none_or(|r| v["reason"] == r.as_str())
                });
                let mut text = format!("expect {user} to be told \"{event}\"");
                if let Some(r) = reason {
                    text += &format!(" ({r})");
                }
                let check = if hit { Ok(()) } else { Err(format!("{user} was not told that")) };
                StepResult { at: now, text, check: Some(check) }
            }
        };
        steps.push(result);
        if let Err(problem) = engine.check_invariants() {
            steps.push(StepResult { at: now, text: "engine invariants".to_string(), check: Some(Err(problem)) });
        }
    }
    Report { name: scenario.name.clone(), description: scenario.description.clone(), steps }
}

/// Loads every `.json` scenario in a directory, sorted by file name.
pub fn load_dir(dir: &std::path::Path) -> Result<Vec<(String, Scenario)>, String> {
    let mut paths: Vec<_> = std::fs::read_dir(dir)
        .map_err(|e| format!("{}: {e}", dir.display()))?
        .filter_map(|entry| entry.ok().map(|e| e.path()))
        .filter(|p| p.extension().is_some_and(|x| x == "json"))
        .collect();
    paths.sort();
    paths.into_iter().map(|p| load_file(&p).map(|s| (p.display().to_string(), s))).collect()
}

pub fn load_file(path: &std::path::Path) -> Result<Scenario, String> {
    let text = std::fs::read_to_string(path).map_err(|e| format!("{}: {e}", path.display()))?;
    serde_json::from_str(&text).map_err(|e| format!("{}: {e}", path.display()))
}
