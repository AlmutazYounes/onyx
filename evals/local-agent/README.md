# Local agent

Measures how well Onyx's local model does real coding work through OpenCode, and how long it takes. Each case copies a small project to a temp folder, runs `opencode run` with Onyx's own config, instructions and default agent items (imported from source), then checks the result with a command.

It also records every model request through a loopback proxy: how long Ollama took to read the prompt, how much of the prompt was new, and how fast it wrote. A request that reads its prompt far faster than fresh tokens allow reused Ollama's cached prefix. This is what makes a turn start in under a second instead of 10 to 15.

## Run it

Needs Ollama with the model installed (`scripts/l3-setup.sh`) and OpenCode 2 at `/opt/homebrew/bin/opencode`. It costs nothing but time: about two minutes a case.

```bash
cd evals
pnpm local-agent --out runs/qwen
pnpm local-agent --out runs/laguna --model onyx-laguna --baseline runs/qwen
pnpm local-agent --out runs/one --case fix-three-bugs --samples 3
```

Flags: `--out` (required), `--model` (an Ollama model in Onyx's picker, default `onyx-qwen`), `--case`, `--samples`, `--baseline <earlier run>`, `--search on|off` (Onyx's code search, default on), `--thinking on|off` (`off` asks the model to skip reasoning), `--repair-reads on|off` (Onyx's fix for read calls that name a line range OpenCode ignores, default on), `--thinking-budget <tokens>` (thinking a reply may do before Onyx retries it without thinking, default 6000, `0` turns it off), `--save-request` (keeps each sample's last model request, tools and history included, as `last-request.json`), `--config-patch <json>`, `--instructions <file>` (agent instructions to try in place of Onyx's), `--opencode <binary>`, `--timeout-minutes`.

A run writes `results.jsonl` and `summary.md`, plus for each sample the OpenCode events, the final answer, every model request (`requests.json`) and `check.txt`, the credit for each criterion with the changes the agent made. Runs share the machine with Onyx, so close agent threads first or timings will include their work.

## Scoring

Pass or fail alone hides most of what changes between runs, so each case lists named criteria and a run earns a score from 0 to 100:

- **Work** criteria are the task itself. A `check` is met or not; a `tests` command prints TAP (`node --test --test-reporter=tap`, or `$EVAL_TOOLS/pytap.py` for Python) and earns the share of tests that pass. Credit counts only past where the untouched project already stood, which the runner grades once per case before any agent runs, so a run that changes nothing scores 0 even when a hidden suite has regression checks that already pass.
- **Guard** criteria (`"guard": true`) are what must stay true: tests still pass, no unrelated files changed, the diff stays small. They earn nothing on their own; the share of guard weight still held scales the work credit down.

The summary also shows how the agent worked: prompt tokens, characters of tool output, repeated reads of an unchanged file, unranged reads of files over 400 lines, and failed tool calls. Two runs with the same score can still differ a lot in cost.

## Cases

Each case is a folder in `cases/`: `case.json` (`source`, `prompt`, `criteria`), `repo/` (the project the agent starts in), and an optional `check/` folder copied in only after the agent finishes, for tests it must not see. Criteria run with `sh` in the project; `$EVAL_ANSWER` is the agent's final text. A new case should come with a reference solution, kept out of the repository, that scores 100, and its hidden tests should fail on the untouched project.

| Case                        | Tests                                                                                       |
| --------------------------- | ------------------------------------------------------------------------------------------- |
| `fix-three-bugs`            | Fix three bugs against visible failing tests                                                |
| `add-json-flag`             | Add a feature end to end, checked by hidden tests                                           |
| `rename-across-files`       | Find every use of a function across files and change its meaning                            |
| `python-pagination`         | Off-by-one bugs in Python                                                                   |
| `explain-without-editing`   | Control: answer a question and change nothing                                               |
| `read-line-range`           | Read lines past OpenCode's 2,000-line read cap                                              |
| `find-*`                    | Find code by what it does in a pinned checkout of this repo                                 |
| `edit-local-context-window` | Change a setting where it is defined, in that same checkout                                 |
| `document-server-files`     | Long task: document every file in a folder, more than the context holds                     |
| `debug-root-cause`          | Hard: two root causes from a customer report that names no files, past a misleading comment |
| `feature-reservations`      | Hard: one feature across store, report, CLI and saved state, with expiry                    |
| `spec-csv-query`            | Hard: implement a 12-requirement spec; one hidden test per requirement                      |
| `minimal-fix`               | Scope: fix one bug in a messy file without rewriting the rest                               |

A case with `"checkout": "<commit>"` in `case.json` runs in a clone of this repository at that commit instead of `repo/`, about 30,000 files, so search matters.

Fixtures are deliberately buggy sample code, so lint and formatting skip `cases/`. The runner stops if a run ever changes a fixture itself.
