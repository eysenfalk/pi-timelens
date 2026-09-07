# Performance

Pi TimeLens performs local bookkeeping and string formatting only. It contains no network client, analytics, or model invocation.

## Reproduce

```bash
npm ci
npm run benchmark
```

The benchmark warms the runtime, then creates, settles, and formats 20,000 synthetic assistant cycles with provider usage. It enforces a deliberately loose 500-microsecond safety budget so unusually severe regressions fail without pretending that one machine defines universal performance.

## Reference result

| Date | Node | Host | Iterations | Mean |
| --- | --- | --- | ---: | ---: |
| 2026-09-07 | 24.20.0 | x86_64 AMD EPYC 9634 | 20,000 | 6.30µs/cycle |

This is a pure-core microbenchmark. It does not measure provider latency, terminal rendering, filesystem latency, or Pi's own event dispatch. Compare results on the same host and runtime before drawing conclusions.
