# Repository Instructions

- For this repository, use Codegraph first when exploring architecture, locating symbols, tracing callers/callees, investigating bugs, or assessing refactor impact.
- Prefer `mcp__codegraph.codegraph_explore` for broad codebase questions, then `mcp__codegraph.codegraph_node`, `codegraph_callers`, `codegraph_callees`, or `codegraph_impact` when a specific symbol needs deeper inspection.
- Treat source returned by Codegraph as already read for that turn; do not re-open the same files unless the file may have changed or Codegraph output was insufficient.
- When committing changes for GitHub pushes, write commit messages bilingually in the format `English/中文`; if there are multiple message items, put one bilingual item per line using the same format.
