# v2 concept: learned homerow mod disambiguation

Companion to `v2-p4-pod.md`. The version of "spend the P4's compute on
typing" that earns its keep: decide tap-vs-hold for homerow mods from the raw
keyup/keydown stream, personalized to how I actually type.

## Problem

Homerow mods trade a dedicated mod key for an ambiguity: every home-row press
must be classified as *letter* or *modifier* after the fact. Fixed heuristics
misfire on exactly the patterns fast typing produces — rolls (`s`→`a`
overlapping reads as Shift+A → `A`), quick mod chords mid-burst, timing that
drifts with fatigue. Years of tuning across QMK/ZMK/RMK hasn't closed the
gap, because the heuristics see two or three scalar features and the intent
signal is richer than that.

## State of the art

All shipping solutions are hand-tuned rules over a handful of features:

| Mechanism | Signal | Firmware |
|---|---|---|
| Tapping term | hold duration vs threshold | all |
| Quick tap (`quick-tap-ms`, `gap_timeout`) | re-press of the same key within a window | all |
| Permissive hold / `balanced` | nested press+release inside the hold | all |
| Hold-on-other-key-press | any second press | all |
| Positional (`hold-trigger-key-positions`; Chordal Hold, QMK 0.28; `unilateral_tap`) | position set / handedness of the chord | ZMK / QMK / RMK |
| Prior idle (`require-prior-idle-ms`; Flow Tap, QMK 2025; `flow_tap`) | idle gap before the press | ZMK / QMK / RMK |

Positional + prior-idle (urob's "timeless" config) is current best practice
and still misfires on same-hand mod chords and fast opposite-hand rolls — the
cases position can't separate. No shipped firmware learns from the user or
uses text context. That part is open territory.

## What's been tried here

Three firmwares, one layout: Colemak-DH, C-A-S-G inward (pinky Ctrl, ring
Alt, middle **Shift**, index GUI), thumb layer-taps. Shift-on-middle carries
the shortest timing in every config — it's the chronic misfire
(`shifted_tap` in the analyzer's taxonomy).

- **ZMK** (`rosebear-zmk`, stale, origin of the layout): tap-preferred,
  150ms short (S/E) / 200ms long, `require-prior-idle` 100/150ms. No
  positional hold-tap.
- **QMK** (`rosebear-qmk`): per-key terms (140ms S/E, 200ms others, 160ms
  thumbs), vendored Achordion (since deprecated upstream) with a custom
  chord rule — same-hand non-thumb press within 180ms cancels an S/E hold,
  thumb keys exempt — plus per-key streak windows (100–150ms) approximating
  prior-idle. The config predates QMK's native Chordal Hold and Flow Tap
  (both 2025) and enables neither.
- **RMK** (`rosebear-rmk`, daily driver = `variants/rosebear-direct`):
  flow-tap (100ms prior idle) + permissive hold, 120ms S/E / 180ms home /
  140ms thumbs, `unilateral_tap` off everywhere. Runs against a local RMK
  fork carrying an in-progress repro test for a tap-hold buffering bug: fast
  taps during a layer-tap hold emit mixed base+layer output in one
  configuration — normal mode + flow-tap off + 140/180ms timeouts (12 of 144
  permutations, all don't-care variations of that one setting). The root
  Corne config's long 200/250ms profiles work around it; the daily driver
  avoids it via permissive-hold + flow-tap.

Two conclusions. First, the deployed configs predate the 2025 generation of
heuristics — native Chordal Hold and Flow Tap are enabled nowhere — so the
modern heuristic ceiling is **unmeasured**, not exhausted. Measuring it is
the mandatory control arm (option 0). Second, the data pipeline already has
a prototype: `rosebear-qmk/keyboards/crkbd/keymaps/rosebear/tools/` has a
raw HID event logger (`hid_log.py`, `decode_hid_log.py`) and
`analyze_holdtap_session.py`, which correlates firmware mod/layer state
against Monkeytype browser keystrokes and labels every hold-tap decision
`true_positive` / `false_positive` / `false_negative` / `shifted_tap`. That
is capture plus drill-labeled ground truth, working today.

## Reframing: classification with a deadline

Tap-hold resolution is an online classification problem: at each event
(press, release, timer tick) estimate P(hold | evidence so far) and
**commit** when confidence crosses a threshold or a deadline expires. Every
existing heuristic is a special case with a hand-written decision boundary.

Misfire classes are named intent→resolution throughout: **tap→hold** (meant
the letter, got the modifier) and **hold→tap** (meant the modifier, got
letters).

Structural constraints:

1. **Commit-only.** HID can't unsend. Once a letter is emitted or a modifier
   applied, the decision is final. (Host-side rewrite is an aggressive
   escape hatch — see open questions — the core design assumes no
   retraction.)
2. **Asymmetric loss.** tap→hold fires a shortcut (Ctrl+A, Cmd+W) —
   potentially destructive. hold→tap emits garbage text — visible and cheap
   to fix. Under uncertainty, resolve tap. Good heuristics already encode
   this bias; a classifier makes the loss ratio an explicit tunable.
3. **Asymmetric observability.** hold→tap leaves a crisp correction
   signature in the keystream (`s/` → 2× backspace → `?`). tap→hold leaves a
   weaker one — the *recovery* is visible: undo chords, Escape, or a
   backspace burst shortly after a hold resolution. Labels for the
   destructive class are scarcer and noisier; see labeling.

## Latency

Single-digit-ms applies to *added* latency, against the real baseline:

- A tap commits at **release** (i.e. after the hold duration, ~50–90ms
  mid-flow) — or at **press** under flow-tap, which fires whenever the
  preceding gap is short. Fast typing already gets instant taps today.
- A hold commits at the tapping term, or earlier on a disambiguating event
  (permissive hold).

The classifier's latency claim is narrow: it generalizes flow-tap's early
commit from one bit (prior gap) to a learned confidence over the full signal
inventory, so more presses commit instantly. The cost is explicit: each
commit-at-press forfeits the release-timing evidence that today arrives
before commit, and constraint 1 makes the resulting hold→tap misfires final.
The confidence threshold prices that trade; it is a tunable, not a free win.

Decision-time compute at 400MHz: feature extraction ~µs, int8 classifier
(<10k params) 10–100µs, n-gram lookup ~ns. All trivially inside budget.

The LM prior never runs at decision time. After each committed character a
background task advances the model (incremental KV cache — the autocomplete
machinery from `keyboard-v2-esp32p4.md`) and leaves a next-char distribution
in RAM (token→char via a precomputed first-char table). Two honest caveats:
BPE tail instability means 1–2 forward passes per character, and bursts have
30–60ms inter-key gaps — exactly the events this design targets — while a
forward pass costs 10–100ms. The prior is stale precisely when it matters
most, so the classifier treats it as best-effort and falls back to the
n-gram, which is always fresh. Whether the LM ever adds value *in time* is
an open question replay can answer.

**Timestamp fidelity.** RMK's default debouncer is deferred and integrating
(1ms sampling, 20ms window) over a polled scan loop; per-pin interrupts with
an eager debouncer would be new code, and mechanical bounce sets a ~1ms
floor regardless. The discriminating overlaps are tens of ms, so 1ms
resolution suffices. The pod design's real capture win is elsewhere: all 36
keys on one controller means no split-link timestamp skew (see capture).

## Signal inventory

Features available at decision time, in order of expected value:

- **Timing:** hold duration so far; overlap duration with subsequent press;
  inter-key intervals for the preceding ~5 events; idle gap before the press
  (continuous generalization of prior-idle).
- **Identity/geometry:** which key; which subsequent key; same-hand vs
  opposite (the one bit the positional heuristics use); finger assignment;
  roll direction (inward rolls are the classic misfire).
- **Release ordering:** rolls release in press order; deliberate chords hold
  the mod past the nested key's release (permissive hold, generalized to a
  continuous feature).
- **Rhythm state:** EMA of recent inter-key interval (burst vs deliberate);
  time since last correction.
- **Text context:** P(literal continuation) from char n-gram or LM — after
  `discu`, `s` is a letter, and no shipping firmware knows it; `s` after a
  2s idle at a line start is Ctrl+S territory.

## Options

Composable; the expected path is 0 → A → B → D, with C, E, F as measured
branches.

**Option 0 — modern heuristics, properly.** Enable the 2025 generation and
measure it: Chordal Hold + Flow Tap in QMK — `get_chordal_hold()` is
signature-identical to the existing `achordion_chord()`, so the custom
same-hand rule ports mechanically — and flow-tap is already live in RMK.
This is the control arm; no claim of "smarter" means anything against
anything less.

**Option A — offline-tuned heuristics.** Keep the heuristic form, fit the
parameters (per-key terms, idle thresholds, chordal exceptions) by replaying
logged typing through candidate configs and minimizing weighted misfires. No
runtime ML, no latency risk, deployable on any firmware including the
current board. Replay decides how much of the win this captures; it requires
the data pipeline, which is the real asset anyway.

**Option B — feature classifier.** GBDT or tiny MLP over the signal
inventory (minus LM), confidence-threshold commit with deadline fallback.
Trained offline on logged data, quantized into flash. The first rung that
can express "this same-hand roll shape at this speed is always a tap *for
me*".

**Option C — sequence model.** Small GRU/TCN over the raw event stream,
learning features implicitly. More data-hungry, harder to inspect, and the
handcrafted features already encode most known structure. Only worth it if B
plateaus measurably below the labeled-data ceiling.

**Option D — language prior.** Add the precomputed next-char distribution as
a classifier feature. Start with a char n-gram table (KBs–MBs, built from my
own prose + code corpora); the full pico-gpt engine is the same interface
with better tail behavior. Measure the n-gram-vs-LM gap in replay before
paying the engine-port cost. This is the P4-only option — nothing else here
strictly needs 400MHz.

**Option E — online adaptation.** On-device mispredict detection (correction
signatures) nudges thresholds or per-key priors between offline retrains.
Bounded adaptation (clamped threshold offsets, not weight updates) keeps a
bad week of data from bricking muscle-memory trust.

**Option F — generative typing model.** Drills produce aligned (target text,
event stream) pairs; fit a model of *my typing given intent* — next key
event and its latency conditioned on prior events and the text being typed.

The cheap rung is **mutation**: keep real logged streams, estimate
per-key/per-transition latency variance, and jitter timestamps within it —
order swaps included, which is exactly the misfire-generating mechanism.
Intent is pinned by the original stream, so this is label-preserving
augmentation that manufactures near-boundary variants of real events with no
model fitting beyond variance estimates. Do this before the full model.

The full model has two uses:

- *Synthetic training data.* Sample unlimited labeled event streams,
  including the hold-intent cases natural data barely labels (closes the
  observability asymmetry from the generator side). Sim2real is the risk:
  misfires live in the tails of the timing distribution and generative
  models smooth tails, so a classifier trained purely on samples learns the
  simulator's boundary. Synthetic pretrains and augments; real data
  fine-tunes; evaluation is real-only.
- *Direct Bayes classifier.* A calibrated generative model classifies
  without a discriminative stage: commit on the likelihood ratio
  P(events | tap) : P(events | hold) × text prior. Subsumes option D — the
  text prior and the timing model become one scoring function. Host-side
  first (it's the replay harness's scorer); on-device only if a distilled
  version fits the µs budget.

## Data pipeline

The pipeline is the project. Every option including "just tune the
heuristics" gets its value from it.

**Capture.** Firmware streams raw events — key id, edge, event-time
timestamp, plus its own decisions and their timing — over a side channel
(raw HID or CDC) to a host logger. Two requirements the prototype teaches:
logging runs queued off the scan/decision path (`hid_log` currently sends
synchronously inside the event hook, perturbing the timings it measures),
and timestamps are taken at event time (it already does this — preserve it).
Split-link skew is the other trap: both capture candidates are splits (QMK
stamps peripheral-half events at master read; the RMK daily driver is a BLE
split), so cross-hand ordering — the top feature — carries a systematic
ms-scale one-sided skew. Log it, estimate it, treat cross-hand overlap
features accordingly; the single-controller pod removes it entirely.

**Labeling.**
- *Correction mining (hold→tap):* resolved tap followed within a short
  window by backspaces and a retype consistent with the mod interpretation →
  high-precision label.
- *Undo mining (tap→hold):* undo chords, Escape, or a backspace burst
  shortly after a hold resolution → the scarce destructive-class labels,
  same mechanism, no host access needed.
- *Heuristic consensus:* events where all baseline algorithms agree and no
  correction follows → weak labels, huge volume. Most typing is unambiguous;
  the classifier must first not break the easy 99%.
- *Calibration drills:* typed exercises with known intent → gold labels,
  distribution-shifted from natural typing. Evaluation more than training.
  `analyze_holdtap_session.py` already does this against Monkeytype,
  including the `shifted_tap` class.
- *Host-side ground truth (optional):* a helper using accessibility APIs
  sees focused-app and actual text effects, closing the tap→hold
  observability gap fully. The Monkeytype analyzer is a scoped version of
  this; generalizing it is a keylogger-adjacent decision taken separately.

**Replay harness.** Drive the *real* resolvers, not models of them: the RMK
fork already has a test harness feeding timed key sequences to the actual
keyboard core and asserting HID reports (`tests/common/`, three large morse
suites), and QMK has a native tap-hold test harness. Hand-modelled semantics
only for engines out of reach. Feed logged streams through candidates —
option 0 configs, A sweeps, B/D/F scorers — and score per-class misfires and
commit-latency distribution against labels. All tuning and all claims happen
here; firmware receives winners.

**Metrics.** Per-class misfire rates (tap→hold weighted ×N), commit-latency
distribution vs baseline, corrections per 1000 decisions over time. Two
integrity rules: the destructive class is only observable via undo mining,
drills, or the host helper — report it separately, never blended into a
single rate; and corrections are also a label source, so headline evaluation
runs on held-out drill data, not on the signal that generates training
labels.

## Deployment shape

A decision engine at RMK's tap-hold resolution point. RMK has no pluggable
behavior trait — morse resolution is inline in the keyboard event loop — so
this is a fork of that path; the fork already exists locally for the
buffering repro. Deferred emission with a hard deadline at the configured
tapping term bounds worst-case latency; a passthrough mode (classifier off →
stock resolver) is the safety switch, and equivalence to stock is claimed
only for that mode. Weights live in flash and stay hot in SRAM; the
LM/n-gram task on core 1 owns the PSRAM traffic, and the decision path
touches none of it at decision time.

## Open questions

- **Deferred emission in RMK.** The buffering repro says the event-queue
  semantics need care; does RMK's buffer shape support a resolver that holds
  events until commit, or does that path need restructuring first?
- **Destructive-class labels.** Is undo mining + drills enough signal for
  tap→hold, or does honest training data require the host-side helper?
- **Data volume and drift.** How many hours of logging before B beats
  tuned-A in replay? Does timing drift (fatigue, day-to-day) demand E, or is
  a periodic offline retrain enough?
- **n-gram vs LM.** Does the LM prior ever arrive in time during bursts —
  the events that matter? If not, option D *is* the n-gram table.
- **Corpus split.** Prose and code have different char statistics and
  different mod usage (`s/` is sed, not a typo). One model with a context
  feature, or per-mode models switched by layer?
- **LM arbitration.** Autocomplete generation (`keyboard-v2-esp32p4.md`) and
  the per-char prior are two continuous consumers of one engine and one
  PSRAM bus; who yields, and when?
- **Retraction mode.** Host-side rewrite means buffering and re-sending a
  run of output, not a single backspace — and it's catastrophic in password
  fields and non-text contexts the keyboard can't see. Default no; is there
  a safe opt-in subset?
- **Scope.** Homerow mods and thumb layer-taps share the engine (same
  ambiguity, same features). Combos are a different shape — a decision over
  a key *set*, not a per-key label — and stay out.
- **Privacy.** Capture logs are keylogs of my own machine. Retention,
  password-entry exclusion (a pause-capture key?), and whether logs ever
  leave the box.
- **Context breaks.** Mouse edits and app switches invalidate the LM context
  (accepted as approximate in the autocomplete sketch); the prior feature
  degrades to n-gram/uniform when stale.
- **Felt latency.** Does earlier confident commit produce a *perceptible*
  improvement, or only benchmark deltas? Blind A/B once a replay winner
  ships.

## Starting point if picked up

1. Capture: extend the `hid_log` pipeline into an always-on logger, queued
   off the scan path, on the daily driver. Weeks of data cost nothing.
2. Replay harness around the real RMK/QMK resolvers; measure today's actual
   misfire rate and latency. `analyze_holdtap_session.py`'s taxonomy is the
   seed. Everything else is judged against this number.
3. Option 0 on-board and in replay: native Chordal Hold + Flow Tap, custom
   chord rule ported to `get_chordal_hold()`. The modern-heuristic ceiling,
   measured.
4. Option A sweep in replay; backport the winner to the current board.
5. Option B, then D (n-gram first), each shipping only on beating the
   incumbent in replay by a margin that survives the deadline constraint.
