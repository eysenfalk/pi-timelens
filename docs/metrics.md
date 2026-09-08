# Metric definitions

Pi TimeLens separates measurements that are often collapsed into one misleading latency number.

## Clock model

- Visible start and end timestamps use wall-clock time.
- Every elapsed duration uses a monotonic clock.
- Duration values remain valid when NTP, daylight-saving changes, virtualization, or manual clock updates move wall time.

## Assistant step

| Metric | Definition |
| --- | --- |
| Duration | From Pi's assistant turn start to its final assistant message event |
| TTFT | From assistant turn start to the first meaningful provider output event |
| Stream | Duration minus TTFT |
| Tokens/s | Provider-reported output tokens divided by streaming seconds |

Tokens/s is unavailable when output-token usage or a positive streaming interval is unavailable. It is never calculated from total or input tokens.

## Tool execution

A single tool record measures `tool_execution_start` to `tool_execution_end`. A tool is failed when Pi reports an error or its result matches Pi's canonical failure contract. Aborted results remain distinguishable from failures.

Model-backed tools contribute usage only when their result reports it. Ordinary tools omit token and price fields because the tool execution itself consumed no model usage; the assistant step that requested the tool remains accounted separately.

## Tool batches

A turn with multiple tools produces one consolidated record after the last result.

- `wall`: the union of all member execution intervals; overlap is counted once.
- `work`: the sum of every member duration; overlap is counted for each worker.
- Member order follows Pi's source order, not completion order.
- Compact mode shows at most one token-and-price aggregate for the entire batch, summed only from member tools that report usage.
- Ordinary member rows contain timing and status only. Detailed mode retains each reporting tool's individual usage for attribution.
- Assistant-step usage is never copied into the batch, which prevents misattribution and double-counting.

For intervals `[0, 100]` and `[20, 80]`, wall is 100ms and work is 160ms.

## Request cycle

A cycle starts when a user submission is accepted and ends when Pi reports `agent_settled`.

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

When subscription and metered sources mix, token totals include every reported source while cost includes only the metered subtotal. Compact output labels this `$… + sub`; summaries show `Billing: mixed` plus `Metered cost`. A subscription provider's informational cost metadata is never presented as payable. Reports then avoid double-counting usage already nested in cycle or batch records.
