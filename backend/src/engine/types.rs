use serde::{Deserialize, Serialize};

/// Milliseconds on the engine's clock. The engine never reads a real clock:
/// every call is handed `now`, so tests control time exactly.
pub type Ms = u64;
pub type Uid = u32;
pub type LangId = u32;
pub type TopicId = u32;
pub type MatchId = u64;

#[derive(Clone, Debug)]
pub struct Config {
    /// How long someone may wait before being told and sent back to the start.
    pub wait_budget_ms: Ms,
    /// How long both people have to answer a match offer.
    pub offer_window_ms: Ms,
    /// After a call, the same two are not offered each other for this long.
    pub recent_partner_cooldown_ms: Ms,
    /// After a plain decline or an unanswered offer, likewise.
    pub decline_cooldown_ms: Ms,
    pub max_languages: usize,
    /// Wait samples older than this are ignored by the estimate.
    pub estimate_window_ms: Ms,
    /// Below this many samples the estimate is hidden.
    pub estimate_min_samples: usize,
    /// Samples kept per language.
    pub estimate_max_samples: usize,
}

impl Default for Config {
    fn default() -> Self {
        Self {
            wait_budget_ms: 10 * 60 * 1000,
            offer_window_ms: 15 * 1000,
            recent_partner_cooldown_ms: 5 * 60 * 1000,
            decline_cooldown_ms: 2 * 60 * 1000,
            max_languages: 5,
            estimate_window_ms: 30 * 60 * 1000,
            estimate_min_samples: 3,
            estimate_max_samples: 50,
        }
    }
}

/// One partner request: a language set and, optionally, a topic.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct PartnerRequest {
    pub languages: Vec<String>,
    #[serde(default)]
    pub topic: Option<String>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Answer {
    Ready,
    Decline,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Bucket {
    UnderAMinute,
    AFewMinutes,
    OverFiveMinutes,
    /// Not enough recent data: the app hides the estimate and says so.
    Unknown,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Estimate {
    pub bucket: Bucket,
    /// Recent matches the bucket is based on (0 when it comes from who is waiting now).
    pub sample_size: usize,
    /// Someone who shares a language is waiting right now.
    pub someone_waiting: bool,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum LeftReason {
    /// The user cancelled (or disconnected) while waiting.
    Cancelled,
    /// The user declined an offer.
    Declined,
    /// The user did not answer an offer in time.
    OfferTimeout,
    /// The user waited the whole budget without a match.
    WaitTimeout,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RequeueReason {
    PartnerDeclined,
    PartnerTimedOut,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CallEndReason {
    YouEnded,
    PartnerLeft,
}

/// Something the engine wants a user to be told.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Event {
    pub user: String,
    pub kind: EventKind,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum EventKind {
    /// Both people get this at the same moment.
    Offer { match_id: MatchId, partner: String, languages: Vec<String>, topic: Option<String>, expires_in_ms: Ms },
    CallStarted { match_id: MatchId, partner: String, languages: Vec<String>, topic: Option<String> },
    /// Back in the queue with seniority kept and a fresh wait budget.
    Requeued { reason: RequeueReason, wait_budget_ms: Ms },
    /// Out of the queue; the app returns to the start screen.
    Left { reason: LeftReason },
    CallEnded { match_id: MatchId, reason: CallEndReason },
    /// The wait estimate changed while waiting.
    Estimate { estimate: Estimate },
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(tag = "code", rename_all = "snake_case")]
pub enum EngineError {
    NoLanguages,
    TooManyLanguages { max: usize },
    /// One place in the queue at a time.
    AlreadyActive,
    NoSuchOffer,
    NotInCall,
    CannotBlockSelf,
}

impl std::fmt::Display for EngineError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let s = match self {
            EngineError::NoLanguages => "choose at least one language".to_string(),
            EngineError::TooManyLanguages { max } => format!("choose at most {max} languages"),
            EngineError::AlreadyActive => "already waiting, in an offer, or in a call".to_string(),
            EngineError::NoSuchOffer => "that offer is no longer open".to_string(),
            EngineError::NotInCall => "not in a call".to_string(),
            EngineError::CannotBlockSelf => "cannot block yourself".to_string(),
        };
        f.write_str(&s)
    }
}

/// Where a user currently is. A user is in at most one of these.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(tag = "phase", rename_all = "snake_case")]
pub enum Phase {
    Idle,
    Waiting,
    Offered { match_id: MatchId },
    InCall { match_id: MatchId },
}
