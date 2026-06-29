# Changelog

## 0.2.3 - 2026-06-29

Improves Xcode ACP integration for plan-mode workflows, Claude-compatible tool names, artifacts, and local release validation.

### Added

- Advertise and handle ACP session modes for `default` and `plan`.
- Add `/plan` handling that switches Pi into read-only plan mode before implementation.
- Add Claude-compatible planning tools and aliases:
  - `EnterPlanMode` / `enter_plan_mode`
  - `ExitPlanMode` / `exit_plan_mode`
- Present approved plans with ACP `switch_mode` permission requests using the plan markdown as tool-call content, matching the shape Xcode uses for plan review.
- Add `ask_user_question` / `AskUserQuestion` ACP bridge.
  - Uses ACP `elicitation/create` form mode when Xcode advertises/supports it.
  - If Xcode returns `Method not supported by client: elicitation/create`, falls back to a manual chat prompt that prints the questions and answer choices so the user can reply normally.
  - This preserves the expected rich-Q&A path for when Xcode enables ACP elicitation for custom agents.
- Add Claude-compatible `TodoWrite` / `todo_write` bridge that sends ACP `sessionUpdate: "plan"` progress updates.
- Add Claude-compatible `WebSearch` / `web_search_alias` compatibility tools that steer Claude-style prompts toward Pi's native `web_search` tool.
- Add ACP diff artifact mapping for Pi `edit` and `write` tool inputs where possible.
- Preserve file/line context from ACP resource links when Xcode sends line metadata.
- Add `pi-xcode --version` for checking installed versions.
- Add README update instructions for standalone global npm installs.
- Add Vitest coverage for ACP bridge helpers and include tests in `npm run check`.

### Changed

- `npm run check` now runs typecheck, unit tests, build, and smoke test.
- Plan mode now keeps question, plan-enter, plan-exit, todo, and web-search compatibility tools available while blocking edit/write/bash-like tools before approval.

### Notes

- Xcode 27 beta currently does not advertise ACP `clientCapabilities.elicitation.form` to this custom ACP agent in local testing, and rejects `elicitation/create`. The `ask_user_question` bridge therefore prints manual answer instructions today, while retaining the ACP elicitation implementation so rich Q&A should start working automatically if Apple enables it for custom ACP agents.
- `WebSearch` is currently a compatibility alias, not a full web-search implementation. Prefer Pi's native `web_search` for actual web research.

## 0.2.2 - 2026-06-29

Documentation update for public setup.

### Changed

- Make README setup instructions user-agnostic.
- Add clearer Xcode configuration steps for installed npm package users.
- Document how to find the `pi-xcode` executable path with `command -v pi-xcode`.
- Document how to find the Node interpreter path with `node -p 'process.execPath'`.
- Clarify that Node.js 20+ is required and Node 24 is recommended.

## 0.2.1 - 2026-06-29

Release-cycle validation update for the scoped npm package.

### Changed

- Publish package as `@ttiimmaahh/pi-xcode` because npm blocks the unscoped `pi-xcode` name as too similar to unrelated package `pixcode`.
- Keep the installed executable/bin name as `pi-xcode`.
- Document the Xcode 27+ requirement more explicitly; Xcode 26 and earlier cannot run custom ACP agents.
- Update release workflow to publish the scoped package with `npm publish --access public`.

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
