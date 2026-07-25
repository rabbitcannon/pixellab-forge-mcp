# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres
to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.6.0] - 2026-07-25

### Added
- **12 new tools** completing coverage of the documented v2 API (72 → 84). Every
  remaining retrieval and cleanup endpoint is now exposed:
  - Deletion: `delete_tileset`, `delete_tileset_sidescroller`, `delete_isometric_tile`,
    `delete_tiles_pro`.
  - Sidescroller tilesets could previously only be created — added
    `get_tileset_sidescroller` and `list_tilesets_sidescroller`.
  - `list_tiles_pro` (pro tiles could only be fetched one at a time) and
    `get_map_object` (status + metadata for `create_map_object`).
  - `delete_character_animations` / `delete_object_animations`, which delete every
    animation by default or a subset via the optional `animation_type`,
    `animation_group_id`, and `direction` filters.
  - `get_font_pro_job` / `get_portrait_character_pro_job` — these two Pro jobs are
    served from dedicated endpoints rather than `/background-jobs`, so
    `get_job_status` does not resolve them.

### Changed
- All new path parameters run through the existing id validation guard, and
  pagination/animation-filter query strings are built by shared helpers.

## [1.5.0] - 2026-07-02

### Added
- **6 new tools** covering the remaining Pro API endpoints (66 → 72):
  - UI assets: `create_ui_asset`, `list_ui_assets`, `get_ui_asset`, `delete_ui_asset`
    — the persistent shape-based UI panel workflow (distinct from the one-shot `generate_ui`).
  - `generate_font_pro` — generate a styled pixel-art font (glyph atlas + `.ttf`).
  - `portrait_character_pro` — convert between a bust portrait and a full-body character sprite.
- Async `POST` responses now carry through any resource id the endpoint returns
  alongside the job id (e.g. `create_ui_asset` echoes `ui_asset_id`), so callers can
  reference the asset before the job finishes.

### Changed
- Bumped dev/runtime dependencies (`zod`, `@types/node`, `typescript`, `vitest`).

## [1.4.3] - 2026-06-13

### Fixed
- The server now reports its real version from `package.json` in the MCP handshake
  (`serverInfo.version`) instead of a hardcoded `1.2.0`, so clients and `claude mcp
  list` show the actual running version.

## [1.4.2] - 2026-06-13

### Fixed
- **`download_character_zip`** was broken on every call — it parsed a binary ZIP
  response as JSON. It now downloads the binary via a new `PixelLabClient.getBinary()`,
  saves it to `pixellab-forge-output/`, and returns `{ file_path, size_bytes }`.

### Added
- **`file_path` image arguments** — any image argument may carry a `file_path`
  instead of inline base64; the server resolves it from disk before calling the API.
  Reads are restricted to the output directory and workspace root.

### Security
- Strip base64 image blobs from error responses (all HTTP methods) so failures
  don't dump large image data into context.
- Validate and URL-encode every path-segment id (characters and objects, including
  the object animation/state/frame endpoints) to prevent path traversal / injection.

_Reimplements community ideas from #1 (credit: @ultimatefrisbie1). Tests: 78 → 101._

## [1.4.1] - 2026-06-13

### Changed
- Docs/packaging-only republish so the npmjs.org package page reflects the 66-tool
  README and registry note (the 1.4.0 tarball predated them; npm versions are immutable).
- Normalized `package.json` `bin` and `repository` fields (`npm pkg fix`).
- First release to publish the GitHub Packages mirror via CI on the v5 actions.

## [1.4.0] - 2026-06-13

### Added
- **19 new tools** covering previously-missing API endpoints (48 → 66):
  - Image generation: `create_image_pixen`, `create_image_pixflux_background`, `image_to_pixelart_pro`
  - Rotation: `generate_8_rotations_v3`
  - Characters: `create_character_v3`, `create_character_pro`, `create_character_state`, `create_character_animation`
  - Objects: `create_object_1dir`, `create_object_8dir`, `animate_object`, `create_object_state`, `select_object_frames`, `dismiss_object_review`
  - Prompt enhancement: `enhance_character_prompt`, `enhance_animation_prompt`, `enhance_pixen_prompt`
  - Listing: `list_tilesets`, `list_isometric_tiles`
- GitHub Packages mirror published automatically on release (`@rabbitcannon/pixellab-forge-mcp`).

### Fixed
- Removed the dead `create_object_4dir` tool, which posted to a non-existent endpoint.
  Replaced with `create_object_1dir` (`/create-1-direction-object`) and
  `create_object_8dir` (`/create-8-direction-object`) using the correct request schema.
- Job-log path is now overridable via `PIXELLAB_JOB_LOG_DIR` (resolved lazily), so
  parallel test files no longer race on a shared `jobs.json`.

## [1.3.1] - 2026-04-15

### Changed
- Improved tool descriptions for better LLM routing — accurate size constraints
  (verified against the OpenAPI spec) and "use this when… / prefer X instead" guidance.
- Marked legacy tools (`animate_with_text`, `inpaint`, `create_image_pixflux`,
  `create_image_bitforge`) with guidance to prefer their v2/v3 alternatives.

### Fixed
- `create_tiles_pro` schema: capped `tile_size`/`tile_height` at 128px (was 256).
- Clarified fixed-size-only constraints for `rotate` and `animate_with_skeleton`.

## [1.3.0] - 2026-04-09

### Added
- **`read_image`** tool — load a saved image from disk as a Base64Image for chaining
  into other tools.
- Prompt-based filenames for saved images (derived from the generation prompt).

### Fixed
- **RGBA→PNG conversion** — images returned as raw `rgba_bytes` are now encoded as PNG
  before saving; previously saved files were 0-byte / corrupted.
- `get_job_status` resolves the original prompt description for meaningful filenames.

## [1.2.1] - 2026-04-07

### Changed
- **Non-blocking jobs** — creation/generation endpoints now return a `job_id`
  immediately instead of blocking up to 20 minutes (which could crash the connection).
  Use `get_job_status` to poll and retrieve results.

### Added
- Base64 image validation (PNG/JPEG/WebP/GIF magic bytes) and MIME auto-detection.
- Inline images limited to 4 per response (all still saved to disk); base64 cleanup
  (strip data-URI prefixes/whitespace); stderr debug logging.

## [1.2.0] - 2026-04-06

### Changed
- **Renamed** `pixelforge-mcp` → `pixellab-forge-mcp` (brand: PixelLab Forge) to avoid
  confusion with the existing PixelForge product. CLI is now `npx pixellab-forge-mcp`;
  output dir `pixellab-forge-output/`.

## [1.1.0] - 2026-04-06

### Added
- **9 prompt commands** (`/pf:help`, `/pf:sprite`, `/pf:character`, `/pf:animate`,
  `/pf:tileset`, `/pf:tiles`, `/pf:ui`, `/pf:style`, `/pf:edit`).
- `docs/prompting-guide.md` covering all tools, constraints, and workflows.

## [1.0.1] - 2026-04-06

### Fixed
- All tool schemas verified against the PixelLab OpenAPI spec; removed invalid params
  (`guidance_scale`, `remove_background`, `ai_freedom`) causing 422s on v2 endpoints.
- Corrected field names for `edit_image`, `animate_character`, and character/object/
  tileset endpoints; fixed view enums to use spaces.

### Added
- Auto-save generated images to disk; `list_pending_jobs` / `list_job_history` recovery
  tools; retry-with-backoff on polling; 10-minute job timeout.

## [1.0.0] - 2026-04-06

### Added
- Initial release: MCP server for the PixelLab pixel art generation API, covering image
  generation, characters/objects, animation, tilesets, editing, and rotation, with
  automatic job polling and a persistent job log for crash recovery.

[1.6.0]: https://github.com/rabbitcannon/pixellab-forge-mcp/releases/tag/v1.6.0
[1.5.0]: https://github.com/rabbitcannon/pixellab-forge-mcp/releases/tag/v1.5.0
[1.4.3]: https://github.com/rabbitcannon/pixellab-forge-mcp/releases/tag/v1.4.3
[1.4.2]: https://github.com/rabbitcannon/pixellab-forge-mcp/releases/tag/v1.4.2
[1.4.1]: https://github.com/rabbitcannon/pixellab-forge-mcp/releases/tag/v1.4.1
[1.4.0]: https://github.com/rabbitcannon/pixellab-forge-mcp/releases/tag/v1.4.0
[1.3.1]: https://github.com/rabbitcannon/pixellab-forge-mcp/releases/tag/v1.3.1
[1.3.0]: https://github.com/rabbitcannon/pixellab-forge-mcp/releases/tag/v1.3.0
[1.2.1]: https://github.com/rabbitcannon/pixellab-forge-mcp/releases/tag/v1.2.1
[1.2.0]: https://github.com/rabbitcannon/pixellab-forge-mcp/releases/tag/v1.2.0
[1.1.0]: https://github.com/rabbitcannon/pixellab-forge-mcp/releases/tag/v1.1.0
[1.0.1]: https://github.com/rabbitcannon/pixellab-forge-mcp/releases/tag/v1.0.1
[1.0.0]: https://github.com/rabbitcannon/pixellab-forge-mcp/releases/tag/v1.0.0
