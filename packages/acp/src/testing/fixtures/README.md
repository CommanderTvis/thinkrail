# The ACP frame corpus

Each `*.json` file here is an ordered list of JSON-RPC frames as they would cross the stdio pipe
between ThinkRail and an ACP agent:

```json
[{ "direction": "in", "frame": { "jsonrpc": "2.0", "method": "session/update", "params": {} } }]
```

`in` is a frame the agent sent us, `out` is one we sent the agent. `loadFixtures()` turns each entry
into the same `FrameRecord` the recorder writes, so a fixture and a real capture go through exactly the
same classification, validation and replay code.

## What these fixtures are, and what they are not

**They are synthetic.** Every frame was written by hand. Nothing here came off a real agent.

**They are schema-valid.** `conformance.test.ts` validates each frame against
`@agentclientprotocol/sdk/schema/schema.json` — the SDK's own published schema, an artifact we did not
author — using the definition for that frame's direction, kind and method. Several of these fixtures
were wrong when first written and the schema said so; what is committed is what the schema accepts.

**They prove totality, not fidelity.** The corpus is asserted to cover *exactly* the variant set the
schema declares for `SessionUpdate.sessionUpdate`, `ToolKind`, `ToolCallStatus`, `ContentBlock.type`,
`ToolCallContent.type` and `StopReason`. So a protocol variant nothing here exercises fails the build.
What it cannot tell you is how a real agent actually uses the protocol — which fields it populates in
practice, in what order it emits chunks, where it disagrees with its own schema. **Only a captured
corpus proves that**, and capturing one is a single command.

## Capturing a real session

Point `THINKRAIL_ACP_RECORD_DIR` at a directory and run anything that drives a real agent:

```sh
THINKRAIL_ACP_RECORD_DIR=/tmp/acp-capture bun run e2e:agent
```

One JSONL file per agent connection lands in that directory, one record per line:

```json
{ "at": 1755691200123, "direction": "in", "raw": "{\"jsonrpc\":\"2.0\",...}" }
```

The variable is the whole switch — `recordFramesFromEnv` returns the spawner untouched when it is
unset, so a composition root wires it once and unconditionally.

Then replay a capture with no process and no network:

```ts
import { readFrameRecords, replayFile, validateFrame, classifyFrames } from "@thinkrail/acp/testing";

const events = replayFile("/tmp/acp-capture/2026-08-20T12-00-00-000Z-pi-1.jsonl");
```

To turn a capture into a fixture, convert its lines to `{ direction, frame }` entries, trim it to the
turn worth keeping, and scrub paths, tokens and anything else the agent echoed from your machine. The
conformance test picks up any `*.json` file in this directory automatically.
