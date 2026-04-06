# PixelForge MCP

An MCP server that connects AI assistants to the [PixelLab](https://pixellab.ai) pixel art generation API. Generate sprites, tilesets, characters, animations, and more directly from Claude, Cursor, or any MCP-compatible client.

Generated images are automatically saved to `./pixelforge-output/` in your project directory, ready to be moved into your game assets.

## Prerequisites

- **Node.js** 18 or later
- A **PixelLab API key** — get one at [pixellab.ai/account](https://pixellab.ai/account)

## Setup

No installation needed. `npx` downloads and runs the package automatically on first use.

### Claude Code (CLI)

```bash
claude mcp add pixelforge-mcp -e PIXELLAB_API_KEY=your-api-key-here -- npx pixelforge-mcp
```

This adds it to the current project. To make it available across all your projects:

```bash
claude mcp add pixelforge-mcp -s user -e PIXELLAB_API_KEY=your-api-key-here -- npx pixelforge-mcp
```

That's it. Claude Code will start the server automatically when you begin a conversation.

### Claude Desktop

Add to your config file:

- **macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Windows**: `%APPDATA%\Claude\claude_desktop_config.json`

```json
{
  "mcpServers": {
    "pixelforge-mcp": {
      "command": "npx",
      "args": ["pixelforge-mcp"],
      "env": {
        "PIXELLAB_API_KEY": "your-api-key-here"
      }
    }
  }
}
```

### Cursor

Add to `.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "pixelforge-mcp": {
      "command": "npx",
      "args": ["pixelforge-mcp"],
      "env": {
        "PIXELLAB_API_KEY": "your-api-key-here"
      }
    }
  }
}
```

### Other MCP Clients

Any MCP client that supports stdio transport can use PixelForge. Set the command to `npx pixelforge-mcp` and pass `PIXELLAB_API_KEY` as an environment variable.

## Generated Images

When a tool returns image data, PixelForge automatically saves the images as PNGs to `./pixelforge-output/` in whatever directory the MCP server is running from (usually your project root).

Add this to your `.gitignore`:

```
pixelforge-output/
```

## Available Tools (47)

Generation tools automatically poll for results — no manual job status checking needed. If a job takes longer than 10 minutes or the connection drops, use `list_pending_jobs` to find the job ID and `get_job_status` to retrieve the result.

### Image Generation

| Tool | Description | Key Options |
|------|-------------|-------------|
| `generate_image` | Generate pixel art from text | `reference_images`, `style_image`, `style_options`, `no_background`, `seed` |
| `generate_with_style` | Match style from 1-4 references | `style_images`, `style_description`, `no_background`, `seed` |
| `generate_ui` | Game UI elements (buttons, panels, icons) | `concept_image`, `color_palette`, `no_background`, `seed` |
| `create_image_pixflux` | Pixflux engine (32-400px) | `text_guidance_scale`, `init_image`, `color_image`, `no_background`, `isometric`, `outline/shading/detail`, `seed` |
| `create_image_bitforge` | Bitforge engine (max 200px) | `text_guidance_scale`, `style_image`, `inpainting_image`, `mask_image`, `color_image`, `skeleton_keypoints`, `outline/shading/detail`, `seed` |

### Characters & Objects

| Tool | Description | Key Options |
|------|-------------|-------------|
| `create_character_4dir` | Character with N/S/E/W views | `proportions`, `view`, `text_guidance_scale`, `outline/shading/detail`, `color_image`, `force_colors`, `template_id`, `isometric`, `seed` |
| `create_character_8dir` | Character with 8 directional views | Same as 4dir |
| `animate_character` | Animate existing character | `template_animation_id` (walking, fireball, breathing-idle, etc. — [47 templates](docs/prompting-guide.md#animation-templates)), `action_description`, `directions`, `outline/shading/detail`, `seed` |
| `create_object_4dir` | Object with 4 directional views | `view`, `text_guidance_scale`, `outline/shading/detail`, `color_image`, `force_colors`, `seed` |
| `list_characters` / `list_objects` | List with pagination | `limit`, `offset` |
| `get_character` / `get_object` | Get details by ID | |
| `delete_character` / `delete_object` | Delete by ID | |
| `download_character_zip` | Export character as ZIP | |
| `update_character_tags` / `update_object_tags` | Manage tags | |

### Animation

| Tool | Description | Key Options |
|------|-------------|-------------|
| `animate_with_text` | Animate from text + reference | `text_guidance_scale`, `image_guidance_scale`, `n_frames`, `init_images`, `color_image`, `seed` |
| `animate_with_text_v2` | Animate existing image (32-256px) | `reference_image`, `action`, `view`, `direction`, `no_background`, `seed` |
| `animate_with_text_v3` | Animate from first/last keyframes | `first_frame`, `last_frame`, `frame_count`, `no_background`, `seed` |
| `animate_with_skeleton` | Pose control via keypoints | `skeleton_keypoints`, `reference_guidance_scale`, `pose_guidance_scale`, `isometric`, `color_image`, `seed` |
| `edit_animation` | Edit animation frames (2-16) | `frames`, `description`, `no_background`, `seed` |
| `interpolate_frames` | Generate in-between frames | `start_image`, `end_image`, `action`, `no_background`, `seed` |
| `transfer_outfit` | Apply outfit to frames | `reference_image`, `frames`, `no_background`, `seed` |
| `estimate_skeleton` | Extract keypoints from image | `image`, `image_size` |

### Rotation

| Tool | Description | Key Options |
|------|-------------|-------------|
| `generate_8_rotations` | 8 directional views (32-168px) | `method` (rotate/style/concept), `view`, `style_description`, `no_background`, `seed` |
| `rotate` | Rotate between views/directions | `from_view/to_view`, `from_direction/to_direction`, `view_change`, `direction_change`, `image_guidance_scale`, `isometric`, `seed` |

### Editing & Inpainting

| Tool | Description | Key Options |
|------|-------------|-------------|
| `edit_images` | Batch edit 1-16 images | `method` (text/reference), `description`, `reference_image`, `no_background`, `seed` |
| `edit_image` | Edit single image | `image`, `description`, `width`, `height`, `text_guidance_scale`, `color_image`, `no_background`, `seed` |
| `inpaint_v3` | Mask-based editing | `mask_image`, `bounding_box`, `crop_to_mask`, `no_background`, `seed` |
| `inpaint` | Inpainting (legacy, max 200px) | `mask_image`, `text_guidance_scale`, `outline/shading/detail`, `isometric`, `color_image`, `seed` |

### Image Operations

| Tool | Description | Key Options |
|------|-------------|-------------|
| `image_to_pixelart` | Convert photo to pixel art | `image`, `output_size` |
| `resize_image` | AI-powered pixel art resize | `reference_image`, `target_size`, `color_image` |
| `remove_background` | Remove background (max 400px) | `background_removal_task`, `text_hint` |

### Tilesets

| Tool | Description | Key Options |
|------|-------------|-------------|
| `create_tileset` | Top-down tileset (16 or 32px) | `lower/upper/transition_description`, `tile_size`, `view`, `text_guidance_scale`, `tile_strength`, `tileset_adherence`, `lower/upper/transition_reference_image`, `seed` |
| `create_tileset_sidescroller` | Platformer tileset | `lower_description`, `transition_description`, `text_guidance_scale`, `tile_strength`, `tileset_adherence`, `base_tile_id`, `seed` |
| `create_isometric_tile` | Isometric tile (16-64px) | `isometric_tile_shape` (block/thick/thin), `text_guidance_scale`, `outline/shading/detail`, `color_image`, `seed` |
| `create_tiles_pro` | Pro tiles (hex, iso, octagon, square) | `tile_type`, `tile_size`, `tile_view`, `tile_depth_ratio`, `style_images`, `style_options`, `n_tiles`, `seed` |
| `get_tileset` / `get_isometric_tile` / `get_tiles_pro` | Retrieve by ID | |

### Map Objects

| Tool | Description | Key Options |
|------|-------------|-------------|
| `create_map_object` | Game-ready object | `view`, `outline/shading/detail`, `text_guidance_scale`, `background_image`, `inpainting`, `color_image`, `seed` |

### Account & Jobs

| Tool | Description |
|------|-------------|
| `get_balance` | Check your credit balance |
| `get_job_status` | Check a background job by ID |
| `list_pending_jobs` | List jobs that haven't completed (for recovery after disconnection) |
| `list_job_history` | Recent job history (auto-pruned after 24h) |

### Common Options

Most tools share these parameters, but the field names differ between endpoint generations:

| Concept | v2 endpoints | Legacy endpoints |
|---------|-------------|------------------|
| Prompt adherence | n/a | `text_guidance_scale` (1-20) |
| Transparent background | `no_background` | `no_background` |
| Color reference | n/a | `color_image` (reference image) |
| Style controls | n/a | `outline`, `shading`, `detail` |
| Negative prompt | n/a | `negative_description` |
| Isometric mode | n/a | `isometric`, `oblique_projection` |
| Reproducibility | `seed` | `seed` |

Character, object, tileset, and map object endpoints also accept `text_guidance_scale`, `outline`, `shading`, `detail`, and `color_image`.

## Usage

Just describe what you want in plain language. The assistant picks the right tool and parameters automatically.

### Quick Examples

**Sprites and icons:**
```
"Generate a 64x64 pixel art knight with a blue cape, no background"
"Make a 16x16 health potion icon"
"Create a 128x128 dragon boss with detailed shading and thick outlines"
```

**Characters (persistent, multi-directional):**
```
"Create a 48x48 character with 4 directions: a dwarf blacksmith in a leather apron, chibi proportions"
"Animate that character with the walk template"
"Now add a fireball animation"
```

**Tilesets:**
```
"Create a 32x32 top-down tileset: ocean water below, sandy beach on top, foam transition"
"Make a 16x16 sidescroller tileset with stone platforms"
```

**Editing existing art:**
```
"Edit this sprite to make the armor gold instead of silver"
"Remove the background from this image"
"Generate 8 rotations of this character"
```

### Which Tool Gets Used?

The assistant picks the right tool automatically, but the key decision is:

- **`generate_image`** — default for most requests, highest quality, largest sizes
- **`generate_with_style`** — when you want new art matching existing art ("in the same style as these sprites")
- **`generate_ui`** — for game UI elements (buttons, panels, health bars, icons)
- **`create_tileset` / `create_tiles_pro`** — for tileable terrain; standard for square RPG tiles, pro for hex/isometric/octagon
- **`create_character_4dir` / `8dir`** — for persistent characters you can animate later by ID

### Key Concepts

- **Sizes are in pixels** as `width x height` — different tools have different limits (e.g. characters max 128x128, `generate_image` goes up to 792x688)
- **Transparent backgrounds** are the default on most tools — ask for a background explicitly if you want one
- **Characters are persistent** — once created, you can animate them by ID without re-describing
- **Seeds** make results reproducible — same seed + same description = same output

For detailed size limits, style controls, endpoint comparison, and step-by-step workflows, see the **[Prompting Guide](docs/prompting-guide.md)**.

### Prompt Commands

PixelForge includes MCP prompt templates that appear as slash commands in supported clients (Claude Desktop, Cursor, etc.):

| Command | Description |
|---------|-------------|
| `pf:help` | Overview of all tools and how to use them |
| `pf:sprite` | Generate a pixel art sprite |
| `pf:character` | Create a character with directional views + animation |
| `pf:animate` | Animate an existing sprite or character |
| `pf:tileset` | Create a top-down or sidescroller tileset |
| `pf:tiles` | Create hex, isometric, or octagon tiles |
| `pf:ui` | Generate game UI elements |
| `pf:style` | Generate art matching existing sprites' style |
| `pf:edit` | Edit or modify an existing sprite |

## Reliability

- **Auto-polling**: Generation jobs are polled every 2 seconds for up to 10 minutes
- **Retry on failure**: Network errors during polling are retried 3 times with backoff
- **Job recovery**: If the connection drops, job IDs are logged to stderr and persisted to disk. Use `list_pending_jobs` to find them and `get_job_status` to retrieve results
- **Image saving**: Generated images are automatically saved as PNGs to `./pixelforge-output/`

## Testing

```bash
npx @modelcontextprotocol/inspector node dist/index.js
```

Set `PIXELLAB_API_KEY` in the inspector's environment variables, connect, and test any tool.

## Contributing

Contributions are welcome via pull requests.

## License

MIT
