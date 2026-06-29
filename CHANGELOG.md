# Changelog

## 0.2.0 - 2026-06-29

First release candidate for `pi-xcode` as an Xcode-focused ACP adapter for Pi.

### Added

- Xcode Intelligence ACP adapter executable (`pi-xcode`).
- Pi SDK-backed sessions using normal Pi provider/model/thinking settings by default.
- Xcode argument overrides for provider, model, thinking level, Pi tool allowlist, and Pi tool denylist.
- Debug logging to `~/.pi/agent/pi-xcode/debug.log` with launch, ACP, Pi session, provider/model, MCP, prompt, and error diagnostics.
- User-visible Pi/provider error messages streamed back to Xcode.
- Xcode MCP bridge support for stdio MCP servers, including Xcode's `xcode-tools` server via `xcrun mcpbridge`.
- Native Xcode MCP tool exposure as Pi custom tools, preserving names such as `XcodeRead`, `XcodeWrite`, `XcodeGrep`, and `XcodeGlob`.
- Xcode MCP tool filtering options:
  - `--no-xcode-mcp`
  - `--xcode-mcp-tools <list>`
  - `--exclude-xcode-mcp-tools <list>`
- Manual Xcode validation checklist.

### Validated manually in Xcode

- Xcode launches local `dist/cli.js` with an explicit Node interpreter.
- Pi summarizes an Xcode project codebase.
- `XcodeRead` reads project files.
- `XcodeWrite` safely creates and deletes a test file.
- `XcodeGrep` searches project files.
- Xcode MCP tool allowlisting exposes only selected tools.

### Notes

- Compatibility is intentionally targeted at Xcode first, not all ACP clients.
- MCP support currently targets stdio MCP servers.
- `session/load` and `session/resume` are not advertised yet.
