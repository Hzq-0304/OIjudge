# OIjudger

OIjudger is a VSCode extension for local OI-style sample judging.

First-version features:

- Initialize `.oitest/config.json`
- Add multiple samples under `.oitest/samples`
- Add samples by pasting text or selecting input/output files
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
