# Testlib-like Double I/O Interactive Example

This directory is a complete lightweight example for **I/O Interactive Judge** with Codeforces / Polygon style testlib-like arguments.

The default configuration does **not** depend on the official `testlib.h`. It uses the same argument shape as a testlib interactor:

```json
["{input}", "{output}", "{answer}"]
```

## Files

- `solution.cpp`: Accepted solution. It reads `x` from the interactor and prints `2 * x`.
- `solution-wa.cpp`: Wrong Answer solution. It prints `2 * x + 1`.
- `interactor.cpp`: Runnable testlib-like interactor that does not include `testlib.h`.
- `interactor-testlib.cpp`: Reference source for users who provide their own `testlib.h`.
- `oijudge.config.json`: Default runnable config with `useTestlib: false`.
- `oijudge.testlib.config.json`: Reference config with `useTestlib: true` and `testlibHeader`.
- `samples/*.in`: Testcase input files.
- `samples/*.ans`: Expected answers read by the interactor.

## Protocol

The task is **Double It**.

Each testcase input contains:

```text
x
```

The expected answer is:

```text
2 * x
```

For each testcase:

1. The interactor reads `x` from `{input}`.
2. The interactor reads the expected value from `{answer}`.
3. The interactor sends `x` to the solution through stdout.
4. The solution reads `x` from stdin and prints its answer.
5. The interactor reads the solution output from stdin.
6. The interactor writes logs to `{output}`.
7. The interactor exits with:
   - `0` for Accepted.
   - `1` for Wrong Answer.
   - `3` for Interactor Error.

The solution stdout is protocol traffic. The interactor decides the verdict with its exit code.

## Placeholders

- `{input}`: the testcase input file path.
- `{output}`: a temporary output file created by OI Judge for this interactor run. The interactor can write logs or verdict details there, and the report can show that content.
- `{answer}`: the testcase answer file path.

When `interactorPreset` is `"testlib"` and `interactorArgs` is omitted, OI Judge uses:

```json
["{input}", "{output}", "{answer}"]
```

## `useTestlib`

`useTestlib: false`:

- Does not check for `testlib.h`.
- Does not inject the `testlibHeader` include directory.
- Works for handwritten interactors or interactors that only follow the testlib-like argument convention.
- This is what `oijudge.config.json` uses.

`useTestlib: true`:

- Checks `testlibHeader`.
- Adds the header directory to interactor compile include dirs.
- Requires you to provide `testlib.h` yourself.
- This is shown only as a reference in `oijudge.testlib.config.json`.

OI Judge does not bundle an official `testlib.h` for I/O interactive interactors in this example, and this directory intentionally does not include one.

## Running

Open this directory as a workspace or copy these files into an OI Judge problem workspace, then run:

```text
OI Judge: Run I/O Interactive Judge
```

To observe Wrong Answer, change `interactive.solution` in `oijudge.config.json` to `solution-wa.cpp`, or copy `solution-wa.cpp` over `solution.cpp`.

In the report, expand a testcase and inspect:

- Transcript
- Interactor output
- Solution stderr
- Interactor stderr

## Scope

This example demonstrates the solution + interactor two-process model and testlib-like argument passing. It does not implement multi-role communication problems, and it does not promise full testlib compatibility.
