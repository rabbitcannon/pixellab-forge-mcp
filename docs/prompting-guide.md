# Prompting Guide

How to get the best results from PixelForge through your AI assistant. Just describe what you want in plain language — the assistant picks the right tool and parameters automatically.

## The Basics

Every request needs two things: **what to generate** and **how big**. If you don't specify a size, the assistant will pick a reasonable default.

```
"Generate a 64x64 pixel art knight with a blue cape"
"Make a small 16x16 health potion icon"
"Create a 128x128 dragon boss sprite"
```

## Choosing the Right Tool

You don't need to name tools explicitly — the assistant picks one based on what you ask for. But understanding the options helps you get better results.

### Image Generation

There are five image generation endpoints. Here's when each one shines:

| Endpoint | Best For | How to Trigger It |
|----------|----------|-------------------|
| **`generate_image`** | General-purpose pixel art. Highest quality, largest sizes, supports reference images for subject guidance and style images for visual consistency. | Default for most requests. Just describe what you want. |
| **`generate_with_style`** | Generating new art that matches existing art. Requires 1-4 style reference images. The output copies the pixel size, palette, shading, and outline style from your references. | Mention "matching the style of" or "in the same style as" and provide reference images. |
| **`generate_ui`** | Game UI elements — buttons, panels, health bars, inventory slots, icons. Optimized for clean, functional UI components. Supports a color palette description and concept image. | Ask for UI elements: "button", "panel", "health bar", "icon", "inventory slot". |
| **`create_image_pixflux`** | Fine-grained control over style. Supports outline, shading, and detail parameters, color reference images, isometric/oblique views, and img2img via init_image. Up to 400x400. | Ask for specific style controls, or mention "pixflux". |
| **`create_image_bitforge`** | Maximum control. Everything Pixflux has plus skeleton keypoints for pose control, inpainting, and style image influence. Smaller max size (200x200). | Ask for pose control, inpainting on generation, or mention "bitforge". |

**Rule of thumb**: Start with `generate_image`. Move to `generate_with_style` when you need visual consistency across assets. Drop to Pixflux/Bitforge when you need fine-grained style knobs or legacy features.

### `generate_image` vs `generate_with_style`

Both can use reference images, but they work differently:

- **`generate_image` reference images** guide the *subject* — "generate something that looks like this thing." You can attach up to 4 references with a `usage_description` explaining how each should be used (e.g., "use as color reference", "match this character's pose").

- **`generate_with_style` style images** guide the *visual style* — "generate something in this art style." The output will match the pixel density, outline weight, shading approach, and color palette of your references. You can also add a `style_description` to fine-tune what gets matched.

```
# Subject guidance (generate_image)
"Generate a 64x64 treasure chest using this image as a reference for the design"
[attach reference image]

# Style matching (generate_with_style)
"Generate a 64x64 treasure chest in the same pixel art style as these sprites"
[attach 1-4 existing sprites from your game]

# With style description
"Generate a 64x64 potion bottle matching the style of these sprites,
 16-bit RPG style with thick outlines"
[attach style references]
```

### `generate_ui` — When to Use It

Use `generate_ui` instead of `generate_image` when you're making interface elements. It's specifically tuned for clean, functional UI components rather than characters or scenery.

```
"Create a 256x64 medieval stone button with gold trim"
"Generate a 128x32 sci-fi health bar, blue and silver palette"
"Make a 48x48 inventory slot icon with a wooden frame"
"Design a 512x256 game menu panel with ornate borders"
```

You can guide it with a color palette description and an optional concept image:
```
"Create a 256x256 RPG dialog box, brown and gold palette"
"Make a button matching this concept sketch" [attach concept image]
```

### Characters & Objects

Persistent assets that you create once and reuse across your project.

| Tool | What It Creates | Size Range |
|------|----------------|-----------|
| **`create_character_4dir`** | Character with N/S/E/W views | 16-128 x 16-128 |
| **`create_character_8dir`** | Character with 8 directional views (adds NE/NW/SE/SW) | 16-128 x 16-128 |
| **`create_object_4dir`** | Static object with 4 directional views | 32-256 x 32-256 |
| **`create_map_object`** | Single game-ready object with transparent background | 32-400 x 32-400 |

**Characters vs Objects**: Characters are for animated entities (NPCs, players, enemies). Objects are for static multi-directional props (furniture, signs, statues). Map objects are standalone single-view props (trees, barrels, buildings).

```
# Persistent character (can animate later)
"Create a 48x48 character with 4 directions: a knight in silver armor, chibi proportions"
"Create a 64x64 character with 8 directions: a cat wizard, low top-down view"

# Persistent object (4 views, not animatable)
"Create a 64x64 object with 4 directions: a wooden market stall"

# One-off map object
"Create a 128x256 map object: a tall oak tree, high top-down view"
"Create a 64x64 map object: a wooden barrel"
```

Characters and objects support style controls: `outline`, `shading`, `detail`, `color_image`, `force_colors`, `text_guidance_scale`. Characters also support `template_id` for body type (`mannequin` for humanoid, `bear`/`cat`/`dog`/`horse`/`lion` for quadrupeds) and `proportions` for body shape.

```
"Create a 48x48 character with 4 directions: a bear warrior, using the bear template"
"Create a 32x32 character with 8 directions: a tiny fairy, chibi proportions,
 single color outline, flat shading"
```

#### Managing Characters & Objects

```
"List my characters"
"Show me the details for character [ID]"
"Delete character [ID]"
"Download character [ID] as a ZIP"
"Tag character [ID] with 'hero' and 'player'"
"List my objects"
```

### Animation

There are several animation approaches depending on what you're starting with:

| Tool | Starting Point | Output | Size |
|------|---------------|--------|------|
| **`animate_character`** | Existing character ID | Multi-direction animation from template | Same as character |
| **`animate_with_text_v2`** | Single character image | Animation frames from text action | 32-256px |
| **`animate_with_text_v3`** | First frame (+ optional last frame) | 4-16 interpolated frames | Any (inferred) |
| **`animate_with_text`** | Reference image + description | Animation frames (fixed 64x64) | Fixed 64x64 |
| **`animate_with_skeleton`** | Skeleton keypoints + reference | Precise pose-controlled frames | 16-256px |
| **`edit_animation`** | Existing animation frames | Text-edited version of those frames | 16-256px |
| **`interpolate_frames`** | Start + end keyframe | In-between frames | 16-128px |
| **`transfer_outfit`** | Reference image + animation frames | Frames with transferred outfit | 32-256px |

```
# Animate a persistent character (easiest)
"Animate character [ID] with the walking template"
"Add a fireball animation to character [ID]"

# Animate a standalone image
"Animate this character image walking east, 32x32" [attach image]

# Animate from first frame (with optional last frame)
"Animate from this frame: character swinging a sword, 8 frames" [attach first frame]

# Interpolate between keyframes
"Generate in-between frames from this start pose to this end pose,
 the character is jumping" [attach start and end images]

# Skeleton-controlled animation
"Create a 64x64 animation using these skeleton keypoints, side view facing east"

# Edit existing animation
"Edit these animation frames: make the cape red instead of blue" [attach frames]

# Transfer outfit
"Apply this outfit to these animation frames" [attach reference + frames]
```

#### Animation Templates

When animating a persistent character, you choose a template. Available templates:

**Movement**: `walk`, `walk-1`, `walk-2`, `walking` through `walking-10`, `walking-4-frames`, `walking-6-frames`, `walking-8-frames`, `running-4-frames`, `running-6-frames`, `running-8-frames`, `crouched-walking`, `sad-walk`, `scary-walk`, `running-jump`, `running-slide`

**Actions**: `jumping-1`, `jumping-2`, `two-footed-jump`, `backflip`, `front-flip`, `crouching`, `getting-up`, `picking-up`, `pushing`, `pull-heavy-object`, `drinking`, `throw-object`

**Combat**: `fireball`, `cross-punch`, `lead-jab`, `high-kick`, `flying-kick`, `hurricane-kick`, `leg-sweep`, `roundhouse-kick`, `surprise-uppercut`, `taking-punch`, `falling-back-death`

**Idle**: `breathing-idle`, `fight-stance-idle-8-frames`

```
"Animate character [ID] with the walking-8-frames template"
"Add a fireball animation to character [ID]"
"Animate character [ID] with breathing-idle for all directions"
"Animate character [ID] with flying-kick, only south and east directions"
```

### Rotation

Generate directional views of a character or object.

| Tool | What It Does | Size |
|------|-------------|------|
| **`generate_8_rotations`** | 8 directional views from one image, description, or concept art | 32-168px |
| **`rotate`** | Rotate from one specific view/direction to another | 16-200px |

`generate_8_rotations` has three methods:
- **`rotate_character`** — provide an existing character image, get 8 rotations
- **`create_with_style`** — describe a character + provide style references
- **`create_from_concept`** — provide concept art, get pixel art rotations

```
# From existing character image
"Generate 8 rotations of this character at 64x64" [attach image]

# From description + style
"Generate 8 rotations: a paladin in gold armor, 48x48, low top-down view"

# From concept art
"Generate 8 pixel art rotations from this concept art at 64x64" [attach concept]

# Single rotation
"Rotate this character from facing south to facing east, 64x64" [attach image]
```

### Editing & Inpainting

There are four editing tools with different strengths:

| Tool | Best For | Size | Key Feature |
|------|----------|------|------------|
| **`edit_image`** | Single image text-based edit | 16-400px | Can resize canvas while editing |
| **`edit_images`** | Batch editing 1-16 images | 32-512px | Edit with text OR match a reference image |
| **`inpaint_v3`** | Precise mask-based region editing | Up to 512px | White mask = generate, black = preserve |
| **`inpaint`** | Legacy inpainting with style controls | Up to 200px | Outline/shading/detail params |

```
# Single edit
"Edit this sprite: change the hat to a crown" [attach image]
"Edit this 64x64 sprite and resize to 128x128, add more detail"

# Batch edit with text
"Edit all these frames: make the armor gold" [attach 1-16 images]

# Batch edit with reference
"Edit these sprites to match this reference image's style" [attach images + reference]

# Inpaint a region (v3 — recommended)
"In this sprite, replace the sword with an axe"
[attach image + mask where white = area to regenerate]

# Legacy inpaint with style controls
"Inpaint this area with detailed shading and thick outlines"
[attach image + mask]
```

### Image Operations

Utilities for converting, resizing, and cleaning up images.

| Tool | What It Does | Sizes |
|------|-------------|-------|
| **`image_to_pixelart`** | Convert a photo/drawing into pixel art | Input up to 1280px, output up to 320px |
| **`resize_image`** | AI-powered pixel art resize (not just scaling) | Target 16-200px |
| **`remove_background`** | Remove background from an image | Up to 400px |
| **`estimate_skeleton`** | Extract skeleton keypoints from a character image | Any size |

```
# Convert to pixel art
"Convert this photo into 64x64 pixel art" [attach photo]

# AI resize (preserves pixel art quality)
"Resize this 32x32 character to 64x64" [attach image]

# Remove background
"Remove the background from this sprite" [attach image]
"Remove the complex background from this image" -- uses the slower, more accurate mode

# Get skeleton keypoints (for use with animate_with_skeleton)
"Estimate the skeleton keypoints from this character" [attach image]
```

### Tilesets: Standard vs Pro

There are four tileset/tile tools:

| Tool | Best For | Tile Shapes |
|------|----------|-------------|
| **`create_tileset`** | Top-down RPG maps with terrain transitions. Generates a Wang tileset (16 tiles, or 23 with full transitions) with lower terrain, upper terrain, and seamless edge pieces. | Square (16x16 or 32x32) |
| **`create_tileset_sidescroller`** | Platformer games. Generates platform terrain with top edges, fills, and decorative transitions. | Square (16x16 or 32x32) |
| **`create_isometric_tile`** | Single isometric tiles with configurable shape (block, thick, thin). Good for building up isometric maps tile by tile. | 16-64px |
| **`create_tiles_pro`** | Non-square tile shapes and batch variations. Generate multiple tile variations at once with precise control over view angle and depth. Supports style matching from existing tiles. | 16-256px |

```
# Top-down tileset with transitions
"Create a 32x32 tileset: ocean water below, sandy beach above, foam transition"
"Create a 32x32 tileset: deep grass below, dirt path above, transition size 0.5"

# Sidescroller tileset
"Create a 16x16 sidescroller tileset: stone platform with mossy edges"
"Create a 32x32 sidescroller tileset: wooden planks, vine transition"

# Isometric tile
"Create a 32x32 isometric grass tile, block shape"
"Create a 64x64 isometric lava tile, thin tile shape"

# Pro tiles — batch with specific shapes
"Create 6 hexagonal grass tiles at 32px, low top-down view"
"Generate 4 isometric cobblestone tiles at 64px"
"Create 8 octagonal dungeon floor tiles at 48px, side view"
"Create 3 square top-down water tiles at 32px"

# Pro tiles with style matching
"Create 4 hex water tiles matching the style of these existing tiles"
[attach existing tile images]
"Generate 3 more tile variations matching these" [attach existing tiles]
```

Pro tile types: `hex` (flat-top), `hex_pointy` (pointy-top), `isometric`, `octagon`, `square_topdown`

Pro tile views: `top-down` (no depth), `high top-down` (~15% depth), `low top-down` (~30% depth), `side` (~50% depth). You can also set a precise angle with `tile_view_angle` (0-90 degrees) and `tile_depth_ratio` (0-1).

**Pro tiles** also support `style_images` — attach existing tiles and the new ones will match their visual style, pixel density, and dimensions. When you provide style images, the tile type/size/view settings are ignored in favor of what the style images define.

### Pixflux vs Bitforge (Legacy Engines)

Both are older engines with more manual controls. The assistant won't pick these unless you ask for their specific features or name them directly.

**Pixflux** (up to 400x400):
- Outline, shading, and detail controls (weakly guiding — suggestions, not strict)
- Color reference image (`color_image`)
- Img2img via `init_image` + `init_image_strength` (1-999, default 300)
- Isometric mode, background removal
- View and direction control

**Bitforge** (up to 200x200):
- Everything Pixflux has, plus:
- Style image with adjustable `style_strength` (0-100)
- Skeleton keypoints for pose control
- Built-in inpainting (image + mask)
- Oblique projection

```
# Pixflux with style controls
"Create a 64x64 pixflux knight with thick outlines, flat shading, low detail"

# Pixflux img2img
"Use pixflux to generate a variation of this image" [attach init_image]

# Bitforge with pose control
"Create a 48x48 bitforge character using these skeleton keypoints: [...]"

# Bitforge with style transfer
"Generate a 64x64 bitforge character matching the style of this image" [attach style_image]
```

## Size Constraints

Different tools have different size limits. Here's a quick reference:

| Tool Category | Size Range | Notes |
|---------------|-----------|-------|
| `generate_image` | 16-792 x 16-688 | Most flexible, best quality |
| `generate_with_style` | 16-512 x 16-512 | |
| `generate_ui` | 16-792 x 16-688 | Defaults to 256x256 |
| `create_image_pixflux` | 16-400 x 16-400 | |
| `create_image_bitforge` | 16-200 x 16-200 | |
| Characters (4dir/8dir) | 16-128 x 16-128 | |
| Objects (4dir) | 32-256 x 32-256 | |
| Map objects | 32-400 x 32-400 | Max 160K total pixels |
| `animate_with_text` | Fixed 64x64 | Legacy, v2 is more flexible |
| `animate_with_text_v2` | 32-256 x 32-256 | |
| `animate_with_text_v3` | Any (inferred from input) | 4-16 frames, must be even |
| `animate_with_skeleton` | 16-256 x 16-256 | |
| `edit_animation` | 16-256 x 16-256 | 2-16 frames |
| Interpolation | 16-128 x 16-128 | |
| Transfer outfit | 32-256 x 32-256 | 2-16 frames |
| `generate_8_rotations` | 32-168 x 32-168 | |
| `rotate` | 16-200 x 16-200 | |
| `edit_image` | 16-400 x 16-400 | |
| `edit_images` | 32-512 x 32-512 | 1-16 images |
| `inpaint_v3` | Any (inferred from input) | |
| `inpaint` (legacy) | 16-200 x 16-200 | |
| `image_to_pixelart` | Input up to 1280, output up to 320 | |
| `resize_image` | Target 16-200 x 16-200 | |
| `remove_background` | Up to 400 x 400 | |
| Tilesets | 16x16 or 32x32 | |
| Isometric tiles | 16-64 x 16-64 | |
| Pro tiles | 16-256px | Single dimension |

All sizes are in pixels and must be integers. Stick to powers of 2 (16, 32, 64, 128, 256) for best results — pixel art looks cleanest at these sizes.

## Writing Good Descriptions

### Be Specific About the Subject

```
Bad:  "a character"
Good: "a dwarf blacksmith wearing a leather apron, holding a hammer"

Bad:  "a sword"
Good: "a curved silver scimitar with a golden crossguard and red gem in the pommel"
```

### Mention the Art Style

The AI generates pixel art by default, but you can guide the aesthetic:

```
"a medieval castle in the style of classic SNES RPGs"
"a spaceship with a clean, minimal pixel style"
"a dark fantasy skeleton warrior, detailed shading, thick outlines"
```

### Specify the View/Perspective

```
"a treasure chest, high top-down view"       -- for top-down games
"a knight facing south, side view"            -- for sidescrollers
"an isometric stone tower"                    -- for isometric games
"a character facing east"                     -- for specific direction
```

Available views: `side`, `low top-down`, `high top-down`
Available directions: `south`, `north`, `east`, `west`, `south-east`, `south-west`, `north-east`, `north-west`

### Background Control

Most tools support transparent backgrounds, which is usually what you want for game assets:

```
"Generate a 64x64 knight with no background"
"Create a character sprite on a transparent background"
```

This maps to the `no_background` parameter. It defaults to `true` on v2/Pro endpoints and `false` on legacy endpoints.

If you *want* a background:
```
"Generate a 128x128 forest scene with background"
```

## Style Controls

### Pro Endpoints (generate_image, generate_with_style)

Use `style_image` and `style_options` to control which aspects of a reference to copy:
- `copy_outline` — outline weight and style
- `copy_shading` — shading approach
- `copy_detail` — level of detail
- `copy_colors` — color palette

### Legacy & Character Endpoints

Pixflux, Bitforge, characters, objects, tilesets, and map objects support explicit style parameters:

- **Outline**: `"single color black outline"` (default for characters), `"selective outline"`, `"lineless"` (default for isometric tiles), `"no outline"`, etc.
- **Shading**: `"flat shading"`, `"basic shading"` (default), `"simple shading"`, `"detailed shading"`, etc.
- **Detail**: `"low detail"`, `"medium detail"` (default), `"high detail"`

```
"Create a 32x32 character with thick outlines and flat shading"
"Make a map object: wooden barrel, lineless, detailed shading"
"Create a tileset with high detail and selective outline"
```

### Color References

You can pass a color reference image to control the palette on legacy/character/tileset endpoints:

```
"Generate a character using the same colors as this image" [attach image]
```

The `force_colors` option (characters/objects) makes the output strictly use only colors from the reference.

## Common Workflows

### Character Creation Pipeline

1. **Create the character** with 4 or 8 directions:
   ```
   "Create a 64x64 character with 4 directions: a wizard in purple robes
    with a pointed hat, chibi proportions"
   ```

2. **Animate it** using built-in templates:
   ```
   "Animate that character with the walking template"
   "Now add a fireball animation"
   "Add a breathing-idle animation too"
   ```

3. **Manage and export**:
   ```
   "Tag that character with 'player' and 'mage'"
   "Download the character as a ZIP file"
   "List all my characters"
   ```

### Building a Consistent Asset Set

1. **Generate the first asset** to establish your style:
   ```
   "Generate a 64x64 knight character, SNES RPG style"
   ```

2. **Use it as style reference** for everything else:
   ```
   "Generate a 64x64 treasure chest in the same style as this sprite"
   [attach the knight]
   "Generate a 64x64 health potion matching this style" [attach knight]
   ```

3. **Or create characters with matching style controls**:
   ```
   "Create a 64x64 character with 4 directions: a merchant,
    single color outline, basic shading, medium detail"
   ```

### Tileset Workflow

1. **Create base tileset**:
   ```
   "Create a 32x32 top-down tileset:
    lower terrain is deep blue ocean water,
    upper terrain is green grass with small flowers,
    transition is sandy beach with foam, transition size 0.5"
   ```

2. **Add more terrain types** using consistent style:
   ```
   "Create another 32x32 tileset:
    lower is grass, upper is cobblestone path,
    same outline and shading style"
   ```

3. **Add isometric or pro tile variants** if needed:
   ```
   "Create a 32x32 isometric grass tile, block shape"
   "Create 4 hex water tiles at 32px matching these" [attach existing tiles]
   ```

### Animation from Existing Art

Choose your approach based on what you have:

**Have a persistent character?** Use templates:
```
"Animate character [ID] with walking-8-frames"
```

**Have a single sprite image?** Use animate_with_text_v2:
```
"Animate this character image walking east, 64x64" [attach image]
```

**Have start and end poses?** Use animate_with_text_v3:
```
"Animate from this first frame to this last frame: character swinging sword, 8 frames"
[attach both frames]
```

**Need precise pose control?** Extract skeleton then animate:
```
"Estimate the skeleton from this character" [attach image]
-- then use the keypoints with animate_with_skeleton
```

**Want to edit existing animation?** Use edit_animation:
```
"Edit these animation frames: make the cape red" [attach 2-16 frames]
```

**Want to apply an outfit to animation?** Use transfer_outfit:
```
"Transfer this outfit onto these animation frames"
[attach reference + 2-16 frames]
```

### Editing Existing Sprites

**Quick single edit** — `edit_image`:
```
"Edit this sprite to add a red cape" [attach image]
"Edit this 32x32 sprite and expand to 64x64 canvas, add wings"
```

**Batch edit multiple images** — `edit_images`:
```
"Edit all these sprites to make the armor gold" [attach images]
"Edit these sprites to match this reference image's style" [attach images + ref]
```

**Precise region edit** — `inpaint_v3` (recommended):
```
"Replace the sword with an axe in this sprite"
[attach image + mask where white = area to change]
```

**Region edit with style control** — `inpaint` (legacy):
```
"Inpaint this area with detailed shading, thick outlines"
[attach image + mask]
```

## Seeds for Reproducibility

Add a seed to get the same result every time:

```
"Generate a 64x64 fire elemental with seed 42"
```

This is useful for:
- Iterating on a design (same seed + tweaked description)
- Generating variations (same description + different seeds)
- Reproducing a result you liked

## Account & Jobs

```
"Check my PixelLab balance"
"List my pending jobs"
"Check the status of job [ID]"
"Show my recent job history"
```

Jobs auto-poll for up to 10 minutes. If something disconnects, job IDs are persisted — ask to "list pending jobs" to recover.

## Tips

- **Start small**: Generate at 32x32 or 64x64 first to iterate quickly, then use `resize_image` to scale up
- **Use `generate_image` for most things**: It's the newest and most capable endpoint
- **Characters are persistent**: Create once with `create_character_4dir/8dir`, animate repeatedly by ID
- **Style matching needs images**: `generate_with_style` requires reference images — you can't just describe a style
- **Pro tiles for non-square shapes**: Use `create_tiles_pro` for hex, isometric, and octagon tiles
- **Tilesets for terrain**: Use `create_tileset` when you need seamless terrain transitions, not just individual tiles
- **Seed = reproducibility**: Same seed + same description = same output
- **Transparent backgrounds are default** on v2/Pro endpoints, but **not** on legacy endpoints (Pixflux, Bitforge, legacy inpaint)
- **Even frame counts**: `animate_with_text_v3` requires even frame counts (4, 6, 8, 10, 12, 14, 16)
- **Number your pro tile descriptions**: For best results with `create_tiles_pro`, number each tile: "1). grass tile 2). stone tile 3). lava tile"
