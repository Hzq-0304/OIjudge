# 平台支持

支持平台：

- Windows
- macOS
- Linux

## 推荐环境

### Windows

- 推荐编译器：MinGW-w64 / g++。
- 需要把编译器 `bin` 目录加入 `PATH`，这样 VS Code 和 OI Judge 才能找到 `g++`。
- 停止进程依赖 `taskkill`，或 OI Judge 现有的 Windows kill helper。

### macOS

- 推荐编译器：Xcode Command Line Tools / clang++。
- 可用命令安装：

```sh
xcode-select --install
```

- macOS memory 采集使用 `ru_maxrss` bytes 单位。

### Linux

- 推荐编译器：g++。
- 可通过包管理器安装，例如 `apt` / `pacman` / `dnf`。
- Linux memory 采集使用 `ru_maxrss` KiB，需要换算为 bytes。

## 已测试功能

当前跨平台回归测试覆盖：

- 样例评测 / Judge
- 多 testcase / subtask
- report 渲染
- checker
- Function-style Judge
- I/O Interactive Judge
- generator + std
- split-file stress test
- single-file contest-style stress test
- Stop Stress Test
- Stress Records
- Test Current Code
- Stress Test Current Code
- Environment Check
- native runner time / memory 采集

## 常见问题

- 找不到 `g++` / `clang++`。
- C++17 编译失败。
- 路径中包含空格导致编译失败。
- Windows 下 `taskkill` 不可用。
- macOS / Linux 内存统计差异。
- 文件 IO 工作目录不正确。
- 程序无限运行 / 无法停止。
- GitHub Actions 与本机时间/内存差异。

## 托管题目删除

删除题目只会删除 OI Judge 题目记录和 `.vscode/.OIJudge/problems/<problemId>/` 内部托管目录。源码、题面和题目引用的外部测试点文件在所有平台上都会保留。

## Subtask Skip 与子任务依赖

普通 Judge 支持 Subtask Skip 与子任务依赖。该能力默认关闭以保持旧配置兼容。启用后，失败的 `bundle` 子任务可以跳过剩余测试点；带有 `dependsOn` 的子任务会在任一前置子任务未通过时直接跳过。Skipped 测试点计 `0` 分，且不会启动程序。

依赖模型刻意保持简单：dependency 必须指向存在的 Subtask，并且必须出现在当前 Subtask 之前。不存在的 id 和依赖环会作为配置错误报告。该功能不改变 I/O 交互评测调度。

## I/O 交互评测范围

当前 I/O 交互评测是 solution + interactor 双进程模型的 MVP。选手程序 stdout 会连接到 interactor stdin，interactor stdout 会连接到选手程序 stdin，interactor 通过退出码给出 verdict。

报告会显示交互 transcript、solution stderr、interactor stderr、`{output}` interactor 输出和进程诊断信息。可以参考 `examples/interactive/guess-number/` 中的最小可运行猜数示例。

testlib-like preset 支持 Codeforces / Polygon 风格交互器常见的参数模式：`{input}`、`{output}`、`{answer}`。当 `interactorPreset` 为 `testlib` 且未显式配置 `interactorArgs` 时，OI Judge 会使用 `["{input}", "{output}", "{answer}"]`。`{output}` 是每个测试点独立的临时文件，可供 interactor 写入日志或 verdict 细节。

`useTestlib` 是可选项。设为 `false` 时，OI Judge 不检查 `testlib.h`，也不会自动注入 `testlibHeader` 所在 include 目录；设为 `true` 时，需要通过 `testlibHeader` 或 `testlibIncludeDirs` 提供 `testlib.h`。I/O 交互评测不会为 interactor 内置官方 `testlib.h`。可以参考 `examples/interactive/testlib-like-double/` 中的完整 testlib-like 参数示例和单独的 `testlib.h` 参考配置。

该模式已有 Windows、macOS、Linux 跨平台回归测试覆盖。目前不实现多角色通信题，也不承诺完整兼容 testlib interactive。

## 排障建议

如果 OI Judge 在你的机器上无法正常运行，请先执行：

```text
OI Judge: 检查运行环境
```

然后复制环境检查报告并反馈给维护者。

