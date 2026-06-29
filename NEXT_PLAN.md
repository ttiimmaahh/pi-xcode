# pi-xcode Release Plan

## Current status

`pi-xcode` is preparing for a `0.2.0` release candidate.

Validated in Xcode:

- Xcode launches local `dist/cli.js` when configured with an explicit absolute Node interpreter.
- Xcode Arguments must be entered as one argv token per row.
- Pi creates normal persistent sessions for the Xcode project cwd.
- Provider/model/thinking overrides from Xcode arguments work.
- Extension-registered Pi providers such as `sap-aicore-foundation` work because session creation uses `createAgentSessionServices()` before `createAgentSessionFromServices()`.
- Debug logging and user-visible Pi/provider error reporting work.
- Xcode sends an MCP server named `xcode-tools` with command `xcrun`, args `["mcpbridge"]`, and `MCP_XCODE_PID` / `MCP_XCODE_SESSION_ID` env values.
- `pi-xcode` connects Xcode's stdio MCP server and exposes native Xcode tools as Pi custom tools.
- `XcodeRead` inspected Swift project files.
- `XcodeWrite` safely created and deleted a test file.
- `XcodeGrep` searched project files.
- Xcode MCP tool allowlisting worked with only `XcodeRead`, `XcodeGrep`, and `XcodeGlob` exposed.

## Completed phases

### Phase 1 — Stabilize MVP

Completed:

- README updated with real Xcode setup.
- Debug logging improved.
- User-visible Pi/provider error reporting added.
- Manual Xcode checklist added.
- Validation commands pass:

```bash
npm run typecheck
npm run build
npm run smoke
npm pack --dry-run --json
```

### Phase 2 — Xcode MCP bridge

Completed:

- MCP SDK spike documented in `docs/mcp-implementation-note.md`.
- stdio MCP client manager implemented.
- Xcode MCP tools adapted into Pi custom tools.
- MCP tools wired into session creation and lifecycle cleanup.
- MCP tool filtering added:
  - `--no-xcode-mcp`
  - `--xcode-mcp-tools <list>`
  - `--exclude-xcode-mcp-tools <list>`
- Manual Xcode read/search/write/filtering tests passed.

## Phase 3 — Release hardening

### Done

- Version bumped to `0.2.0`.
- `CHANGELOG.md` added.
- `docs/release-checklist.md` added.
- GitHub Actions CI workflow added at `.github/workflows/ci.yml`.
- Package `files` includes `dist`, `docs`, `README.md`, `CHANGELOG.md`, `LICENSE`, and `package.json`.

### Remaining before publish

1. Confirm final GitHub repository URL and initialize/move into a git repository if needed.
2. Confirm npm package availability/ownership for `@ttiimmaahh/pi-xcode`.
3. Run release checklist from a clean checkout/install:

   ```bash
   npm ci
   npm run typecheck
   npm run build
   npm run smoke
   npm pack --dry-run --json
   ```

4. Run final manual Xcode checklist in `docs/xcode-test-checklist.md`.
5. Inspect package tarball contents.
6. Decide publish command and provenance strategy.

## Known limitations for 0.2.0

- Xcode-first compatibility; not intended as a universal ACP adapter.
- MCP support targets stdio MCP servers, especially Xcode's `xcode-tools` server.
- `session/load` and `session/resume` are not advertised yet.
- Audio prompt blocks are omitted with a text note.
- Tool-call translation is pragmatic and may be refined after more Xcode UI testing.
