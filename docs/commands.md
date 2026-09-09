# Commands and settings

Pi TimeLens registers one command namespace: `/timing`. Commands operate on Message Timing custom entries in the current session branch; they never inspect prompts, assistant text, tool arguments, or tool output.

## Reports

### `/timing summary`

Shows aggregate cycles, assistant steps, tools, failures, aborts, model and tool time, wait time, provider-reported usage, and cost or subscription mode for the current branch.

### `/timing timeline`

Shows source-ordered Step and cycle records. Each Step contains its model turn and ordered tool contributions; legacy assistant, tool, and batch entries remain readable. The timeline is intentionally diagnostic and keeps member-level attribution.

### `/timing legend`

Explains Step, Total, first-output latency, tool wall time, cached tokens, provider-reported cost, and expanded diagnostics. It also notes that compact entries omit subscription labels while expanded entries retain billing scope.

## Display settings

```text
/timing settings
/timing settings display compact
/timing settings display detailed
/timing settings display off
/timing settings live on
/timing settings live off
/timing settings cost on
/timing settings cost off
/timing settings milliseconds on
/timing settings milliseconds off
```

| Setting | Default | Meaning |
| --- | --- | --- |
| `display` | `compact` | Concise Step/Total summaries, always-expanded diagnostics, or hidden transcript timing |
| `live` | `on` | Show the content-free live phase and elapsed time |
| `cost` | `on` | Show provider-reported cost when available |
| `milliseconds` | `on` | Preserve milliseconds in expanded wall-clock timestamps; short elapsed durations remain precise |

Settings are stored as JSON in `message-timing.json` under `PI_CODING_AGENT_DIR`, which defaults to `~/.pi/agent`.

## Safe exports

```text
/timing export json
/timing export csv
```

Exports include bounded timing metadata: schema and record identities, Step relationships, timestamps, durations, status, tool names and IDs, numeric usage, numeric cost, and billing mode. JSON nests model and tool contributions under each Step; CSV links child rows with `parentStepId`. Explicit allowlists strip unknown top-level and nested fields.

Files are written with mode `0600` to:

```text
$PI_CODING_AGENT_DIR/state/private/message-timing-exports/
```

Exports are branch-local snapshots. Pi TimeLens never uploads them.
