# Changelog

## Unreleased

- 修复样例运行中状态误显示为“自动”的问题 / Fix running sample state being shown as auto.
- 简化 OI Judge 样例树结构并合并低频工作区操作 / Simplify the OI Judge sample tree and consolidate low-frequency workspace actions.
- 为每个测试点增加单独运行按钮 / Add inline run button for each testcase.
- 改进样例树 verdict 显示：AC 显示通过图标，非 AC 显示清晰文字 / Improve sample tree verdict display with check icon for AC and text for non-AC results.
- 样例树 verdict 改为清晰文本显示 / Fix sample tree verdicts to use readable text instead of tiny icons.
- 修复深色主题下样例树 verdict 图标不可见的问题 / Fix verdict icons being unreadable in dark themes.
- 修复批量测试时样例结果不会实时显示的问题 / Fix sample verdicts not updating during batch runs.
- 样例树状态图标改为显示 AC、WA、MLE 等字母 verdict / Show verdict acronyms such as AC, WA, and MLE in sample tree status icons.
- 测试报告使用 AC、WA、MLE 等英文缩写 / Fix judge report to use verdict acronyms such as AC, WA, and MLE.
- 运行样例时在样例树显示运行中图标 / Show running indicators in the sample tree while tests are running.
- 补全导出测试点的移动模式 / Complete move mode for testcase export.

## 5.1.0 - 2026-06-16

- 新增 Linux / macOS POSIX Native Runner / Add Linux / macOS POSIX Native Runner.
- 保留 Windows Native Runner，并按平台选择 runner / Keep Windows Native Runner and select the runner by platform.
- 修复跨平台 PATH 处理与样例文件名解析 / Fix cross-platform PATH handling and sample filename parsing.
- 新增 ubuntu-latest / macos-latest / windows-latest 三平台 GitHub Actions CI / Add three-platform GitHub Actions CI for ubuntu-latest / macos-latest / windows-latest.
- Linux / macOS CI 中加入 POSIX runner smoke test / Add POSIX runner smoke test to Linux / macOS CI.
- 修复 CI YAML 中 POSIX smoke test 的换行问题 / Fix POSIX smoke test newline in CI YAML.
- 三平台 CI 已通过：ubuntu-latest、macos-latest、windows-latest / Three-platform CI passed on ubuntu-latest, macos-latest, and windows-latest.
- 新增完整题目包导出功能 / Add full problem package export.
- 新增完整题目包导入功能 / Add full problem package import.
- 修复出题人模式中缺少导出测试点入口的问题 / Fix missing export testcases entry in setter mode.

## 5.0.5 - 2026-06-15

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
- Cleaned up command/UI metadata by normalizing user-visible command titles and keeping legacy stderr commands internal.
- Fixed Windows MinGW/RedPanda-Cpp compiler launches by keeping the compiler bin directory on child process PATH without mutating the global environment.

## 0.4.0 - 2026-05-28

- Prepare OI Judge for VS Code Marketplace publishing.
- Rename the extension from OIjudger to OI Judge before Marketplace publishing.
