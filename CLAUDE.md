# PixelLab Forge MCP

MCP server for the PixelLab pixel art generation API. 66 tools covering image generation, characters, animation, tilesets, editing, rotation, and more.

## Project Structure

```
src/
  index.ts       - MCP server setup, tool registration via low-level Server API
  tools.ts       - All 66 tool definitions with JSON schemas and handlers
  api-client.ts  - PixelLab REST client with auto-polling, retry, and job logging
  job-log.ts     - Persistent job log for crash recovery (stored in OS temp dir)
  save-images.ts - Auto-saves base64 images from responses to ./pixellab-forge-output/
```

## Key Architecture Decisions

- Uses the **low-level `Server` class** from `@modelcontextprotocol/sdk` (not `McpServer`) because the high-level API requires Zod schemas. We use raw JSON Schema objects instead.
- SDK v1.29 uses **newline-delimited JSON** for stdio transport, not Content-Length framing.
- **All tool schemas are verified against the OpenAPI spec** at `https://api.pixellab.ai/v2/openapi.json`. Key naming:
  - v2 endpoints use `no_background` and `seed` (NOT `guidance_scale`, `remove_background`, or `ai_freedom`)
  - Character/object/tileset endpoints use `text_guidance_scale`, `outline/shading/detail`, `color_image`
  - Legacy endpoints (pixflux, bitforge, skeleton, rotate, inpaint) use Python SDK field names
- Background jobs auto-poll every 2s for up to 10 minutes with 3 retries on network failure.
- Job IDs are logged to stderr and persisted to `$TMPDIR/pixellab-forge/jobs.json` for recovery.
- Generated images are auto-saved to `./pixellab-forge-output/` in the working directory.

## Git Identity

Use `rabbitcannon` for all commits. The local git config is already set:
- name: rabbitcannon
- email: 7041454+rabbitcannon@users.noreply.github.com

Do NOT add co-author attributions to commits.

## Releasing

The canonical, detailed checklist is **[RELEASING.md](RELEASING.md)** — follow it. Summary of the actual flow:

1. **Bump version**: `npm version <major|minor|patch> --no-git-tag-version` (npm rejects a duplicate version).
2. **Verify**: `npm run build` → `npm test` (expect all passing) → `npm publish --dry-run`.
3. **Update [CHANGELOG.md](CHANGELOG.md)** — add a `## [X.Y.Z] - YYYY-MM-DD` entry (newest first, grouped Added/Changed/Fixed/Security) plus its link reference at the bottom.
4. **Commit via PR** — `main` is protected by the "Main protection" ruleset, so do **not** push to `main` directly. Branch → commit (`vX.Y.Z - <summary>`, no co-author trailers) → push → `gh pr create` → `gh pr merge --squash --admin --delete-branch` (the Repository-admin role is a standing bypass actor).
5. **GitHub release**: `gh release create vX.Y.Z --target main --title "vX.Y.Z" --notes "<notes>"`. This **auto-publishes the GitHub Packages mirror** (`@rabbitcannon/pixellab-forge-mcp`) via `.github/workflows/publish-gpr.yml`. Optionally attach the tarball: `npm pack --pack-destination /tmp/ && gh release upload vX.Y.Z /tmp/pixellab-forge-mcp-X.Y.Z.tgz`.
6. **Publish to npmjs.org** (manual, 2FA-gated): `npm publish --otp=<code>`. This is the canonical package users install; it is intentionally not automated.
7. **Verify**: query the registry directly (the local `npm view` cache lags) — `curl -s https://registry.npmjs.org/pixellab-forge-mcp | python3 -c "import sys,json;print(json.load(sys.stdin)['dist-tags']['latest'])"`.

Distribution: **npmjs.org** `pixellab-forge-mcp` (canonical, manual OTP publish) and **GitHub Packages** `@rabbitcannon/pixellab-forge-mcp` (scoped mirror, auto-published on release). npm versions are immutable — to fix a published README/page you must ship a new version.

## Development

```bash
npm install
npm run build
PIXELLAB_API_KEY=your-key npx @modelcontextprotocol/inspector node dist/index.js
```

## Testing

Quick smoke test via stdio:
```bash
{
  echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"1.0.0"}}}'
  sleep 0.2
  echo '{"jsonrpc":"2.0","method":"notifications/initialized"}'
  echo '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}'
  sleep 1
} | PIXELLAB_API_KEY=test node dist/index.js
```
