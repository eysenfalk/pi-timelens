# Metric definitions

Pi TimeLens separates measurements that are often collapsed into one misleading latency number.

## Clock model

- Visible start and end timestamps use wall-clock time.
- Every elapsed duration uses a monotonic clock.
- Duration values remain valid when NTP, daylight-saving changes, virtualization, or manual clock updates move wall time.

## Step

A Step groups one assistant turn with every tool it requests. Compact mode reports this user-facing unit rather than exposing separate lifecycle records.

| Metric | Definition |
| --- | --- |
| Duration | From Pi's assistant turn start through its final associated tool result |
| First | From assistant turn start to the first meaningful provider output event |
| Tool time | Union of the Step's tool execution intervals; overlap is counted once |
| Tokens | Assistant usage plus usage reported by model-backed tools in the Step, each source counted once |
| Billing | Metered provider cost, subscription, or the metered subtotal plus subscription for mixed Steps |

Expanded details retain the assistant duration, stream duration, output tokens/s, provider/model, stop reason, individual tools, and exact wall-clock timestamps. Tokens/s is unavailable when output-token usage or a positive streaming interval is unavailable. It is never calculated from total or input tokens.

## Tool execution

A tool contribution measures `tool_execution_start` to `tool_execution_end`. A tool is failed when Pi reports an error or its result matches Pi's canonical failure contract. Aborted results remain distinguishable from failures.

Pi's native tool card owns the compact identity, target, and outcome. TimeLens therefore shows the aggregate tool wall time on the Step and keeps individual names, IDs, durations, status, and reported usage in expanded details. Model-backed tools contribute usage only when their result reports it. Ordinary tools add timing but no fabricated token or price fields.

## Parallel tools

A turn with multiple tools still produces one Step after the last result.

- Compact mode shows the tool count and one elapsed tool duration.
- Expanded `wall` is the union of all member execution intervals; overlap is counted once.
- Expanded `work` is the sum of every member duration; overlap is counted for each worker.
- Expanded member order follows Pi's source order, not completion order.
- The Step's usage combines assistant and model-backed-tool reports with billing-aware de-duplication.
- Individual tool usage remains attributable in expanded details.

For intervals `[0, 100]` and `[20, 80]`, wall is 100ms and work is 160ms.

## Request cycle

A cycle starts when a user submission is accepted and ends when Pi reports `agent_settled`. Its compact `Total` prioritizes elapsed time, model time, tool wall time, aggregate tokens/cache, truthful billing, and recovery status. Counts, waits, and cumulative work remain in expanded details and reports.

The total breaks down into:

- assistant/model duration;
- tool wall and cumulative work;
- retry wait between a failed assistant step and the next step;
- extension UI wait while Pi waits for the user.

A later successful assistant step can recover a prior model or tool failure. The final record then uses `◆ Total` while preserving failure counts and retry wait. An abort is sticky, and an unrecovered terminal failure uses `◆ Failed`.

## Usage and billing

TimeLens normalizes only values reported by providers:

- input tokens;
- output tokens;
- cache-read tokens;
- cache-write tokens;
- total tokens;
- corresponding cost categories and total cost;
- subscription mode when Pi identifies non-metered billing.

A missing category remains missing. Zero means the provider explicitly reported zero. If a model-backed tool reports usage for multiple nested results, TimeLens sums those numeric reports once before the tool joins its batch. Direct aggregate usage takes precedence over nested result details, preventing duplicate accounting. Extraction is bounded to top-level `usage`, `details.usage`, and `details.results[].usage`; deeper arbitrary payloads are ignored.

When subscription and metered sources mix, token totals include every reported source while cost includes only the metered subtotal. Compact output labels this `$… + subscription`; summaries show `Billing: mixed` plus `Metered cost`. A subscription provider's informational cost metadata is never presented as payable. Reports avoid double-counting usage nested in Step or cycle records.
