# Changelog

## Unreleased

## 5.2.1

- 加固报告页 Content-Security-Policy。
- 为报告页内联 script/style 添加 nonce。
- 保持报告页视觉与展开/收起交互行为不变。

## 5.2.0 Pre-release / 5.2.0 预发布

- 新增跨平台回归测试，覆盖 Windows、macOS 和 Linux 上的 Judge、Stress、Report UI 与打包 smoke 流程 / Add cross-platform regression coverage for Judge, Stress, Report UI, and packaging smoke checks on Windows, macOS, and Linux.
- 新增 Environment Check / 环境自检命令，用于诊断编译器、C++17 编译、程序运行、stdin/stdout、文件 IO、native runner 和进程停止能力 / Add Environment Check diagnostics for compiler discovery, C++17 compilation, execution, stdin/stdout, file IO, native runner, and process stop support.
- 修复 macOS native runner memory 单位换算，保持 Linux/macOS 内存统计语义一致 / Fix macOS native runner memory unit handling and keep memory reporting consistent across Linux and macOS.
- 修复 Windows compiler discovery 中 `where` / `which` 探测可能卡住的问题，并优先使用已配置 compiler / Fix possible hangs in Windows compiler discovery probes and prefer configured compilers.
- 修复 `runProcess` timeout 后的进程树清理，避免超时进程残留 / Fix process tree cleanup after `runProcess` timeouts to avoid leftover child processes.
- 修复 Stress stop / Stop Stress Test 的进程树回收，提升重复停止操作的稳定性 / Fix process tree cleanup for Stress stop / Stop Stress Test and make repeated stops safer.
- 修复 native runner helper build 可能无限挂住的问题，增加 timeout、进程树清理和截断诊断日志 / Fix possible native runner helper build hangs with timeout, process tree cleanup, and bounded diagnostics.
- 稳定 Windows / macOS / Linux 跨平台行为，并补充 report UI / cross-platform / packaging smoke 测试 / Stabilize Windows, macOS, and Linux behavior with report UI, cross-platform, and packaging smoke coverage.

- 新增环境自检命令，帮助诊断编译器、C++17、程序运行、stdin/stdout、文件 IO、native runner、用时内存和停止进程能力 / Add environment check command to diagnose compiler, C++17, execution, stdin/stdout, file IO, native runner, timing, memory, and process stop support.

- 新增跨平台回归测试，覆盖 Judge 多样例组、对拍流程、停止对拍和报告 UI smoke test / Add cross-platform regression tests for judge sample groups, stress workflows, stop action, and report UI smoke checks.

- 新增对拍当前代码命令，并支持使用调试停止按钮中断正在运行的对拍 / Add Stress Test Current Code command and support stopping active stress tests with a debug-stop action.

- 优化对拍模式文案，明确区分分文件对拍和单文件考场式对拍 / Clarify stress-test mode labels for split-file and single-file contest-style workflows.

- 新增“测试当前代码”命令，可从当前聚焦的 `.cpp` 文件直接运行当前题目的全部测试点 / Add Test Current Code command to run all testcases for the active problem from the focused `.cpp` file.

- 新增报告失败样例分组内置顶显示，便于优先查看未通过测试点 / Add failed-case-first ordering within each report group for easier debugging.

- 优化测试报告测试点列表，使用无表头布局、判题全称和带标签的得分/时间/内存信息 / Improve report testcase list with headerless layout, full verdict names, and labeled score/time/memory fields.

- 为测试报告展开详情增加透明到实体的淡入效果 / Add fade-in opacity transition for expanded report details.

- 放慢测试报告展开动画，使详情和 Subtask 展开更自然 / Slow down report expansion animations for smoother case details and subtask expansion.

- 修复测试报告展开动画中文字模糊和结束跳变的问题，并优化 Subtask 展开动画 / Fix blurry text and end-of-animation jumps in report expansion and improve subtask expansion animation.
- 优化测试报告展开细节，去除内层详情卡片并为 Subtask 添加平滑展开动画 / Polish report expansion details by flattening case details and animating subtask expansion.
- 继续打磨测试报告视觉细节，弱化按钮、边框和失败色 / Further polish judge report visuals with softer buttons, borders, and failure colors.
- 为 VS Code 扩展 manifest 增加中英文 package.nls 本地化 / Add English and Simplified Chinese package.nls localization for the VS Code extension manifest.
- 优化测试报告视觉层级、展开动画和 Subtask 分组样式 / Improve judge report visual hierarchy, expand animation, and Subtask grouping.

- 新增 OI 风格文本比较，支持忽略行末空格和文末回车 / Add OI-style text comparison that ignores trailing whitespace and final newlines.
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
