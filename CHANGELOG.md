# Changelog

## Unreleased

- Default newly created sample answer files to `.out` while keeping existing `.ans` samples compatible.
- Keep batch import compatible with `.ans` and prefer same-name `.out` files by default.
- Store OI Judge workspace data in `.vscode/.OIJudge/` with `config.json`, and copy legacy `.oitest/` data forward without deleting it.
- Document the current local OI-style judging and problem authoring toolkit scope.
- Added setter STD generated output staging flow with current/generated answer viewing, diffing, applying, and deletion.
- Added generator binding and generator input support for problem-level and Subtask workflows.
- Added Subtask grouping, sample movement, independent Subtask judging, and `sum` / `bundle` scoring modes.
- Added scoring model with problem total score, testcase score, automatic remaining-score distribution, and judge score calculation.
- Added stress test workflow with Generator + STD + Solution mode, standalone mode, saved failed cases, and Stress Records.
- Added testcase export formats for Luogu `config.yml`, Polygon import plan, and LemonLime `contest.cdf`.
- Added custom checker documentation for normal compare, testlib checker, plain checker, and merged checker output.

## 0.4.0 - 2026-05-28

- Prepare OI Judge for VS Code Marketplace publishing.
- Rename the extension from OIjudger to OI Judge before Marketplace publishing.
