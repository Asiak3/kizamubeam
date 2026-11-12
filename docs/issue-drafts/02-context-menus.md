# Proposal: context-aware editor menus with shared shortcut labels

Update 2026-11-07: [PR #164](https://github.com/negurvulkan/kizamubeam/pull/164)
published independently against current upstream main. Issue #144 links the PR
and is set to close automatically on merge. Description below is historical.

Later 07.11.: PR #164 merged; issue #144 closed automatically.

Published discussion: https://github.com/negurvulkan/kizamubeam/issues/144.
Not a PR. Local baseline: 2.7.0
(`480d5b1`), branch `feat/vector-tools`, uncommitted prototype.

## Motivation

Expose relevant editing commands where users work, without searching menus or
adding every action to a toolbar. Avoid separate, drifting shortcut labels.

## Proposed behavior and local implementation

Vector, bitmap, node/segment and blank-canvas variants reuse editor commands.
Right-clicking a selected object preserves multi-selection; another editable
object becomes selected. Disabled commands cannot run. Draft completion and
active sketch/builder/pick operations retain their existing gestures.

Shared command IDs/default bindings provide shortcut matching and menu labels.
This is groundwork, not a configurable-keybinding settings UI or override format.
The menu owns keyboard capture, restores focus, stays within viewport bounds,
and closes/removes listeners on outside clicks, Escape and editor changes.
Stale-document callbacks and open modal dialogs block execution.

## Limits and questions for discussion

The prototype exposes a selected subset of commands, not a full menu mirror.
Should command grouping, keyboard context-menu invocation and future configurable
bindings follow a broader command-registry design? Test native WebView focus,
platform shortcut conventions and accessibility before considering integration.

## Verification and compatibility

Combined interaction tests and isolated browser lifecycle/keyboard checks passed;
the real-editor fixture verifies right-click multi-selection and Escape. Existing
menus/toolbars remain. No document-format, backend or machine-command change is
intended; `laser.ts` only routes the preview shortcut through the shared matcher.
See [verification](../prototype-verification.md).

AI disclosure: substantially generated/adapted and tested with **GPT 6.1 Sol
(OpenAI) via OpenCode**. Automated checks are not independent human review.
