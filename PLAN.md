# pi-xcode Roadmap

`pi-xcode` is an Xcode-focused ACP adapter that lets Xcode Intelligence run the Pi coding agent.

## 0.2.0 release scope

Completed and manually validated:

- Xcode launches `pi-xcode` over ACP stdio.
- Pi uses normal session persistence and provider/model/thinking settings by default.
- Xcode argument rows can override provider, model, thinking, Pi tools, and Xcode MCP tools.
- Extension-registered providers are loaded before model selection.
- Debug logs are written to `~/.pi/agent/pi-xcode/debug.log` without corrupting ACP stdout.
- User-visible Pi/provider errors are streamed back to Xcode.
- Xcode's `xcode-tools` stdio MCP server is connected via `xcrun mcpbridge`.
- Native Xcode MCP tools are exposed to Pi as custom tools.
- `XcodeRead`, `XcodeWrite`, `XcodeGrep`, and Xcode MCP tool allowlisting have been manually validated.

## Known limitations

- Xcode-first support; this is not intended to be a universal ACP adapter.
- MCP support currently targets stdio servers, especially Xcode's `xcode-tools` server.
- `session/load` and `session/resume` are not advertised yet.
- Audio prompt blocks are omitted with a text note.
- Tool-call UI mapping is pragmatic and may be refined after broader Xcode testing.

## Future work

- Add session load/resume support if Xcode UX benefits from it.
- Add richer ACP tool-call update rendering for Xcode-native operations.
- Add optional Xcode-specific Pi package resources, such as a skill or prompt guidance, if real usage shows the model needs it.
- Add more automated tests around MCP tool filtering and adapter behavior.
- Revisit MCP support for non-stdio transports only if Xcode or a concrete integration requires it.
