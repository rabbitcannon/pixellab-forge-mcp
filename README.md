# PixelForge MCP

An MCP (Model Context Protocol) server that connects AI assistants to the [PixelLab](https://pixellab.ai) pixel art generation API. Generate sprites, tilesets, characters, animations, and more directly from Claude, Cursor, or any MCP-compatible client.

## Features

- **Image Generation** - Create pixel art from text descriptions using multiple engines (Pixflux, Bitforge)
- **Characters** - Generate persistent characters with 4 or 8 directional views
- **Animation** - Animate characters and sprites with text, skeleton keypoints, or frame interpolation
- **Tilesets** - Create top-down, sidescroller, and isometric tilesets
- **Editing** - Inpaint, resize, remove backgrounds, transfer outfits, and edit existing pixel art
- **Map Objects** - Generate game-ready objects with transparent backgrounds

## Prerequisites

- **Node.js** 18 or later
- A **PixelLab API key** - get one at [pixellab.ai/account](https://pixellab.ai/account)

## Setup

No installation needed - your MCP client downloads and runs the package automatically.

### Claude Code

```bash
claude mcp add pixelforge-mcp -e PIXELLAB_API_KEY=your-api-key-here -- npx pixelforge-mcp
```

To make it available across all your projects:

```bash
claude mcp add pixelforge-mcp -s user -e PIXELLAB_API_KEY=your-api-key-here -- npx pixelforge-mcp
```

### Claude Desktop

Add to your config file:

- **macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Windows**: `%APPDATA%\Claude\claude_desktop_config.json`

```json
{
  "mcpServers": {
    "pixelforge-mcp": {
      "command": "npx",
      "args": ["pixelforge"],
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
      "args": ["pixelforge"],
      "env": {
        "PIXELLAB_API_KEY": "your-api-key-here"
      }
    }
  }
}
```

## Available Tools (45)

All generation tools automatically poll for results - no need to manually check job status.

> **Note:** Pro/v2 endpoints and legacy endpoints use different parameter names for some options. See the [Common Options](#common-options) table below for details.

### Image Generation

| Tool | Description | Key Options |
|------|-------------|-------------|
| `generate_image` | Generate pixel art from text (Pro) | `reference_images`, `style_image`, `guidance_scale` |
| `generate_with_style` | Match style from 1-4 references (Pro) | `style_images`, `style_description`, `guidance_scale` |
| `generate_ui` | Game UI elements (Pro) | `concept_image`, `color_palette`, `guidance_scale` |
| `create_image_pixflux` | Pixflux engine (32-400px) | `text_guidance_scale`, `init_image`, `color_image`, `no_background`, `isometric`, `seed` |
| `create_image_bitforge` | Bitforge engine (max 200px) | `text_guidance_scale`, `style_image`, `inpainting_image`, `mask_image`, `color_image`, `skeleton_keypoints`, `seed` |

### Characters & Objects

| Tool | Description | Key Options |
|------|-------------|-------------|
| `create_character_4dir` | Character with N/S/E/W views (32-168px) | `proportions`, `view`, `ai_freedom`, `guidance_scale`, `color_palette`, `seed` |
| `create_character_8dir` | Character with 8 directional views | Same as 4dir |
| `animate_character` | Animate existing character by ID | `animation_type`, `directions`, `frame_count`, `ai_freedom`, `outline/shading/detail` |
| `create_object_4dir` | Object with 4 directional views | `view`, `ai_freedom`, `guidance_scale`, `color_palette`, `seed` |
| `list_characters` / `list_objects` | List with pagination | `limit`, `offset` |
| `get_character` / `get_object` | Get details by ID | |
| `delete_character` / `delete_object` | Delete by ID | |
| `download_character_zip` | Export character as ZIP | |
| `update_character_tags` / `update_object_tags` | Manage tags | |

### Animation

| Tool | Description | Key Options |
|------|-------------|-------------|
| `animate_with_text` | Animate from text + reference (legacy) | `text_guidance_scale`, `image_guidance_scale`, `n_frames`, `init_images`, `color_image`, `seed` |
| `animate_with_text_v2` | Animate existing image (Pro, 32-256px) | `reference_image`, `action`, `view`, `direction`, `ai_freedom` |
| `animate_with_text_v3` | Animate from first/last keyframes | `first_frame`, `last_frame`, `guidance_scale`, `ai_freedom` |
| `animate_with_skeleton` | Pose control via keypoints (legacy) | `skeleton_keypoints`, `reference_guidance_scale`, `pose_guidance_scale`, `isometric`, `color_image`, `seed` |
| `edit_animation` | Edit animation frames (Pro, 2-16) | `frames`, `description`, `guidance_scale` |
| `interpolate_frames` | Generate in-between frames (Pro) | `start_image`, `end_image`, `action` |
| `transfer_outfit` | Apply outfit to frames (Pro) | `reference_image`, `frames`, `ai_freedom` |
| `estimate_skeleton` | Extract keypoints from image | `image`, `image_size` |

### Rotation

| Tool | Description | Key Options |
|------|-------------|-------------|
| `generate_8_rotations` | 8 directional views (Pro, 32-168px) | `method` (rotate/style/concept), `view`, `ai_freedom`, `color_image`, `seed` |
| `rotate` | Rotate between views/directions (legacy) | `from_view/to_view`, `from_direction/to_direction`, `view_change`, `direction_change`, `image_guidance_scale`, `isometric`, `seed` |

### Editing & Inpainting

| Tool | Description | Key Options |
|------|-------------|-------------|
| `edit_images` | Batch edit 1-16 images (Pro) | `method` (text/reference), `description`, `reference_image`, `ai_freedom` |
| `edit_image` | Edit single image (Pro) | `description`, `reference_image`, `ai_freedom` |
| `inpaint_v3` | Mask-based editing (Pro, 32-512px) | `mask_image`, `context_image`, `bounding_box`, `ai_freedom` |
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
| `create_tileset` | Top-down tileset (16x16 or 32x32) | `lower/upper/transition_description`, `view`, `reference_image`, `outline/shading/detail`, `seed` |
| `create_tileset_sidescroller` | Platformer tileset | `lower_description`, `transition_description`, `reference_image`, `seed` |
| `create_isometric_tile` | Isometric tile (16-64px) | `description`, `color_image`, `seed` |
| `create_tiles_pro` | Pro tiles (hex, iso, octagon, square) | `tile_type`, `tile_size`, `n_tiles` |
| `get_tileset` / `get_isometric_tile` / `get_tiles_pro` | Retrieve by ID | |

### Map Objects & Account

| Tool | Description | Key Options |
|------|-------------|-------------|
| `create_map_object` | Game-ready object with transparent bg | `view`, `outline/shading/detail`, `color_image`, `seed` |
| `get_balance` | Check your credit balance | |
| `get_job_status` | Check background job status | |

### Common Options

Pro/v2 and legacy endpoints use different parameter names:

| Concept | Pro/v2 endpoints | Legacy endpoints |
|---------|-----------------|------------------|
| Prompt adherence | `guidance_scale` | `text_guidance_scale` |
| Transparent background | `remove_background` | `no_background` |
| Color reference | n/a | `color_image` (reference image) |
| Creativity | `ai_freedom` (0-1000) | n/a |
| Forced colors | `color_palette` (hex array) | n/a |
| Reproducibility | `seed` | `seed` |
| Style controls | n/a | `outline`, `shading`, `detail` |
| Negative prompt | n/a | `negative_description` |
| Camera angle | `view` | `view`, `isometric`, `oblique_projection` |
| Body type | `proportions` (preset or custom) | n/a |

## Usage Examples

Once configured, you can ask your AI assistant things like:

- "Generate a 32x32 pixel art sword"
- "Create a character with 4 directional views: a knight in silver armor with chibi proportions"
- "Make a top-down grass and dirt tileset at 16x16 with this style reference"
- "Animate my character walking in all directions"
- "Convert this photo into pixel art"
- "Create an isometric stone tile with this color palette: #4a3728, #6b5344, #8c7a6b"
- "Edit this sprite to add a red cape"
- "Generate 8 rotations of this character"

## How It Works

PixelForge uses the MCP stdio transport. When your AI client starts a conversation, it launches the PixelForge process, which communicates over stdin/stdout. Generation jobs are automatically polled until complete (up to 5 minutes), so results are returned directly - no manual polling needed.

## Contributing

Contributions are welcome via pull requests. See the repo for details.

## License

MIT
