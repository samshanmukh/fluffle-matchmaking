//! Fluffle matchmaking back end.
//!
//! * [`engine`]: the pairing engine (pure state machine, no I/O).
//! * [`server`]: the WebSocket/HTTP layer that drives one engine.
//! * [`scenario`]: scripted scenarios run against the engine.

pub mod engine;
pub mod scenario;
pub mod server;
