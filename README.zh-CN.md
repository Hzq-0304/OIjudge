# OI Judge

OI Judge 是一款面向 VS Code 的 OI 本地评测与出题辅助插件。它既可以帮助选手在本地快速运行和检查样例，也可以帮助出题人管理题目、样例、Subtask、STD、数据生成器、Checker 与评测报告。

Marketplace 信息：

- Publisher: `Hzq`
- Extension ID: `Hzq.oijudge`

项目地址：

- GitHub: https://github.com/Hzq-0304/OIjudge

## 核心功能

- C++ 本地评测：在 VS Code 中编译并运行当前题目的 C++ 程序。
- 标准输入输出：支持常见的 stdin / stdout 评测方式。
- File IO：支持配置输入文件名和输出文件名，适配 OI 常见文件读写题。
- Plain Checker：支持轻量级自定义 Checker，通过约定的输出协议返回 verdict、分数和提示信息。
- testlib Checker：支持 testlib 风格 Checker，用于更复杂的答案校验。
- Runtime Error 分析：程序运行错误时展示退出码、信号、stderr 与可能原因，便于快速定位问题。
- 样例管理：支持手动粘贴样例、选择输入输出文件、批量导入样例、查看样例详情和输出结果。
- Subtask：支持把样例按逻辑 Subtask 分组，并保存 Subtask 相关配置。
- STD 管理：在出题人模式下管理标准程序，为后续出题流程提供基础。
- Generator / 数据生成：支持维护数据生成器及其绑定信息，服务于 OI 出题辅助流程。
- 自定义计分：支持 Checker 返回分数，适合部分分和自定义评分场景。
- 对拍 / Stress Test：支持用不同程序或数据生成流程进行压力测试，辅助发现错误。
- 对拍失败用例管理：保留失败用例，便于复现、查看和进一步分析。
- 测试点导出：将题目数据按配置导出，便于整理和交付。
- 评测报告：生成并打开评测报告，集中查看各样例状态、耗时、输出和错误信息。

## 基础使用方法

1. 在 VS Code 中打开一个工作区。
2. 运行命令 `OI Judge: Create Problem` 创建题目配置。
3. 使用 `OI Judge: Add Program To Problem` 或从当前 C++ 文件创建题目，绑定需要评测的程序。
4. 添加样例，可以手动粘贴输入输出，也可以选择本地 `.in` / `.out` 文件。
5. 根据题目需要设置时间限制、内存限制、C++ 标准、Compiler Path、I/O 模式和 Checker。
6. 点击侧边栏中的运行入口，或执行 `OI Judge: Run All Samples` 运行评测。
7. 在 OI Judge 侧边栏和评测报告中查看结果、输出、错误信息与运行状态。

对于普通本地评测，通常只需要配置程序、样例和评测模式即可。对于大样例或已有测试数据，推荐使用“选择输入/输出文件”的方式绑定外部文件，避免复制大量数据。

## 出题人模式

出题人模式也可以理解为 Author Mode / Setter Mode。开启后，OI Judge 会显示更多面向题目制作的入口，例如 Subtask、STD、Generator、数据生成配置、对拍、失败用例和导出相关功能。

当前设计强调“逻辑配置”和“可迁移路径引用”：Subtask、样例、生成器输入等关系保存在题目配置中，样例文件不需要被移动到真实的 Subtask 子目录里。这样可以在保持工作区结构清晰的同时，为后续完整的 OI 出题流水线打基础。

需要注意的是，绑定 Generator 或生成器输入不等于立即运行 Generator。OI Judge 会先保存绑定关系，真正的数据生成、STD 调用、测试点生成和导出流程会由对应命令显式触发。

## 数据目录说明

OI Judge 在当前工作区内使用以下目录保存插件管理的数据：

```text
.vscode/.OIJudge/
```

请注意，`.vscode/.OIJudge` 是目录，不是文件。常见内容包括题目配置、托管样例、输出结果、评测报告、失败用例和出题辅助数据。

新版本会优先使用 `.vscode/.OIJudge/`。旧版本可能留下 `.oitest` 数据，插件会尽量保留、导入或迁移旧数据，但不建议继续把 `.oitest` 作为主目录使用。

托管样例默认使用：

- 输入文件：`.in`
- 答案文件：`.out`

答案文件统一推荐使用 `.out`。不要为新数据引入 `.ans` 作为主格式；旧数据中的 `.ans` 可能仍被兼容读取，但不应作为新的说明或目录规范。

## Windows 与编译器

在 Windows 下，如果插件没有自动找到合适的 C++ 编译器，可以在设置中配置 `oijudger.compilerPath`，例如指向本机的 `g++.exe`。

如果使用 MinGW / g++，OI Judge 会结合题目的内存限制处理运行参数和诊断信息。遇到 Runtime Error 时，可以先查看插件展示的 stderr、退出码、信号说明和可能原因，再结合本地终端复现。

## 常见工作流

- 本地刷题：创建题目，绑定 C++ 程序，添加样例，运行全部样例并查看报告。
- 文件读写题：切换到 File IO，配置输入/输出文件名，再运行样例。
- 自定义校验：为题目绑定 Plain Checker 或 testlib Checker。
- 出题辅助：开启出题人模式，管理 STD、Generator、Subtask、对拍和测试点导出。
- 调试失败样例：打开样例详情、用户输出、期望输出和评测报告，必要时保存失败用例继续分析。

## 相关链接

- GitHub 仓库：https://github.com/Hzq-0304/OIjudge
- Marketplace Publisher: `Hzq`
- Marketplace Extension ID: `Hzq.oijudge`
