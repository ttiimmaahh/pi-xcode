# pi-xcode

Use the [Pi coding agent](https://www.npmjs.com/package/@earendil-works/pi-coding-agent) as a custom ACP agent in Xcode Intelligence.

`pi-xcode` is intentionally focused on Xcode. It speaks the Agent Client Protocol (ACP) shape Xcode expects over stdio, then embeds Pi through the Pi SDK. It is not currently intended to be a universal ACP compatibility layer for every ACP client.

## Status

`pi-xcode` 0.2.0 is a release candidate validated as an Xcode-launched ACP adapter:

- Xcode can add and launch `pi-xcode` as an ACP agent.
- Xcode conversations stream Pi responses.
- Pi runs in the Xcode project working directory.
- Provider/model overrides can be passed from Xcode argument rows.
- Pi extension-registered providers are loaded before model selection.
- Xcode-provided MCP tools are connected by default and manually validated for read, search, write/delete, and allowlist filtering.

## Requirements

- **Xcode 27 or newer.** Xcode custom ACP agents are an Xcode 27+ feature. Xcode 27 is currently beta-only; Xcode 26 and earlier cannot launch `pi-xcode` as an Intelligence custom agent.
- Node.js 20 or newer. Node 24 is used for local validation.
- A working Pi configuration with an authenticated provider/model.

## Install

For local development:

```bash
npm install
npm run build
```

After a public npm release, install with:

```bash
npm install -g pi-xcode
```

Make sure Pi itself is authenticated/configured before launching from Xcode:

```bash
pi
/login
```

or configure provider API keys in your shell environment / Pi auth storage.

## Xcode setup

> **Requires Xcode 27+.** If your Xcode Settings → Intelligence pane does not have custom agent support, you are probably running Xcode 26 or earlier. Install/use the Xcode 27 beta or newer before configuring `pi-xcode`.

### Local checkout setup

For the current local development build, configure Xcode with the built `dist/cli.js` file and an explicit Node interpreter.

1. Build `pi-xcode`:

   ```bash
   cd /Users/ttiimmaahh/Developer/gitroot/personal/pi-extensions/pi-acp
   npm install
   npm run build
   ```

2. Find your Node executable:

   ```bash
   which node
   ```

   With `nvm`, this is usually something like:

   ```text
   /Users/ttiimmaahh/.nvm/versions/node/v24.15.0/bin/node
   ```

3. Open Xcode Settings.
4. Go to **Intelligence**.
5. In **Agents**, click **Add an Agent…**.
6. Fill the sheet:

   - **Name:** `Pi`
   - **Executable:** `/Users/ttiimmaahh/Developer/gitroot/personal/pi-extensions/pi-acp/dist/cli.js`
   - **Interpreter:** your absolute Node path, for example `/Users/ttiimmaahh/.nvm/versions/node/v24.15.0/bin/node`
   - **Arguments:** optional; enter one argv token per Xcode row. See examples below.

Do not leave **Interpreter** blank for the local `dist/cli.js` setup. The script may work in Terminal while Xcode still fails to launch it without an explicit Node interpreter.

### Installed package setup

After global npm install, the executable is typically the `pi-xcode` bin path:

```bash
which pi-xcode
```

Use that path as **Executable**. If the bin is a JavaScript shim and Xcode does not launch it reliably, use an explicit absolute Node **Interpreter** as above.

## Xcode Arguments examples

Xcode Arguments are not a shell command line. Each row is one argv token. Put flags and values on separate rows unless you intentionally use a supported `--flag=value` form.

### Use Pi's normal defaults

Use your normal Pi configured provider/model/thinking settings:

```text
--debug
```

### SAP AI Core / extension-registered provider

```text
--debug
--provider
sap-aicore-foundation
--model
gpt-5.5
--thinking
high
```

### OpenAI

```text
--debug
--provider
openai
--model
gpt-5.2-codex
--thinking
high
```

### Cloudflare Workers AI

Cloudflare model ids can contain `/`, so pass provider and model separately:

```text
--debug
--provider
cloudflare-workers-ai
--model
@cf/openai/gpt-oss-120b
--thinking
medium
```

### Provider/model shorthand

When the model id itself does not contain `/` ambiguity for that provider, you can use shorthand:

```text
--debug
--model
openai/gpt-5.2-codex
--thinking
high
```

This is parsed as provider `openai`, model `gpt-5.2-codex`.

### Tool filters

By default, `pi-xcode` uses Pi's normal default tools plus Xcode MCP tools when Xcode provides them.

Filter Pi tools:

```text
--tools
read,bash,edit,write
```

```text
--exclude-tools
bash
```

Disable Xcode MCP entirely:

```text
--no-xcode-mcp
```

Allow only selected Xcode MCP tools:

```text
--xcode-mcp-tools
XcodeRead,XcodeGrep,XcodeGlob
```

Deny selected Xcode MCP tools while keeping the rest:

```text
--exclude-xcode-mcp-tools
XcodeWrite,UpdateTargetBuildSetting,DeviceInteractionStartSession
```

## CLI options

```text
--debug
--debug-log <path>
--provider <provider>
--model <model-or-provider/model>
--thinking <off|minimal|low|medium|high|xhigh>
--tools <comma,separated,allowlist>
--exclude-tools <comma,separated,denylist>
--no-xcode-mcp
--xcode-mcp-tools <comma,separated,allowlist>
--exclude-xcode-mcp-tools <comma,separated,denylist>
```

`--flag=value` is supported for value flags, but separate Xcode rows are easier to inspect and less error-prone.

## Debug logs

When `--debug` is passed, `pi-xcode` writes diagnostics to:

```text
~/.pi/agent/pi-xcode/debug.log
```

Override the location with:

```text
--debug-log
/tmp/pi-xcode-debug.log
```

`pi-xcode` never writes debug logs to stdout because stdout is reserved for ACP JSON-RPC messages.

The debug log includes:

- raw argv and parsed options
- Node version, executable path, and process cwd
- Xcode initialize client info/capabilities
- `session/new` cwd and Xcode MCP server metadata
- connected MCP servers and discovered Xcode MCP tool schemas
- selected/filtered Xcode MCP tools
- Pi service diagnostics and provider/model availability summaries
- selected provider/model/thinking and active tools
- prompt start/completion and final Pi stop/error details
- summarized ACP updates sent back to Xcode
- MCP tool call duration and error summaries

## Troubleshooting

### No fresh debug log entries

If `~/.pi/agent/pi-xcode/debug.log` has no fresh `Starting pi-xcode` entry, Xcode probably did not launch the adapter.

Check:

- **Executable** points to the local `dist/cli.js` or installed `pi-xcode` path.
- **Interpreter** is an absolute Node binary path for local `dist/cli.js`.
- `npm run build` was run and `dist/cli.js` exists.
- Arguments are one token per Xcode row.

### `initialize` appears but no `session/new`

Xcode launched the process but did not create a session. Re-open the Xcode Intelligence conversation or reselect the Pi agent, then inspect the log again.

### `session/new` appears but no `Created Pi session`

Pi session creation, extension loading, provider setup, or model selection failed. Inspect nearby `Pi service diagnostic`, `Pi model fallback`, or error entries in the debug log.

### Model falls back to Cloudflare/default unexpectedly

The requested provider/model settings were not applied or the provider was not registered/available. Confirm:

- argument rows parse as expected in the `parsedOptions` log entry
- extension-registered providers appear in the Pi provider summaries
- the `Created Pi session` entry shows the intended provider/model
- auth/config for that provider works in normal Pi

### Prompt reaches Pi but no visible Xcode response

If `session/prompt` appears but Xcode shows no response:

- inspect `session/prompt completed` for Pi stop/error details
- inspect `ACP session/update` entries to confirm chunks were sent to Xcode
- inspect the logged `sessionFile` for persisted Pi messages
- try a simple marker prompt from the manual checklist

### Xcode MCP tools are missing

Xcode sends an `xcode-tools` MCP server and prompt guidance for native tools such as `XcodeRead`, `XcodeWrite`, `XcodeGrep`, and `XcodeGlob`.

If those tools are missing:

- confirm `--no-xcode-mcp` is not set
- inspect `Connecting MCP stdio server` and `Listed MCP tools` debug entries
- check whether `--xcode-mcp-tools` allowlist excludes the desired tool
- check whether `--exclude-xcode-mcp-tools` denies the desired tool
- confirm Xcode sent an `xcode-tools` MCP server in `session/new`

## Xcode MCP tools

When Xcode provides the `xcode-tools` MCP server, `pi-xcode` connects it and exposes the native Xcode tools to Pi as custom tools. Tool names are preserved exactly.

Validated tools include:

- `XcodeRead` for reading project files
- `XcodeWrite` for safe file creation/update
- `XcodeGrep` for project search

Xcode may also expose build, run, test, device/simulator, target setting, entitlement, localization, documentation, and diagnostics tools. These can affect your project or connected devices. Use `--xcode-mcp-tools`, `--exclude-xcode-mcp-tools`, or `--no-xcode-mcp` if you want a narrower tool surface.

## Known limitations

- Compatibility is targeted at Xcode first, not every ACP client.
- MCP support currently targets stdio MCP servers, especially Xcode's `xcode-tools` server.
- Session persistence uses normal Pi session storage for the Xcode project `cwd`.
- `session/load` and `session/resume` are not advertised yet.
- Audio prompt blocks are currently omitted with a text note.
- Tool-call translation is intentionally pragmatic and may be refined after observing Xcode UI behavior.

## Development

```bash
npm install
npm run check
npm run pack:dry-run
```

The smoke client verifies ACP handshake and session creation without contacting a model by default. To run a real prompt smoke test, set:

```bash
PI_XCODE_SMOKE_PROMPT=1 npm run smoke
```

## Releasing

This repo follows the same tag-driven release process as the other `ttiimmaahh` Pi extensions:

1. Ensure `npm run check` and `npm run pack:dry-run` pass locally.
2. Update `CHANGELOG.md` for the release.
3. Run `npm version patch` (or `minor` / `major`) to update package metadata, create a commit, and tag `vX.Y.Z`.
4. Push with `git push --follow-tags`.
5. The tag-triggered GitHub Actions workflow verifies the tag, runs checks, publishes to npm using Trusted Publishing/OIDC, and creates a GitHub Release.

One-time npm setup: configure `ttiimmaahh/pi-xcode` and `.github/workflows/publish.yml` as a Trusted Publisher for the `pi-xcode` package on npmjs.com.

## License

MIT
