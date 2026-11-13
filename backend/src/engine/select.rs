//! Pair selection: given everyone who is waiting, decide who is paired with whom.
//!
//! The product rule (section 2 of the brief) is a strict priority order, so the
//! result is defined as "sort every eligible pair best-first, then take pairs
//! from the top, skipping anyone already taken". [`select_naive`] is exactly
//! that sentence, in O(n²). [`select_indexed`] produces the same pairs in the
//! same order without comparing everyone with everyone, and is what the engine
//! runs. A property test checks the two always agree.

use std::collections::{HashMap, HashSet};

use super::types::{LangId, Ms, TopicId, Uid};

/// What selection needs to know about one waiting person.
#[derive(Clone, Debug)]
pub struct Candidate {
    pub uid: Uid,
    /// Sorted, deduplicated.
    pub langs: Vec<LangId>,
    pub topic: Option<TopicId>,
    /// When this person first joined (kept when they return to the queue).
    pub seniority: Ms,
    /// Server arrival order of the join; breaks exact seniority ties.
    pub seq: u64,
}

impl Candidate {
    /// Smaller is better: longest wait first, then earliest arrival.
    fn rank(&self) -> (Ms, u64) {
        (self.seniority, self.seq)
    }
}

/// Active partner requests, indexed by language set.
#[derive(Clone, Debug, Default)]
pub struct Requests {
    by_set: HashMap<Vec<LangId>, HashSet<TopicId>>,
}

impl Requests {
    pub fn new(list: impl IntoIterator<Item = (Vec<LangId>, Option<TopicId>)>) -> Self {
        let mut by_set: HashMap<Vec<LangId>, HashSet<TopicId>> = HashMap::new();
        for (mut langs, topic) in list {
            langs.sort_unstable();
            langs.dedup();
            let topics = by_set.entry(langs).or_default();
            if let Some(t) = topic {
                topics.insert(t);
            }
        }
        Self { by_set }
    }

    /// 0 = no request for these shared languages, 1 = a request for them,
    /// 2 = a request that also names the topic both people picked.
    fn tier(&self, shared: &[LangId], shared_topic: Option<TopicId>) -> u8 {
        match self.by_set.get(shared) {
            None => 0,
            Some(topics) => match shared_topic {
                Some(t) if topics.contains(&t) => 2,
                _ => 1,
            },
        }
    }

    fn sets(&self) -> impl Iterator<Item = &Vec<LangId>> {
        self.by_set.keys()
    }
}

/// The ranking class of a pair. Field order is priority order, so the derived
/// `Ord` is the product rule: exact set, then partner demand, then shared topic.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct Class {
    pub exact: bool,
    pub partner: u8,
    pub same_topic: bool,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Pairing {
    /// The longer-waiting of the two.
    pub older: Uid,
    pub younger: Uid,
    /// Languages both speak: the label on the call.
    pub shared: Vec<LangId>,
    /// The agreed topic, only when both picked the same one.
    pub topic: Option<TopicId>,
    pub class: Class,
}

fn intersect(a: &[LangId], b: &[LangId]) -> Vec<LangId> {
    let (mut i, mut j, mut out) = (0, 0, Vec::new());
    while i < a.len() && j < b.len() {
        match a[i].cmp(&b[j]) {
            std::cmp::Ordering::Less => i += 1,
            std::cmp::Ordering::Greater => j += 1,
            std::cmp::Ordering::Equal => {
                out.push(a[i]);
                i += 1;
                j += 1;
            }
        }
    }
    out
}

/// `None` when the two share no language (never pairable).
fn classify(a: &Candidate, b: &Candidate, reqs: &Requests) -> Option<(Class, Vec<LangId>, Option<TopicId>)> {
    let shared = intersect(&a.langs, &b.langs);
    if shared.is_empty() {
        return None;
    }
    let topic = match (a.topic, b.topic) {
        (Some(x), Some(y)) if x == y => Some(x),
        _ => None,
    };
    let class = Class {
        exact: a.langs == b.langs,
        partner: reqs.tier(&shared, topic),
        same_topic: topic.is_some(),
    };
    Some((class, shared, topic))
}

fn sorted_by_rank(cands: &[Candidate]) -> Vec<&Candidate> {
    let mut v: Vec<&Candidate> = cands.iter().collect();
    v.sort_by_key(|c| c.rank());
    v
}

/// Reference implementation: every eligible pair, sorted best-first, taken greedily.
/// `vetoed(a, b)` is true when the two must never be paired (blocks, cooldowns).
pub fn select_naive(cands: &[Candidate], reqs: &Requests, vetoed: &dyn Fn(Uid, Uid) -> bool) -> Vec<Pairing> {
    let ranked = sorted_by_rank(cands);
    let mut all = Vec::new();
    for i in 0..ranked.len() {
        for j in (i + 1)..ranked.len() {
            if let Some((class, shared, topic)) = classify(ranked[i], ranked[j], reqs) {
                if !vetoed(ranked[i].uid, ranked[j].uid) {
                    all.push((class, i, j, shared, topic));
                }
            }
        }
    }
    // Best class first; inside a class, the longest waiter's pairs first, then
    // the partner who has waited longer.
    all.sort_by(|x, y| y.0.cmp(&x.0).then(x.1.cmp(&y.1)).then(x.2.cmp(&y.2)));

    let mut taken = vec![false; ranked.len()];
    let mut out = Vec::new();
    for (class, i, j, shared, topic) in all {
        if !taken[i] && !taken[j] {
            taken[i] = true;
            taken[j] = true;
            out.push(Pairing { older: ranked[i].uid, younger: ranked[j].uid, shared, topic, class });
        }
    }
    out
}

/// The lists a person can be looked up through. Each family covers every pair
/// of the classes it is used for (see `STEPS`).
#[derive(Clone, Copy, PartialEq, Eq, Hash, Debug)]
enum Family {
    /// Same exact language set and same topic.
    ExactSetTopic,
    /// Same exact language set.
    ExactSet,
    /// Speaks every language of a partner-requested set, with this topic.
    RequestSetTopic,
    /// Speaks every language of a partner-requested set.
    RequestSet,
    /// Speaks this language, with this topic.
    LangTopic,
    /// Speaks this language.
    Lang,
}

#[derive(Clone, PartialEq, Eq, Hash, Debug)]
enum Key {
    SetTopic(Vec<LangId>, TopicId),
    Set(Vec<LangId>),
    LangTopic(LangId, TopicId),
    Lang(LangId),
}

const fn class(exact: bool, partner: u8, same_topic: bool) -> Class {
    Class { exact, partner, same_topic }
}

/// Every class, best first, with the family whose lists contain all its pairs.
const STEPS: [(Class, Family); 10] = [
    (class(true, 2, true), Family::ExactSetTopic),
    (class(true, 1, true), Family::ExactSetTopic),
    (class(true, 1, false), Family::ExactSet),
    (class(true, 0, true), Family::ExactSetTopic),
    (class(true, 0, false), Family::ExactSet),
    (class(false, 2, true), Family::RequestSetTopic),
    (class(false, 1, true), Family::RequestSetTopic),
    (class(false, 1, false), Family::RequestSet),
    (class(false, 0, true), Family::LangTopic),
    (class(false, 0, false), Family::Lang),
];

fn is_subset(small: &[LangId], big: &[LangId]) -> bool {
    small.iter().all(|l| big.binary_search(l).is_ok())
}

fn keys_for(family: Family, c: &Candidate, reqs: &Requests) -> Vec<Key> {
    match family {
        Family::ExactSetTopic => c.topic.map(|t| Key::SetTopic(c.langs.clone(), t)).into_iter().collect(),
        Family::ExactSet => vec![Key::Set(c.langs.clone())],
        Family::RequestSetTopic => match c.topic {
            None => vec![],
            Some(t) => reqs
                .sets()
                .filter(|s| is_subset(s, &c.langs))
                .map(|s| Key::SetTopic(s.clone(), t))
                .collect(),
        },
        Family::RequestSet => reqs.sets().filter(|s| is_subset(s, &c.langs)).map(|s| Key::Set(s.clone())).collect(),
        Family::LangTopic => match c.topic {
            None => vec![],
            Some(t) => c.langs.iter().map(|&l| Key::LangTopic(l, t)).collect(),
        },
        Family::Lang => c.langs.iter().map(|&l| Key::Lang(l)).collect(),
    }
}

/// Can a list with this key contain any pair of this class? Lets a step skip
/// whole lists (for example a topic bucket no partner asked for) without
/// walking them.
fn list_can_hold(step: Class, family: Family, key: &Key, reqs: &Requests) -> bool {
    match (family, key) {
        (Family::ExactSetTopic, Key::SetTopic(set, t)) | (Family::RequestSetTopic, Key::SetTopic(set, t)) => {
            step.partner == reqs.tier(set, Some(*t))
        }
        (Family::ExactSet, Key::Set(set)) => step.partner == reqs.tier(set, None),
        _ => true,
    }
}

/// Same result as [`select_naive`], using hash lookups and per-language lists
/// in place of comparing every pair.
pub fn select_indexed(cands: &[Candidate], reqs: &Requests, vetoed: &dyn Fn(Uid, Uid) -> bool) -> Vec<Pairing> {
    let ranked = sorted_by_rank(cands);
    let n = ranked.len();
    let mut taken = vec![false; n];
    let mut out = Vec::new();
    // Lists hold positions in `ranked`, ascending, so "the first entry after
    // me" is "the longest-waiting person after me".
    let mut lists: HashMap<Family, HashMap<Key, Vec<u32>>> = HashMap::new();

    for (step, family) in STEPS {
        // Build a family's lists the first time it is needed, from whoever is
        // still unpaired, so later (broader) families stay small.
        let index = lists.entry(family).or_insert_with(|| {
            let mut m: HashMap<Key, Vec<u32>> = HashMap::new();
            for (pos, c) in ranked.iter().enumerate() {
                if !taken[pos] {
                    for key in keys_for(family, c, reqs) {
                        m.entry(key).or_default().push(pos as u32);
                    }
                }
            }
            m
        });

        for i in 0..n {
            if taken[i] {
                continue;
            }
            // The best partner for `i` in this class is the lowest-ranked
            // position after `i` that forms a pair of exactly this class.
            let mut best: Option<(usize, Vec<LangId>, Option<TopicId>)> = None;
            for key in keys_for(family, ranked[i], reqs) {
                if !list_can_hold(step, family, &key, reqs) {
                    continue;
                }
                let Some(list) = index.get(&key) else { continue };
                let start = list.partition_point(|&p| (p as usize) <= i);
                for &p in &list[start..] {
                    let j = p as usize;
                    if best.as_ref().is_some_and(|b| j >= b.0) {
                        break;
                    }
                    if taken[j] {
                        continue;
                    }
                    if let Some((c, shared, topic)) = classify(ranked[i], ranked[j], reqs) {
                        if c == step && !vetoed(ranked[i].uid, ranked[j].uid) {
                            best = Some((j, shared, topic));
                            break;
                        }
                    }
                }
            }
            if let Some((j, shared, topic)) = best {
                taken[i] = true;
                taken[j] = true;
                out.push(Pairing { older: ranked[i].uid, younger: ranked[j].uid, shared, topic, class: step });
            }
        }
    }
    out
}
