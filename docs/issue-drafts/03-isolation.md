# Proposal: temporary selection isolation for focused editing

Update 2026-11-07: [PR #163](https://github.com/negurvulkan/kizamubeam/pull/163)
published independently against current upstream main, without context-menu or
Shape Builder dependencies. Description below is historical.

Later 07.11.: PR #163 merged upstream. The combined prototype's extra context-menu
entry and new dedicated toolbar icon/default placement remain separate local work.

Internal discussion draft — not published; not a PR. Local baseline: 2.7.0
(`480d5b1`), branch `feat/vector-tools`, uncommitted prototype.

## Motivation

Edit crowded designs without changing durable hidden/locked/output properties
or accidentally snapping to unrelated geometry.

## Proposed behavior and local implementation

Isolate the current selection; exclude outsiders from drawing, hit-testing,
selection and snapping. Objects created inside isolation join its scope. Exit
restores the prior selection where objects still exist. Groups remain whole;
this is not nested group editing. An explicit badge says isolation is not an
output filter, with an exit action; Escape also leaves isolation.

Isolation is transient, not serialized, and does not rewrite visibility,
locking or “Nicht lasern”. Ordinary “Nur Auswahl” output remains independent.
Workspace image export temporarily removes isolation/working overlays. History
restoration and document/page/tab resets discard transient scope and builder
state rather than retaining stale object references.

## Limits and questions for discussion

No nested scope stack, group-child editing or persistent isolation. Is returning
to the prior selection desirable after creating objects? Is the output-filter
warning sufficiently clear? Native desktop usability still needs human review.

## Verification and safety

Combined tests cover unchanged serialization/generated moves, excluded hit-tests
and snapping, adoption, Undo and page-state resets. Real-editor browser checks
verify pixels and restored outside rendering. No output-generation or controller
semantics are intentionally changed. Simulator/unit checks are not hardware
certification. See [verification](../prototype-verification.md).

AI disclosure: substantially generated/adapted and tested with **GPT 6.1 Sol
(OpenAI) via OpenCode**. Automated checks are not independent human review.
