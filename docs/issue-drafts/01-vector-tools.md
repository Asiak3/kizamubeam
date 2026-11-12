# Proposal: extended vector editing and interactive Shape Builder

Update 2026-11-07: [PR #162](https://github.com/negurvulkan/kizamubeam/pull/162)
contains multi-object nodes/segments and [PR #165](https://github.com/negurvulkan/kizamubeam/pull/165)
whole-path refitting. Both independently based on current upstream main. Shape
Builder and Pencil remain local, outside these PRs. Description below is historical.

Both PRs are now merged upstream. Pencil's reported user flow was manually
confirmed working on 07.11. Separate toolbar/icon/default-layout work stays local.

Internal discussion draft — not published; not a PR. Local baseline: 2.7.0
(`480d5b1`), branch `feat/vector-tools`, uncommitted prototype.

## Motivation

Reduce dense paths, edit nodes/segments across objects, draw fitted freehand
paths, and combine or remove individual overlap regions without repeatedly
duplicating objects for whole-object Boolean operations.

## Proposed behavior and local implementation

- Simplify/refit with immutable preview, world-mm tolerance and Apply/Cancel.
- Multi-object node/segment editing and fitted Pencil strokes.
- Additional Shape Builder: hover regions, click/drag to merge, Alt to erase.
  Existing whole-object Boolean operations remain available and unchanged.
- First Shape Builder edit retains exact original geometry/parameters/transforms
  and explicitly sets originals to “Nicht lasern” after UI confirmation. Results
  are independent paths, not live parametric derivatives. Later strokes replace
  only the working results; each stroke has Undo.
- Mixed source output states are rejected; all-disabled sources produce disabled
  results. No implicit conversion of generators/sketches/assemblies is proposed.

## Limits and questions for discussion

Closed regions only: no open cutting lines, gap detection, nested groups, or
live derived constraints. Groups are refused intact. Bounded work and flattened
region approximation require visual review around tiny gaps/curves. Is retaining
disabled originals the preferred explicit policy? Should open-line support and
live derived geometry be separate follow-ups?

## Verification and risks

25 vector and 19 combined interaction tests passed, including parameters,
stale starts, mixed output flags, repeated strokes and Undo. Isolated real-editor
browser checks passed. See [verification](../prototype-verification.md) for the
full regression list and limitations. Human gesture/usability acceptance and a
native desktop build remain outstanding; no real hardware was used.

AI disclosure: substantially generated/adapted and tested with **GPT 6.1 Sol
(OpenAI) via OpenCode**. Automated checks are not independent human review.
