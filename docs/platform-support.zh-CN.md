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

## I/O 交互评测范围

当前 I/O 交互评测是 solution + interactor 双进程模型的 MVP。选手程序 stdout 会连接到 interactor stdin，interactor stdout 会连接到选手程序 stdin，interactor 通过退出码给出 verdict。

报告会显示交互 transcript、solution stderr、interactor stderr 和进程诊断信息。可以参考 `examples/interactive/guess-number/` 中的最小可运行猜数示例。

该模式已有 Windows、macOS、Linux 跨平台回归测试覆盖。目前不实现多角色通信题，也不承诺完整兼容 testlib interactive。

## 排障建议

如果 OI Judge 在你的机器上无法正常运行，请先执行：

```text
OI Judge: 检查运行环境
```

然后复制环境检查报告并反馈给维护者。
