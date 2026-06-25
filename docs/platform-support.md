# Platform Support

Supported platforms:

- Windows
- macOS
- Linux

## Recommended Environment

### Windows

- Recommended compiler: MinGW-w64 / g++.
- Add the compiler `bin` directory to `PATH` so VS Code and OI Judge can find `g++`.
- Stopping processes depends on `taskkill` or the existing Windows kill helper used by OI Judge.

### macOS

- Recommended compiler: Xcode Command Line Tools / clang++.
- Install the command line tools with:

```sh
xcode-select --install
```

- macOS memory collection uses `ru_maxrss` in bytes.

### Linux

- Recommended compiler: g++.
- Install it through your package manager, for example `apt`, `pacman`, or `dnf`.
- Linux memory collection uses `ru_maxrss` in KiB, which OI Judge converts to bytes.

## Tested Features

The current cross-platform regression suite covers:

- Judge
- Multiple testcase / subtask reports
- Report rendering
- Checker
- Function-style Judge
- I/O Interactive Judge
- Generator + STD
- Split-file stress test
- Single-file contest-style stress test
- Stop Stress Test
- Stress Records
- Test Current Code
- Stress Test Current Code
- Environment Check
- Native runner time / memory collection

## Common Issues

- `g++` / `clang++` cannot be found.
- C++17 compilation fails.
- Compilation fails when paths contain spaces.
- `taskkill` is unavailable on Windows.
- macOS and Linux report memory differently.
- File IO uses the wrong working directory.
- A program runs forever or cannot be stopped.
- GitHub Actions and local machines may report slightly different time / memory values.

## I/O Interactive Judge Scope

The current I/O Interactive Judge support is an MVP for the solution + interactor two-process model. The solution stdout is connected to the interactor stdin, the interactor stdout is connected to the solution stdin, and the interactor decides the verdict through its exit code.

Reports show the interaction transcript, solution stderr, interactor stderr, interactor output from `{output}`, and process diagnostics. See `examples/interactive/guess-number/` for a minimal runnable guess-number example.

The testlib-like preset supports argument-mode Codeforces / Polygon style interactors with `{input}`, `{output}`, and `{answer}`. If `interactorArgs` is omitted while `interactorPreset` is `testlib`, OI Judge uses `["{input}", "{output}", "{answer}"]`. `{output}` is a per-testcase temporary file for interactor logs or verdict details.

`useTestlib` is optional. When it is `false`, OI Judge does not check `testlib.h` and does not inject the `testlibHeader` include directory. When it is `true`, provide `testlib.h` through `testlibHeader` or `testlibIncludeDirs`; OI Judge does not bundle an official `testlib.h` for I/O interactive interactors. See `examples/interactive/testlib-like-double/` for a complete runnable testlib-like argument example and a separate `testlib.h` reference config.

This mode is covered by Windows, macOS, and Linux cross-platform regression tests. It does not yet implement multi-role communication problems, and it does not promise full testlib interactive compatibility.

## Troubleshooting

If OI Judge does not work on your machine, run:

```text
OI Judge: Check Environment
```

Then copy the generated environment check report and share it with the maintainer.

