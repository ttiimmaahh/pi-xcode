# Xcode MCP implementation note

## SDK API

Use `@modelcontextprotocol/sdk` as a direct dependency.

Planned imports for the current package shape:

```ts
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
```

The current MCP TypeScript SDK docs show the client flow:

1. Construct `new Client({ name, version })`.
2. Construct `new StdioClientTransport({ command, args, env, stderr: "pipe" })`.
3. `await client.connect(transport)`.
4. `await client.listTools()` with cursor pagination if needed.
5. `await client.callTool({ name, arguments })`.
6. `await client.close()` on session close/dispose.

## Xcode MCP server launch

Xcode sends an ACP `mcpServers` entry named `xcode-tools` during `session/new`.
Observed shape:

```json
{
  "name": "xcode-tools",
  "command": "xcrun",
  "args": ["mcpbridge"],
  "env": [
    { "name": "MCP_XCODE_PID", "value": "..." },
    { "name": "MCP_XCODE_SESSION_ID", "value": "..." }
  ]
}
```

`xcrun mcpbridge --help` confirms that without a subcommand it acts as a stdio bridge between MCP clients and Xcode's MCP tool service. The env variables are optional but should be forwarded exactly from ACP.

For v0.2, connect only stdio MCP servers, starting with `xcode-tools`. Log and skip `http`, `sse`, and `acp` MCP server entries.

## Pi custom tool schema fit

Pi `ToolDefinition.parameters` is typed as TypeBox `TSchema`. MCP tool `inputSchema` is JSON Schema. TypeBox schemas are JSON Schema-compatible, so the first implementation can pass MCP `inputSchema` through as `ToolDefinition.parameters` with a narrow cast, as long as it is an object schema. If Xcode returns schemas that Pi validation rejects, add a conversion/sanitization layer.

Recommended first-pass fallback: if an MCP tool lacks an object `inputSchema`, expose it with an empty object schema and pass raw arguments through via `prepareArguments`.

## Tool adaptation

For each MCP tool:

- Preserve the MCP tool name exactly, e.g. `XcodeRead`, `XcodeWrite`, `XcodeGrep`, `XcodeGlob`.
- Create a Pi `customTools` entry with:
  - `name`: MCP name
  - `label`: MCP name
  - `description`: MCP description or fallback
  - `parameters`: MCP `inputSchema` cast/sanitized to TypeBox schema
  - `execute`: call `client.callTool({ name, arguments: params })`
- Convert MCP content into Pi tool result content:
  - text content → `{ type: "text", text }`
  - image content → `{ type: "image", data, mimeType }`
  - unknown structured content → JSON text fallback
- Include raw MCP result details in the Pi tool result `details` for debugging.

## Lifecycle

`PiSessionManager.createSession()` should accept `mcpServers` from `XcodeAgent.newSession()`.

Per managed session:

1. Connect MCP managers before creating the Pi session.
2. Pass MCP-adapted tools through `createAgentSessionFromServices({ customTools })`.
3. Store the MCP manager on `ManagedPiSession`.
4. On `session/close`, cancellation, or process shutdown, abort/close MCP clients.

## Open risk

The exact Xcode MCP tool schemas and content payloads still need to be observed from a real Xcode session. The first coded slice should therefore log discovered tool names, descriptions, and input schemas before relying on model behavior.
