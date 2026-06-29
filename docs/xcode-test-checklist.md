# Xcode manual test checklist

Use this checklist after `npm run build` and after configuring Xcode Intelligence with the local `dist/cli.js` executable plus an explicit Node interpreter.

Before each run, pass `--debug` and watch:

```text
~/.pi/agent/pi-xcode/debug.log
```

## 1. Echo test

Prompt Xcode:

```text
Reply with exactly: PI_XCODE_ECHO_OK
```

Expected:

- Xcode displays exactly `PI_XCODE_ECHO_OK` or a trivially formatted equivalent.
- Debug log has fresh `session/prompt`, `ACP session/update`, and `session/prompt completed` entries.
- Final ACP stop reason is `end_turn`.

## 2. Model verification

Prompt Xcode:

```text
Say which model/provider you are using if known, then stop.
```

Expected:

- Debug log `Created Pi session` shows the intended `provider`, `model`, and `thinkingLevel`.
- If using Xcode argument overrides, debug log `parsedOptions` matches the Xcode rows.
- No unexpected `Pi model fallback` entry appears.

## 3. Project-context summary

Prompt Xcode:

```text
Summarize this Xcode project from the context Xcode provided. Do not edit files.
```

Expected:

- The response references the current project/app at a high level.
- It can use Xcode-provided prompt context even before MCP support exists.
- Debug log shows a non-zero prompt text length.

## 4. Xcode MCP tool discovery

Prompt Xcode:

```text
What Xcode MCP tools are available to you? Then use XcodeRead or XcodeGrep to inspect one project file.
```

Expected:

- The response lists native Xcode tools such as `XcodeRead`, `XcodeWrite`, `XcodeGrep`, and `XcodeGlob`.
- Debug log includes `Connecting MCP stdio server`, `Listed MCP tools`, `Selected Xcode MCP tools`, and `Adding MCP custom tools to Pi session`.
- At least one `Calling Xcode MCP tool` entry appears.

## 5. XcodeGrep test

Prompt Xcode:

```text
Use XcodeGrep to search for a known symbol in this project. Tell me which files match. Do not edit files.
```

Expected:

- The response reports matching project files.
- Debug log includes a successful `Calling Xcode MCP tool` / `Xcode MCP tool result` pair for `XcodeGrep`.

## 6. Filesystem/tool test

Prompt Xcode:

```text
List the current working directory with Pi tools and identify the project root path. Do not edit files.
```

Expected:

- Tool-call status appears in Xcode, if Xcode renders ACP tool updates.
- Debug log includes `ACP session/update` entries for tool calls.
- The reported cwd matches the Xcode project root or the configured session cwd.

## 7. Safe Pi edit test

Prompt Xcode:

```text
Create a file named PI_XCODE_TEST.md in the project root containing one line: pi-xcode safe edit test. Then delete it.
```

Expected:

- Xcode shows edit/tool activity.
- The file is gone at the end of the turn.
- Debug log shows completed tool updates, not failed tool updates.
- `git status --short` does not show `PI_XCODE_TEST.md`.

## 8. Safe Xcode MCP write/delete test

Prompt Xcode:

```text
Use XcodeWrite to create PI_XCODE_MCP_TEST.md in the project root with one line: pi-xcode MCP write test. Then read it back with XcodeRead. Finally delete it. Do not modify any other files.
```

Expected:

- Xcode shows MCP write/read/delete activity.
- Debug log includes successful MCP tool result entries.
- The file is gone at the end of the turn.
- `git status --short` does not show `PI_XCODE_MCP_TEST.md`.

## 9. Xcode MCP filtering test

Configure Xcode Arguments with:

```text
--debug
--xcode-mcp-tools
XcodeRead,XcodeGrep,XcodeGlob
```

Prompt Xcode:

```text
List the Xcode tools available to you and search for a known symbol. Do not edit files.
```

Expected:

- The response can use read/search tools.
- Write/build/run/device tools are not available.
- Debug log `Selected Xcode MCP tools` shows only the allowlisted tools.

## 10. Cancellation test

Prompt Xcode:

```text
Think step by step for a long time about ten different implementation strategies, but do not edit files.
```

Cancel the request from Xcode shortly after it starts.

Expected:

- Xcode stops the turn without hanging.
- Debug log has `session/cancel` and `session/prompt cancelled` or a completed prompt with ACP stop reason `cancelled`.
- A later short echo prompt still works in the same or a new conversation.

## 11. Error visibility test

Temporarily configure an invalid provider/model or invalid credentials, then send a short prompt.

Expected:

- Xcode receives a visible text chunk similar to:

  ```text
  Pi request failed using <provider>/<model>:
  <error>

  See ~/.pi/agent/pi-xcode/debug.log for details.
  ```

- Debug log contains the full error details.
- `session/prompt completed` maps the final ACP stop reason to `end_turn` after the visible error text.

## Notes

Xcode provides an `xcode-tools` MCP server with native tools such as `XcodeRead`, `XcodeWrite`, `XcodeGrep`, and `XcodeGlob`. `pi-xcode` connects that server by default when Xcode sends it.

Use these arguments to narrow or disable the Xcode MCP tool surface:

```text
--no-xcode-mcp
--xcode-mcp-tools XcodeRead,XcodeGrep,XcodeGlob
--exclude-xcode-mcp-tools XcodeWrite,UpdateTargetBuildSetting
```
