# OI Judge

简体中文 | [English](./README.md)

OI Judge 是一款 VS Code 扩展，用于本地 OI 风格评测，也面向 OI 出题辅助流程。它可以帮助选手快速编译、运行、比较样例，也可以帮助出题人管理题目、样例、Subtask、STD、Generator、Checker、对拍、测试点导出和评测报告。

项目定位：本地 OI 风格评测 + 出题辅助工具。

Marketplace 扩展 ID：`Hzq.oijudge`

仓库地址：`https://github.com/Hzq-0304/OIjudge.git`

VSIX 安装包文件名格式：`oijudge-<version>.vsix`

OI Judge 的图标含义是：比较程序输出与期望答案，并给出评测结果。

为了兼容早期版本，内部命令 ID 和设置项可能仍使用 `oijudger` 前缀，例如 `oijudger.language`。

## 当前功能

- 将工作区数据保存在 `.vscode/.OIJudge/`。
- 在 `.vscode/.OIJudge/config.json` 初始化工作区配置，并在 `.vscode/.OIJudge/problems/<problemId>/` 下保存按题目的数据。
- 创建题目时不要求立刻绑定源文件。
- 将本地题面文件（`.md`、`.pdf` 或 `.txt`）绑定到题目。
- 为一个题目添加一个或多个 C++ 程序，并选择默认程序。
- 在 `.vscode/.OIJudge/samples` 或 `.vscode/.OIJudge/problems/<problemId>/samples` 下添加多个样例。
- 通过粘贴文本或选择输入/输出文件添加样例。
- 从文件夹批量添加样例，并按输入和答案后缀匹配文件。
- 从侧边栏删除题目；只删除 OI Judge 题目记录和 `.vscode/.OIJudge/problems/<problemId>/` 内部托管目录，不删除源码、题面或外部样例文件。
- 从 OI Judge 侧边栏删除样例。
- 设置时间限制和内存限制。
- 在 Windows MinGW/g++ 下根据内存限制自动设置栈大小。
- 检测或选择本地 C++ 编译器。
- 使用 `g++` 编译当前 C++ 文件。
- 运行所有已配置样例。
- 比较标准输出。
- 保存用户输出和 `.vscode/.OIJudge/outputs/report.json`。
- 显示 `OI Judge` 侧边栏，其中包含当前文件、限制、样例状态和快捷操作。
- 从侧边栏打开评测报告和样例详情页。
- 从测试点复制可用于本地调试的 `freopen` 输入代码。
- 管理 Subtask、计分、STD 生成答案、Generator、对拍、测试点导出和自定义 Checker。
- 通过 `oijudger.language`（`auto`、`en`、`zh`）切换界面语言。
- 在一个工作区内通过 `.vscode/.OIJudge/config.json` 管理多个题目。
- 保留旧版 `.oitest/problems.json` 和单题 `.oitest/config.json` 数据，并在需要时导入或迁移。

## 数据目录

- `.vscode/.OIJudge/` 是 OI Judge 的工作区数据目录。
- `.vscode/.OIJudge/config.json` 保存当前工作区题目列表和共享的 OI Judge 数据。
- 按题目的样例、输出、Checker 构建产物、生成答案、导出元数据和对拍记录都位于 `.vscode/.OIJudge/` 下。
- 旧目录 `.oitest/` 只是 legacy 兼容迁移来源。OI Judge 可以从中复制或导入数据，但不会把 `.oitest/` 作为当前主数据目录。

## 题目工作流

- `OI Judge: Create Problem` 会创建题目记录和对应的 `.vscode/.OIJudge/problems/<problemId>/` 文件夹，不要求先选择源文件。
- `OI Judge: Bind Statement` 会链接题面文件。OI Judge 只保存原始文件路径，不复制、不修改、也不删除题面文件。
- `OI Judge: Add Program To Problem` 会链接 C++ 程序。程序只是路径引用，源文件不会被复制进 OI Judge 内部数据目录。
- `OI Judge: Set Default Program` 会选择 `Run All Samples` 使用的程序。
- `OI Judge: Run Samples With Program` 可以为一次运行临时选择任意已链接或新选择的 `.cpp` 文件。
- `OI Judge: Add Problem From Current File` 和 `OI Judge: Add Problem From File` 仍然作为快捷入口可用：它们会创建题目，并把选中的文件设为默认程序。

## 树视图

- VS Code 重启后，题目节点默认折叠，以保持 OI Judge 侧边栏紧凑。
- 手动展开题目即可查看 Statement、Programs、Limits、Samples 和 Actions。
- Samples 和 Actions 也默认折叠，便于浏览多样例题目。
- 点击题目下的 Default Program、Compiler 或 C++ Standard 节点，可以编辑对应设置。
- 点击题目 Limits 区域下的 Time、Memory 或 Stack 节点，可以编辑对应限制。这些限制编辑入口不会在 Actions 区域重复显示。

## 样例存储

- 手动粘贴：OI Judge 会把输入和期望输出存入 `.vscode/.OIJudge`。这适合较小样例。
- 新建托管样例默认使用 `.in` 作为输入文件，使用 `.out` 作为期望输出文件。已有旧 `.ans` 样例答案会继续兼容，但不会被重命名。
- 选择输入/输出文件：OI Judge 保存原始绝对文件路径，不复制文件。这适合大数据文件或已有本地测试数据。
- 外部样例依赖原始文件。如果外部输入或答案文件被移动或删除，样例会显示为 `Missing`，并在评测时跳过。
- 删除托管样例会删除 OI Judge 管理的 `.vscode/.OIJudge` 样例文件和生成输出。
- 删除外部样例只会删除 OI Judge 的样例记录和生成输出，原始输入/答案文件永远不会被删除。

## 批量添加样例

- 运行 `OI Judge: Batch Add Samples`。
- 输入输入文件后缀。默认是 `.in`；`in` 会被规范化为 `.in`。
- 输入答案文件后缀。默认是 `.out`；`ans` 会被规范化为 `.ans`。
- 选择样例文件夹。
- OI Judge 只扫描该文件夹第一层，并按 `basename + inputSuffix` 和 `basename + answerSuffix` 匹配文件。使用默认 `.out` 答案后缀时，如果同名 `.out` 缺失，OI Judge 会回退查找 `.ans`。
- 例如，`1.in` 与 `1.out`、`2.in` 与 `2.out` 会被添加为两个样例。
- 批量添加的样例是外部样例：OI Judge 只保存绝对路径，不复制或修改文件。
- 没有匹配答案文件的输入，以及重复的样例对，会被跳过并汇总提示。

## 样例名称

- 手动粘贴的样例保留默认 `Sample x` 名称。
- 从文件添加的样例使用输入文件 basename 作为显示名称。
- 例如，`book3.in` 与 `book3.ans` 会显示为 `book3`；`1.in` 与 `1.out` 会显示为 `1`。
- 批量添加的样例使用每组匹配文件的 basename 作为样例名。
- OI Judge 仍然使用稳定的内部 `id` 和 `index` 管理输出目录，例如 `outputs/sample-7/`，因此显示名称不会影响删除、报告或 diff 路径。
- 如果样例名已存在，OI Judge 会追加 ` (2)`、` (3)` 等后缀。

## 样例查看

- 样例输入、期望输出和运行结果会在 VS Code 原生文本编辑器中打开。
- 输出差异会使用 VS Code 原生 Diff Editor 打开。
- 新的按题目运行流程会把纯 stdout 保存在 `.vscode/.OIJudge/problems/<problemId>/outputs/sample-x/useroutput.txt`，用于评测和 diff。
- `Run Result` 会打开 `.vscode/.OIJudge/problems/<problemId>/outputs/sample-x/run-result.txt`，其中包含程序 stdout、程序 stderr，以及状态、退出码、信号、Runtime Error 详情等运行诊断信息。
- 独立的 `Open Stderr` 样例操作已移除；stderr 会通过 `Run Result` 查看。
- Checker 输出是独立的：checker stdout 和 stderr 会合并到 `checker-output.txt`，并通过 `Checker Output` 打开。
- `Diff` 和评测仍然使用纯 `useroutput.txt`；stderr 永远不会追加到该文件。
- 新的按题目运行流程还会在输出旁保留 `stderr.txt` 和 `diff.txt`，用于诊断和兼容。
- 旧的 `1.out`、`1.err` 和 `1.diff` 输出仍可读取，以保持兼容。

计时说明：样例耗时只统计用户可执行程序进程。Windows 上的样例耗时包含进程启动和管道 I/O 开销，因此极小程序也可能显示几十毫秒。

## Windows 栈大小

- Windows 上深递归程序可能以 `0xC00000FD` 退出，这是栈溢出异常。
- 默认情况下，OI Judge 会跟随题目的内存限制，并在 Windows 编译时为 MinGW/g++ 添加链接器参数。
- 当 `memoryMb = 256` 时，生成的参数是 `-Wl,--stack,268435456`。
- 点击题目 Limits 区域下的 Stack 节点，或运行 `OI Judge: Set Stack Size`，可以选择 `Follow Memory Limit`、`Custom Stack Size` 或 `Disable Auto Stack Size`。
- 栈参数在编译时生成，不会反复插入 `compile.args`。
- 如果启用自动栈大小，已有的 `-Wl,--stack,...` 参数会被当前设置替换。如果禁用自动栈大小，OI Judge 不会添加栈参数。
- 这主要面向 Windows + MinGW/g++。Linux/macOS 评测环境通常通过 runner 或系统限制控制栈；从算法上避免过深递归仍然是最稳妥的选择。

## Runtime Error 解释

- OI Judge 会根据进程退出码或 POSIX 信号解释常见 Runtime Error。
- Runtime Error 名称使用常见 OI/OJ 风格英文描述，例如：
  - Stack overflow
  - Access violation
  - Integer divide by zero
  - Floating point exception
  - Segmentation fault
- 中文界面会保留英文 Runtime Error 标题，并在下方补充中文说明、可能原因和建议。
- 常见 Windows 示例：
  - `0xC00000FD`：Stack overflow
  - `0xC0000005`：Access violation
  - `0xC0000094`：Integer divide by zero
- 常见 Linux/macOS 信号：
  - `SIGSEGV`：Segmentation fault
  - `SIGFPE`：Floating point exception
  - `SIGABRT`：Aborted
- 这些解释只是诊断提示，不是最终证明。需要时仍应结合输入文件、stderr、复现命令和调试器判断。

## 评测模式

- OI Judge 为每个题目支持三种评测模式：
  - 文本比较：严格比较输出。
  - 文本比较（忽略行末空格和文末回车）：OI 常用默认方式，忽略每行末尾空白和文件末尾换行，但不忽略行首空格、行中空格或中间空行。
  - 自定义 Checker
- 在文本比较模式下，Checker 相关操作会从题目 Actions 区域隐藏，以保持侧边栏简洁。
- 点击题目下的 Judge Mode 节点，可以在严格文本比较、OI 风格文本比较和自定义 Checker 之间切换。
- 自定义 Checker 模式会启用 Checker 操作，并支持：
  - Testlib Checker
  - Plain Checker
- 如果题目仍处于文本比较模式，而你运行 `OI Judge: Set Checker`，OI Judge 会询问是否先切换到自定义 Checker。
- 切回文本比较模式不会删除已保存的 Checker 配置，因此之后可以再切回来，无需重新选择 Checker。

### 函数式交互评测

函数式交互评测适用于 grader 型题目：grader 提供 `main()`，选手代码实现指定函数。OI Judge 会将 grader 和选手代码一起编译，再像普通题一样运行样例，并继续使用现有文本比较或 checker 流程。

在题目配置中设置 `mode: "function"` 以及 `functionStyle.grader` / `functionStyle.solution` 后，运行 `OI Judge: 运行函数式交互评测`。

### I/O 交互评测

I/O 交互评测适用于常见的 solution + interactor 双进程模型。OI Judge 会分别编译选手程序和 interactor，每个测试点启动一组新进程，将 `solution.stdout` 接到 `interactor.stdin`，将 `interactor.stdout` 接到 `solution.stdin`，并在报告中保存受限长度的 transcript。

在题目配置中设置 `mode: "interactive"` 以及 `interactive.solution` / `interactive.interactor` 后，运行 `OI Judge: 运行 I/O 交互评测`。

```json
{
  "mode": "interactive",
  "interactive": {
    "solution": "solution.cpp",
    "interactor": "interactor.cpp",
    "interactorArgs": ["{input}", "{answer}"],
    "transcriptLimitBytes": 262144
  }
}
```

Interactor 可以通过 `{input}` 获取测试点输入文件路径，通过 `{answer}` 获取答案文件路径。选手程序 stdout 是交互协议内容，因此 I/O 交互评测不会再走普通文本比较或 checker。Interactor exit code `0` 表示 Accepted，`1` 表示 Wrong Answer，`2` 表示 Presentation Error，其它非零值报告为 Interactor Error。

#### testlib 风格交互器

对于 Codeforces / Polygon 风格的交互器，可以使用 `testlib` preset：

```json
{
  "mode": "interactive",
  "interactive": {
    "solution": "solution.cpp",
    "interactor": "interactor.cpp",
    "interactorPreset": "testlib",
    "interactorArgs": ["{input}", "{output}", "{answer}"],
    "useTestlib": true,
    "testlibHeader": "third_party/testlib.h"
  }
}
```

`{input}` 表示测试点输入文件，`{output}` 表示 OI Judge 为交互器创建的临时输出文件，`{answer}` 表示测试点答案文件。I/O 交互评测不会自动为 interactor 选择内置 `testlib.h`；如果交互器需要它，请在 workspace 中提供，并配置 `testlibHeader` 或 `testlibIncludeDirs`。该 preset 只适配 testlib-like 参数习惯，不承诺完整 testlib 兼容。

可以参考 `examples/interactive/testlib-like-double/`，其中包含完整的 testlib-like 参数示例，展示 `{input}`、`{output}`、`{answer}` 的用法。默认示例使用 `useTestlib: false`，不需要官方 `testlib.h`；单独的 `oijudge.testlib.config.json` 只作为用户自行提供 `third_party/testlib.h` 时的参考配置。

#### 最小猜数交互器

典型交互题可以通过 `{input}` 将原始测试点输入文件传给交互器。例如猜数交互器可以读取 `n secret`，先把 `n` 发给选手程序，再对每次 flush 后的猜测返回 `1`、`-1` 或 `0`，并用退出码给出结果：`0` 表示 Accepted，`1` 表示 Wrong Answer，`2` 表示 Presentation Error，`3` 表示 Interactor Error。

#### 示例

可以参考 `examples/interactive/guess-number/` 中的最小猜数交互题。交互器通过 `{input}` 接收测试点输入文件路径，通过 stdin/stdout 与选手程序通信，并使用退出码给出评测结果。

## I/O 模式

- 每个题目可以使用 `Standard IO` 或 `File IO`。
- `Standard IO` 是默认模式：OI Judge 通过 stdin 输入样例，并把 stdout 捕获为 `useroutput.txt`。
- `File IO` 用于使用 `problem.in` 和 `problem.out` 等文件的程序。
- 在 File IO 模式下，OI Judge 会为每个样例创建隔离的临时运行目录：
  - `.vscode/.OIJudge/problems/<problemId>/outputs/sample-<index>/run/`
  - 将样例输入写入配置的输入文件名
  - 以该运行目录作为 `cwd` 运行可执行文件
  - 在进程结束后读取配置的输出文件
  - 将该文件内容保存回标准的 `useroutput.txt`
- Diff、普通比较、testlib Checker、Plain Checker 和结果面板都会继续使用 `useroutput.txt`。
- File IO 模式下的程序 stdout 只用于诊断；如果配置的输出文件缺失，stdout 不会被当作评测输出。
- 文件名必须是 `problem.in` 这样的简单名称；绝对路径、文件夹和 `..` 都会被拒绝。
- OI Judge 永远不会在源文件目录、工作区根目录、样例目录或 checker 目录中创建配置的输入/输出文件。

File IO 示例程序：

```cpp
#include <bits/stdc++.h>
using namespace std;

int main() {
    freopen("problem.in", "r", stdin);
    freopen("problem.out", "w", stdout);
    int a, b;
    cin >> a >> b;
    cout << a + b << "\n";
}
```

## 出题人模式

- Setter Mode 默认关闭。
- 可以在 VS Code 设置中启用：
  - `oijudger.setterMode.enabled`
- 启用后，OI Judge 会为每个题目显示出题人工具：
  - Select STD
  - Open STD
  - Clear STD
  - Generate Answer with STD
  - Generate All Sample Answers with STD
  - View Current Answer
  - View Generated Answer
  - Compare Generated Answer
  - Apply Generated Answer
  - Apply All Generated Answers
  - Delete Generated Answer
  - Add Generator / Open Generator / Remove Generator
  - Add Global Generator Input / Open Global Generator Input / Remove Global Generator Input
  - Bind Generator 和 Generator Input 到 Subtask
  - Set Sample Name
- `STD` 是出题人的标准程序。它与用于评测当前解法的默认程序分开保存。
- OI Judge 可以运行绑定的 STD，为单个样例或全部样例生成答案。
- 如果当前答案路径为空、答案文件不存在或答案文件为空，STD 生成输出会直接写入当前答案。
- 如果当前答案已有内容，STD 生成输出会作为 pending generated answer 暂存到 `setter.generatedAnswers`。
- 暂存的新生成答案可以查看、与当前答案对比、逐个应用、全部应用或删除。
- 在 Setter Mode 中编辑的样例名只是显示名/数据配置名，不会改变 `sample.id`、`sample.index`、真实输入/答案文件或 `outputs/sample-<index>/`。
- 出题数据配置保存在 `setter.dataCases` 中。
- OI Judge 支持 `setter.generator.generators` 中的题目级 Generator、`generatorInputs` 中的全局 Generator input，以及 Subtask 级 Generator input 绑定。
- 可以从题目或 Subtask 操作中生成样例输入。

## Subtask 与计分

- 题目可以新建、重命名和删除 Subtask。删除 Subtask 只删除分组记录，不删除样例。
- 样例可以移动到某个 Subtask，也可以移回未分组区域。
- 每个 Subtask 保存 `sampleIds`、可选 `lastResult`、可选 Generator 绑定、可选 Generator input，以及计分模式。
- Subtask 可以独立评测。侧边栏会显示上次 Subtask 运行的通过/失败状态和 `passed/total`。
- 题目总分默认是 `100`，可以通过 `OI Judge: Set Total Score` 修改。
- 每个样例可以设置测试点分值。未设置分值的样例会自动平分剩余分值。
- `sum` Subtask 按通过的样例累计得分。
- `bundle` Subtask 只有全部样例通过时才获得该 Subtask 的全部分数。
- 可以通过配置启用 Subtask Skip：当 `bundle` 子任务已经失败时跳过剩余测试点，也可以在前置子任务未通过时跳过依赖子任务。默认关闭，因此旧配置仍会运行全部测试点。

```json
{
  "subtaskSkip": {
    "enabled": true,
    "skipRemainingCasesOnFailure": true,
    "skipDependentSubtasks": true
  },
  "subtasks": [
    {
      "id": "subtask1",
      "name": "Subtask 1",
      "sampleIds": ["sample-1", "sample-2"],
      "scoringMode": "bundle"
    },
    {
      "id": "subtask2",
      "name": "Subtask 2",
      "sampleIds": ["sample-3", "sample-4"],
      "scoringMode": "bundle",
      "dependsOn": ["subtask1"]
    }
  ]
}
```

如果 `subtask1` 中某个测试点失败，该 `bundle` 子任务剩余测试点会显示为 `Skipped`。如果 `subtask1` 未通过，依赖它的 `subtask2` 会直接跳过，并在报告中显示依赖失败原因。不存在的 dependency id 和依赖环会作为配置错误报告，不会死循环。

## Stress Test / 对拍

- `OI Judge: Run Stress Test` 支持两种对拍方式。
- 分文件对拍：Generator + STD + Solution。适合将生成器、标程、待测程序分别写成三个文件。插件会自动运行生成器生成输入，再分别运行 STD 和待测程序，并比较输出。
- 单文件对拍（考场式）。适合常见的考场 stress.cpp 写法。你可以在一个程序里自行生成数据、运行暴力/正解和待测逻辑、比较答案。插件只负责编译并运行这个程序，并保存 stdout / stderr / summary。
- 可使用“对拍当前代码”将最近在编辑区聚焦的已打开 `.cpp` 文件作为待测程序，并使用当前题目配置的 Generator 和 STD 进行分文件对拍。
- 对拍运行中可点击 `$(debug-stop) 停止对拍` 中断当前对拍，适合没有自动停止逻辑的单文件考场式 stress.cpp。
- 失败用例会保存在 `.vscode/.OIJudge/stress/` 下，包含输入、STD 输出、待测输出、stderr 文件和 `summary.json`。
- `Stress Records` 视图可以打开保存文件、把失败用例加入样例、重新运行失败用例、刷新记录，并打开 session 文件夹。

### 保存失败用例为样例

当评测报告或对拍记录中出现失败用例时，可以使用 **保存为样例**，将输入和期望输出保存到 `samples/` 目录，方便后续反复调试。

## 环境自检

- 运行 `OI Judge: 检查运行环境`，或点击 OI Judge 侧边栏工具栏中的环境自检入口。
- 该命令会检查当前平台、带空格的临时目录、编译器发现、C++17 编译、可执行程序运行、stdin/stdout、文件 IO、native runner、用时/内存采集和停止进程能力。
- 检查完成后会把详细纯文本报告写入 `OI Judge` OutputChannel，并提供“打开报告”“复制报告”“打开输出”按钮。
- 自检用到的源码、可执行文件、输入输出文件和 native runner helper 都会放在临时目录中，结束后自动清理，不污染用户 workspace。
- 如果缺少必要工具，报告会给出平台相关建议，例如 Windows 安装 MinGW-w64 并加入 PATH、macOS 安装 Xcode Command Line Tools、Linux 安装 `g++`。

## 平台支持

OI Judge 支持 Windows、macOS 和 Linux。编译器要求、已测试功能和常见问题见：[平台支持说明](docs/platform-support.zh-CN.md)。

如果 OI Judge 在你的机器上无法正常运行，请先执行：

`OI Judge: 检查运行环境`

然后复制环境检查报告并反馈给维护者。

## 测试点导出

- `OI Judge: Export Testcases` 可以复制或移动样例输入/输出文件，并写出 `.OIJudge/config.json` 导出记录。
- Luogu 导出可以生成 `config.yml`。
- Polygon 导出可以生成 OI Judge import plan `polygon.json` 和简短说明。
- LemonLime 导出可以生成 `contest.cdf`、`data/<problemName>/`、`source/` 和简短说明。
- 如果配置了分值或 bundle Subtask，导出元数据会在目标格式支持时携带样例分值和 bundle Subtask 分组信息。

## 完整题目包导出

- `OI Judge: Export Problem Package` 与 Testcase Export 不同。Testcase Export 主要导出测试点文件和平台配置。
- Problem Package Export 会把完整出题资料复制到一个目录，便于备份、迁移、分享，以及后续实现导入。
- 导出目录包含 statement、source、STD、checker、generator、samples、Subtasks、scores 和 OI Judge 配置快照。
- 第一版导出为目录，包含 `oijudge-package.json` 和 `README.txt`，不生成 zip。

## 完整题目包导入

- `OI Judge: Import Problem Package` 可以导入由 OI Judge 导出的完整题目包目录。
- 导入后会在当前工作区创建新的 problem。
- 文件会复制到当前工作区 `.vscode/.OIJudge/` 下，导入后的 problem 不依赖原 package 目录。
- 第一版只支持目录导入，不支持 zip。

## Testlib Checker

- OI Judge 支持按题目配置的 testlib 风格 Checker。
- 运行 `OI Judge: Set Checker`，选择 `Testlib checker`，然后选择本地 `checker.cpp`。
- 典型 checker 会包含 `#include "testlib.h"` 并调用 `registerTestlibCmd(argc, argv)`。
- OI Judge 会按如下方式运行 checker：

```text
checker.exe input.txt useroutput.txt answer.txt
```

- `testlib.h` 会按以下顺序解析：
  - 与 `checker.cpp` 相同的文件夹
  - 工作区根目录
  - `.vscode/.OIJudge/tools/testlib/testlib.h`
  - checker 配置中记录的自定义路径
- OI Judge 可以安装扩展随附的 `testlib.h`，也可以导入用户选择的本地副本。
- 用户提供的副本一旦安装到工作区，仍然具有更高优先级。
- OI Judge 不会下载或生成 `testlib.h`。如果缺失，请运行 `OI Judge: Import testlib.h`。
- 当随附资源可用时，`OI Judge: Import testlib.h` 会提供：
  - `Install bundled testlib.h`
  - `Import testlib.h from local file`
- 随附源码和许可证细节保存在 `resources/testlib/README.md` 和 `resources/testlib/LICENSE`。
- Checker 可执行文件会构建在 `.vscode/.OIJudge/problems/<problemId>/checker/` 下。
- Checker stdout 和 stderr 会合并为每个样例输出旁边的 `checker-output.txt`。
- testlib checker 经常把 verdict 细节输出到 stderr；用户仍可通过单个 `Checker Output` 操作查看所有 checker 信息。
- Plain Checker verdict 解析仍然只使用原始 stdout 中配置的 verdict 行。合并后的 stderr 内容只用于查看，不会被解析为 verdict。
- Verdict 规则：
  - checker 退出码 `0` => `AC`
  - checker 退出码 `1` => `WA`
  - Windows NTSTATUS 异常码，例如 `0xC0000135` => `Checker Error`
  - checker 编译/运行/超时失败 => `Checker Error`
- Windows DLL 说明：
  - 如果 checker 以 `3221225781` / `0xC0000135` 退出，通常表示 `checker.exe` 因缺少运行时 DLL 而无法启动，不表示 checker 判了 `WA`。
  - 常见缺失 DLL 包括 MinGW 的 `libstdc++-6.dll`、`libgcc_s_seh-1.dll` 和 `libwinpthread-1.dll`。
  - OI Judge 会尝试使用 MinGW/g++ 静态链接编译 checker，并把编译器 `bin` 目录加入 checker 进程 `PATH` 前部。
  - 你也可以把 MinGW `bin` 目录加入 `PATH`，用静态链接重新构建 checker，或把缺失 DLL 放到 `checker.exe` 旁边。
- 未启用 checker 时，普通比较行为不变。
- Plain Checker 支持通过 stdout verdict 行输出数字分数。

## Plain Checker

Plain Checker 是一种不依赖 `testlib.h` 的简单自定义 checker。

OI Judge 使用与 testlib checker 相同的参数运行它：

```text
checker.exe input.txt useroutput.txt answer.txt
```

默认协议读取 stdout 最后一行非空内容。该行必须是以下之一：

- `AC`
- `WA`
- 一个数字分数

也可以运行 `OI Judge: Set Plain Checker Protocol` 来配置：

- 从第一行还是最后一行非空 stdout 读取 verdict
- accepted token，默认 `AC`
- wrong-answer token，默认 `WA`

示例：

```text
AC
```

这会把样例标记为通过。

```text
WA
```

这会把样例标记为答案错误。

```text
37.5
```

这会返回 `37.5` 分。OI Judge 会显示问号图标，并在右侧显示 `37.5`。它不会把样例标记为通过或错误。

重要说明：如果你想返回 WA，请输出配置的 wrong-answer token。如果输出 `0`，OI Judge 会把它当作分数 `0`，而不是 WA。如果输出 `100`，OI Judge 会把它当作分数 `100`，而不是 AC。

默认协议下，无效 verdict 行包括：

- `Accepted`
- `Wrong Answer`
- `75%`
- `score: 75`
- `通过`

这些会被报告为 `Checker Error`。

自定义协议示例：

- Verdict line：`First non-empty line`
- Accepted token：`OK`
- Wrong answer token：`NG`

```text
OK
details...
```

这会把样例标记为通过。

```text
NG
wrong answer details...
```

这会把样例标记为答案错误。

```text
37.5
matched 15 cases
```

这会显示问号图标和分数 `37.5`。数字 verdict 行总会被当作分数，因此 accepted/wrong token 应配置为非数字字符串。

最小 Plain Checker 示例：

```cpp
#include <bits/stdc++.h>
using namespace std;

int main(int argc, char** argv) {
    if (argc < 4) {
        cout << "WA\n";
        return 0;
    }

    ifstream user(argv[2]);
    ifstream ans(argv[3]);

    long long a, b;
    user >> a;
    ans >> b;

    cout << (a == b ? "AC" : "WA") << '\n';
    return 0;
}
```

计分示例：

```cpp
#include <bits/stdc++.h>
using namespace std;

int main(int argc, char** argv) {
    ifstream user(argv[2]);
    ifstream ans(argv[3]);

    int correct = 0, total = 10;
    for (int i = 0; i < total; i++) {
        int x, y;
        if (!(user >> x)) break;
        ans >> y;
        if (x == y) correct++;
    }

    cout << fixed << setprecision(1) << correct * 10.0 << '\n';
    return 0;
}
```

如果最后一行是 `70.0`，OI Judge 会显示问号图标和分数 `70.0`。

## 命令

- 基础评测：`Init Problem`、`Add Sample`、`Run All Samples`、`Set Time Limit`、`Set Memory Limit`、`Set Stack Size`、`Select C++ Compiler`、`Open Last Report`、`Open Result Panel`、`Clear Outputs`。
- 题目工作流：`Create Problem`、`Add Problem From Current File`、`Add Problem From File`、`Import Legacy Single Problem`、`Delete Problem`、`Add Program`、`Set Default Program`、`Run With Program`、`Bind Statement`、`Open Statement`、`Unbind Statement`。
- 样例：`Add Problem Sample`、`Add Problem Sample From Files`、`Batch Add Samples`、`Open Sample Input`、`Open Expected Output`、`Open Run Result`、`Open Diff`、`Delete Sample`。
- 出题人模式：`Select STD`、`Open STD`、`Clear STD`、`Auto Generate Output with STD`、`Generate Answer with STD`、`Generate All Sample Answers with STD`、`View Current Answer`、`View Generated Answer`、`Compare Generated Answer`、`Apply Generated Answer`、`Apply All Generated Answers`、`Delete Generated Answer`。
- Generator：`Add Generator`、`Open Generator`、`Remove Generator`、`Select Generator`、`Open Generator`、`Clear Generator`、`Add Global Generator Input`、`Open Global Generator Input`、`Remove Global Generator Input`。
- Subtask 与计分：`Create Subtask`、`Rename Subtask`、`Delete Subtask`、`Move to Subtask`、`Run Subtask`、`Set Subtask Scoring Mode`、`Set Total Score`、`Set Testcase Score`、`Clear Testcase Score`、`Bind Generator`、`Bind Generator Input`、`Open Generator Input`、`Clear Generator Input`、`Generate Subtask Sample Input`。
- 对拍与导出：`Run Stress Test`、`Refresh Stress Records`、`Open Stress File`、`Add to Samples`、`Rerun This Case`、`Reveal Session Folder`、`Export Testcases`、`Export Problem Package`、`Copy freopen Input Snippet`。
- Checker：`Set Checker`、`Set Plain Checker Protocol`、`Clear Checker`、`Open Checker`、`Import testlib.h`、`Open testlib.h`、`Open Checker Output`。

默认编译器命令是 `g++`。可以编辑 `.vscode/.OIJudge` 来调整每个题目的编译参数。

## 开发

在项目根目录运行：

```powershell
npm install
npm run compile
npm test
npm.cmd run test:cross-platform
npm.cmd run test:report-ui
npm pack --dry-run
```

`test:cross-platform` 用于检查 Judge、对拍、停止对拍和报告产物生成在当前平台上的基本可用性。`test:report-ui` 会运行轻量级报告 HTML smoke test。GitHub Actions 会在 Windows / Linux / macOS 上运行这些跨平台回归测试，并上传结果 JSON 和报告 HTML 作为 artifact。

在 VS Code 中按 F5，并选择 `Run OI Judge Extension`，即可打开扩展开发宿主窗口。

