# Privacy and security model

Pi TimeLens is local observability software. It contains no analytics SDK, network client, remote collector, model call, or background upload.

## Data flow

TimeLens receives Pi lifecycle events and derives timing metadata. It can persist:

- display-only custom timing entries in Pi's existing session file;
- user settings in `$PI_CODING_AGENT_DIR/message-timing.json`;
- user-requested JSON or CSV exports under `$PI_CODING_AGENT_DIR/state/private/message-timing-exports/`.

It also emits the process-local `message-timing:state` event for optional footer integrations.

## What records can contain

- record, cycle, turn, batch, and tool-call identifiers;
- wall-clock timestamps and monotonic durations;
- status and failure/abort counts;
- tool names, but not tool arguments or output;
- provider-reported numeric token and cost fields;
- billing mode.

## What records and exports exclude

- user prompts;
- assistant text or reasoning;
- tool arguments;
- tool output;
- credentials and provider configuration;
- file contents;
- arbitrary unknown fields attached to timing records.

Export serializers rebuild every record from explicit allowlists, including nested batch members and usage objects.

## Model-context boundary

Pi custom entries may be stored and rendered without becoming model messages. TimeLens uses display-only entries and does not call `sendMessage`, alter `context`, or register a context hook. Its telemetry is for the local UI and optional local extensions only.

## Local execution boundary

All Pi extensions execute inside the Pi process and therefore have the same local authority as Pi. This is not a sandbox guarantee. Review the source and npm provenance before installation, pin versions when required, and follow Pi's package security guidance.

## Deletion

1. Remove the package with `pi remove npm:pi-timelens`.
2. Delete `message-timing.json` if you want to remove settings.
3. Delete `state/private/message-timing-exports/` if you want to remove exports.
4. Existing timing records remain part of existing Pi session history; delete those sessions using your normal Pi session-retention process.
