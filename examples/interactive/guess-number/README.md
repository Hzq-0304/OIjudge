# Guess Number I/O Interactive Example

This directory is a minimal runnable example for **I/O Interactive Judge**. It models a classic guess-number interactive task with one contestant solution process and one interactor process.

## Files

- `solution.cpp`: Accepted solution. It binary-searches the hidden number and flushes every guess with `std::endl`.
- `solution-wa.cpp`: Wrong Answer solution. It makes one guess and stops early.
- `solution-timeout.cpp`: No-flush / timeout solution. It writes a guess without flushing and then sleeps.
- `interactor.cpp`: Interactor. It reads the original testcase input path from `{input}`, talks to the solution through stdin/stdout, and exits with a verdict code.
- `samples/*.in`: Testcase input files. Each file contains `n secret`.
- `oijudge.config.json`: Example OI Judge config for this directory.

## Protocol

Each testcase input contains:

```text
n secret
```

For example:

```text
100 73
```

The interactor:

1. Reads `n secret` from the input file path passed as `{input}`.
2. Sends `n` to the solution.
3. Reads each flushed `guess` from the solution.
4. Replies with:
   - `0` when the guess is correct.
   - `1` when the guess is too small.
   - `-1` when the guess is too large.
5. Exits with:
   - `0` for Accepted.
   - `1` for Wrong Answer.
   - `2` for Presentation Error.
   - `3` for Interactor Error.

The solution stdout is protocol traffic. It is not compared as the final answer. The interactor decides the verdict with its exit code.

## Trying Other Outcomes

`oijudge.config.json` points to `solution.cpp` by default. To observe other behavior, change `interactive.solution`:

- Use `solution-wa.cpp` to observe Wrong Answer.
- Use `solution-timeout.cpp` to observe timeout / no-flush behavior.

After running `OI Judge: Run I/O Interactive Judge`, open the report and expand a testcase. The transcript shows both directions of communication:

- `interactor -> solution`
- `solution -> interactor`

## testlib-like Args

Codeforces / Polygon style interactors can use the `testlib` preset with `{input}`, `{output}`, and `{answer}`. `{output}` is a temporary file created by OI Judge for interactor logs or checker-style output and is shown in report diagnostics. This example keeps the simpler `{input}` args, but the same protocol can be configured with:

```json
{
  "interactive": {
    "interactorPreset": "testlib",
    "interactorArgs": ["{input}", "{output}", "{answer}"],
    "useTestlib": false
  }
}
```

I/O Interactive Judge does not automatically select a bundled `testlib.h` for interactors. If your interactor includes it, add it to your workspace and configure `testlibHeader` or `testlibIncludeDirs`.

Current MVP scope: this example uses the solution + interactor two-process model only. Multi-role communication problems and full testlib interactive compatibility are not implemented.

