/**
 * MCP Prompts — discoverable prompt templates that appear as slash commands
 * in clients like Claude Desktop, Cursor, etc.
 */

export interface PromptDef {
  name: string;
  description: string;
  arguments?: Array<{
    name: string;
    description: string;
    required?: boolean;
  }>;
  messages: (args: Record<string, string>) => Array<{
    role: "user" | "assistant";
    content: { type: "text"; text: string };
  }>;
}

export const prompts: PromptDef[] = [
  {
    name: "pf:help",
    description: "Overview of PixelForge tools and how to use them",
    messages: () => [
      {
        role: "user",
        content: {
          type: "text",
          text: `Give me a quick overview of what PixelForge can do and how to use it. Cover:
- The main generation tools (generate_image, generate_with_style, generate_ui) and when to use each
- Characters & objects (persistent vs one-off)
- Animation options
- Tilesets (standard vs pro)
- Editing & inpainting
- Image operations (resize, remove background, convert to pixel art)
- Key tips (sizes, seeds, backgrounds)
Keep it concise — bullet points, not paragraphs.`,
        },
      },
    ],
  },
  {
    name: "pf:character",
    description: "Create a pixel art character with directional views and optional animation",
    arguments: [
      {
        name: "description",
        description: "Character description (e.g. 'a knight in silver armor')",
        required: true,
      },
      {
        name: "size",
        description: "Sprite size in pixels (e.g. '64x64'). Max 128x128.",
        required: false,
      },
    ],
    messages: (args) => {
      const size = args.size || "48x48";
      return [
        {
          role: "user",
          content: {
            type: "text",
            text: `Create a pixel art character: ${args.description}

Requirements:
- Size: ${size}
- Create with 4 directional views (N/S/E/W) using create_character_4dir
- Use low top-down view
- After creation, ask me which animations I'd like to add (e.g. walking, fireball, breathing-idle)
- Show me what animation templates are available`,
          },
        },
      ];
    },
  },
  {
    name: "pf:tileset",
    description: "Create a tileset for a top-down or platformer game",
    arguments: [
      {
        name: "style",
        description: "Game style (e.g. 'medieval fantasy', 'sci-fi', 'nature')",
        required: true,
      },
      {
        name: "type",
        description: "Tileset type: 'topdown' (default) or 'sidescroller'",
        required: false,
      },
    ],
    messages: (args) => {
      const type = args.type || "topdown";
      const isSide = type === "sidescroller";
      return [
        {
          role: "user",
          content: {
            type: "text",
            text: `Create a ${isSide ? "sidescroller" : "top-down"} tileset with a ${args.style} theme.

Requirements:
- Tile size: 32x32
- ${isSide
    ? "Use create_tileset_sidescroller. Design a platform terrain with a decorative transition layer."
    : "Use create_tileset. Design a lower terrain, upper terrain, and transition between them. Set transition_size to 0.5."
  }
- After creating the first tileset, suggest 2-3 complementary terrain combinations I could add to build out a full map.`,
          },
        },
      ];
    },
  },
  {
    name: "pf:tiles",
    description: "Create hex, isometric, or octagon tiles for strategy or isometric games",
    arguments: [
      {
        name: "description",
        description: "What the tiles should look like (e.g. 'grass plains', 'stone dungeon floor')",
        required: true,
      },
      {
        name: "shape",
        description: "Tile shape: hex, hex_pointy, isometric, octagon, square_topdown",
        required: false,
      },
      {
        name: "count",
        description: "Number of tile variations (1-16)",
        required: false,
      },
    ],
    messages: (args) => {
      const shape = args.shape || "isometric";
      const count = args.count || "4";
      return [
        {
          role: "user",
          content: {
            type: "text",
            text: `Create ${count} ${shape} tiles: ${args.description}

Requirements:
- Use create_tiles_pro
- Tile type: ${shape}
- Tile size: 32px
- Number of tiles: ${count}
- Number each tile description for best results (e.g. "1). lush grass 2). sparse grass 3). grass with flowers")
- Use low top-down view
- After generation, ask if I want more variations or different terrain types to match.`,
          },
        },
      ];
    },
  },
  {
    name: "pf:sprite",
    description: "Generate a pixel art sprite from a description",
    arguments: [
      {
        name: "description",
        description: "What to generate (e.g. 'a fire sword', 'a treasure chest')",
        required: true,
      },
      {
        name: "size",
        description: "Image size (e.g. '64x64', '128x128')",
        required: false,
      },
    ],
    messages: (args) => {
      const size = args.size || "64x64";
      return [
        {
          role: "user",
          content: {
            type: "text",
            text: `Generate a pixel art sprite: ${args.description}

Requirements:
- Size: ${size}
- Use generate_image (the Pro endpoint)
- No background (transparent)
- Show me the saved file path after generation
- If I want variations, I can ask for different seeds`,
          },
        },
      ];
    },
  },
  {
    name: "pf:ui",
    description: "Generate pixel art UI elements for a game",
    arguments: [
      {
        name: "description",
        description: "UI element description (e.g. 'medieval stone button', 'sci-fi health bar')",
        required: true,
      },
      {
        name: "palette",
        description: "Color palette (e.g. 'brown and gold', 'blue and silver')",
        required: false,
      },
    ],
    messages: (args) => {
      const palette = args.palette ? `\n- Color palette: ${args.palette}` : "";
      return [
        {
          role: "user",
          content: {
            type: "text",
            text: `Generate a pixel art UI element: ${args.description}

Requirements:
- Use generate_ui
- Size: 256x256 (adjust aspect ratio if needed for the element type)
- No background${palette}
- After generation, suggest related UI elements that would complement this one (e.g. if I made a button, suggest matching panels, icons, health bars).`,
          },
        },
      ];
    },
  },
  {
    name: "pf:animate",
    description: "Animate an existing sprite or character image",
    arguments: [
      {
        name: "action",
        description: "Animation action (e.g. 'walking east', 'swinging a sword', 'idle breathing')",
        required: true,
      },
    ],
    messages: (args) => [
      {
        role: "user",
        content: {
          type: "text",
          text: `I want to animate a sprite: ${args.action}

Help me choose the right approach:
1. If I have a persistent character ID → use animate_character with a template
2. If I have a single sprite image → use animate_with_text_v2
3. If I have start and end keyframes → use animate_with_text_v3
4. If I need precise pose control → use estimate_skeleton then animate_with_skeleton

Ask me what I'm starting with (character ID, single image, or keyframes) and then proceed with the right tool.`,
        },
      },
    ],
  },
  {
    name: "pf:style",
    description: "Generate new art matching the style of existing sprites",
    arguments: [
      {
        name: "description",
        description: "What to generate (e.g. 'a treasure chest', 'a healing potion')",
        required: true,
      },
    ],
    messages: (args) => [
      {
        role: "user",
        content: {
          type: "text",
          text: `Generate pixel art matching my existing art style: ${args.description}

I'll provide 1-4 reference images. Use generate_with_style to match their pixel density, outline weight, shading approach, and color palette.

Please ask me to provide the style reference images, then generate the new art at the same size as the references.`,
        },
      },
    ],
  },
  {
    name: "pf:edit",
    description: "Edit or modify an existing pixel art image",
    arguments: [
      {
        name: "edit",
        description: "What to change (e.g. 'make the armor gold', 'add a cape', 'replace sword with axe')",
        required: true,
      },
    ],
    messages: (args) => [
      {
        role: "user",
        content: {
          type: "text",
          text: `I want to edit a sprite: ${args.edit}

Help me choose the right approach:
1. Full image edit (change the whole thing) → use edit_image
2. Edit a specific region (need a mask) → use inpaint_v3
3. Batch edit multiple sprites consistently → use edit_images

Ask me to provide the image(s), then proceed with the simplest approach that works.`,
        },
      },
    ],
  },
];
