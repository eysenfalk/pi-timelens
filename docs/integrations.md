# Footer integrations

Pi TimeLens works independently. Footer extensions can optionally consume its process-local, content-free state events without importing TimeLens source or reading session files.

## Events

- State updates: `message-timing:state`
- Replay request: `message-timing:request-state`

A consumer should subscribe to state updates, register its replay listener, and emit the replay request once. TimeLens answers with its latest state.

## State shape

```ts
interface MessageTimingState {
  schemaVersion: 1;
  active: boolean;
  phase?: "assistant" | "tools" | "waiting";
  elapsedMs?: number;
  activeTool?: string;
  activeTools?: string[];
  activeToolCount?: number;
  usage?: ProviderUsage;
  text?: string;
  lastCycle?: {
    durationMs: number;
    usage?: ProviderUsage;
    billingMode: "metered" | "subscription" | "mixed" | "unknown";
    status: "success" | "failed" | "aborted";
  };
  session: {
    cycles: number;
    assistantSteps: number;
    tools: number;
    usage?: ProviderUsage;
    cost?: number;
    billingMode?: "metered" | "subscription" | "mixed" | "unknown";
    failures: number;
    aborted: number;
  };
}
```

Consumers must tolerate unknown fields and missing optional fields. Treat the schema version as a compatibility boundary. `session.billingMode` is an additive schema-V1 field and remains optional for compatibility with older producers; when present, it identifies whether `session.cost` is a metered amount or a mixed session's metered subtotal. `ProviderUsage.reasoning`, when present, is a provider-reported subset of output and total tokens rather than an additional token category. Subscription sessions omit cost. Do not infer absent token categories as zero, and do not persist the `text` presentation field as a data contract.

## Responsibility split

TimeLens owns historical timing records and measurement semantics. A footer owns live status layout, responsive prioritization, and any integration with other status providers. This prevents duplicated transcript records and keeps the timing package footer-agnostic.
