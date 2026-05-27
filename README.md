# OIjudger

OIjudger is a VSCode extension for local OI-style sample judging.

First-version features:

- Initialize `.oitest/config.json`
- Create a problem without immediately binding a source file
- Bind a local statement file (`.md`, `.pdf`, or `.txt`) to a problem
- Add one or more C++ programs to a problem and choose a default program
- Add multiple samples under `.oitest/samples` or `.oitest/problems/<problemId>/samples`
- Add samples by pasting text or selecting input/output files
- Delete samples from the OIjudger sidebar
- Set time and memory limits
- Detect or select a local C++ compiler
- Compile the active C++ file with `g++`
- Run all configured samples
- Compare standard output
- Save user output and `.oitest/outputs/report.json`
- Show an `OIjudger` sidebar with current file, limits, sample status, and quick actions
- Open report and sample detail pages from the sidebar
- Switch UI text with `oijudger.language` (`auto`, `en`, `zh`)
- Manage multiple problems in one workspace with `.oitest/problems.json`
- Keep legacy single-problem `.oitest/config.json` data intact and import it when needed

Problem workflow:

- `OIjudger: Create Problem` creates a problem entry and its `.oitest/problems/<problemId>/` folders without requiring a source file.
- `OIjudger: Bind Statement` links a statement file. OIjudger stores the original file path only; it does not copy, modify, or delete the statement file.
- `OIjudger: Add Program To Problem` links a C++ program. Programs are path references only; source files are not copied into `.oitest`.
- `OIjudger: Set Default Program` chooses the program used by `Run All Samples`.
- `OIjudger: Run Samples With Program` lets you temporarily choose any linked or newly selected `.cpp` file for one run.
- `OIjudger: Add Problem From Current File` and `OIjudger: Add Problem From File` still work as shortcuts: they create a problem and set the selected file as the default program.

Sample storage:

- Paste manually: OIjudger stores the input and expected output inside `.oitest`. This is best for small samples.
- Select input/output files: OIjudger stores the original absolute file paths and does not copy the files. This is best for large data files or existing local test data.
- External samples depend on the original files. If an external input or answer file is moved or deleted, the sample is shown as `Missing` and skipped during judging.
- Deleting a managed sample removes the OIjudger-owned `.oitest` sample files and generated outputs.
- Deleting an external sample removes only the OIjudger sample record and generated outputs. The original input and answer files are never deleted.

Sample viewing:

- Sample input, expected output, and user output open in the native VSCode text editor.
- Output differences open with the native VSCode Diff Editor.
- New per-problem runs save user output as `.oitest/problems/<problemId>/outputs/sample-x/useroutput.txt`, with `stderr.txt` and `diff.txt` next to it.
- Older `1.out`, `1.err`, and `1.diff` outputs remain readable for compatibility.

Timing note: sample time only measures the user executable process. On Windows, sample time includes process startup and pipe I/O overhead, so very small programs may still show tens of milliseconds.

计时说明：样例时间只统计用户程序进程运行阶段。在 Windows 上，样例运行时间包含进程启动和管道 I/O 开销，因此极小程序也可能显示几十毫秒。

Commands:

- `OIjudger: Init Problem`
- `OIjudger: Add Sample`
- `OIjudger: Run All Samples`
- `OIjudger: Set Time Limit`
- `OIjudger: Set Memory Limit`
- `OIjudger: Open Last Report`
- `OIjudger: Clear Outputs`

The default compiler command is `g++`. You can edit `.oitest/config.json` to adjust compiler flags.

## Development

From the project root:

```powershell
npm install
npm run compile
npm pack --dry-run
```

Press F5 in VSCode and choose `Run OIjudger Extension` to open the Extension Development Host.
