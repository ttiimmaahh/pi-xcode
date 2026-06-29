# Release checklist

Use this checklist before publishing `pi-xcode`.

## Version and metadata

- [ ] Confirm `package.json` version is correct.
- [ ] Confirm package name is `pi-xcode` or intentionally scoped.
- [ ] Confirm npm package availability/ownership.
- [ ] Confirm `description`, `keywords`, `license`, `repository`, `bugs`, `homepage`, `files`, `bin`, and `engines` are correct.
- [ ] Confirm `LICENSE` is present and correct.
- [ ] Confirm `CHANGELOG.md` has release notes for the version.

## Local validation

Run from a clean checkout/install:

```bash
npm ci
npm run typecheck
npm run build
npm run smoke
npm pack --dry-run --json
```

Inspect the pack output and confirm it includes:

- `dist/**`
- `README.md`
- `LICENSE`
- `CHANGELOG.md`
- `docs/**`
- `package.json`

## Manual Xcode validation

Use `docs/xcode-test-checklist.md`.

Required before release:

- [ ] Xcode launch/echo test passes.
- [ ] Provider/model selection is correct in debug log.
- [ ] Project summary works.
- [ ] `XcodeRead` works.
- [ ] `XcodeGrep` works.
- [ ] Safe `XcodeWrite` create/delete test works.
- [ ] MCP tool allowlist works.
- [ ] Cancellation does not hang Xcode.
- [ ] Session close/process shutdown does not leave obvious stale `mcpbridge` processes.

## Publish dry run

```bash
npm pack --dry-run --json
```

Optionally install the generated tarball into a temporary project:

```bash
npm install -g ./pi-xcode-<version>.tgz
pi-xcode --help
```

## Publish

Only after all checks pass:

```bash
npm publish
```

For first public release, consider publishing with provenance if the package is released from CI.
