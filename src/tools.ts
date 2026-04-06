import type { PixelLabClient } from "./api-client.js";
import { getPendingJobs, getJobLog } from "./job-log.js";

export interface ToolDef {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  handler: (client: PixelLabClient, args: Record<string, unknown>) => Promise<unknown>;
}

// ── Schema helpers ──────────────────────────────────────────────────────

function imageSchema(description: string) {
  return {
    type: "object" as const,
    description,
    properties: {
      base64: { type: "string", description: "Base64-encoded PNG image data" },
      url: { type: "string", description: "URL to the image" },
    },
  };
}

function frameImageSchema(description: string) {
  return {
    type: "object" as const,
    description,
    properties: {
      image: imageSchema("Image data"),
      width: { type: "number", description: "Image width in pixels" },
      height: { type: "number", description: "Image height in pixels" },
    },
    required: ["image", "width", "height"],
  };
}

function sizeSchema(description: string, required = true) {
  return {
    type: "object" as const,
    description,
    properties: {
      width: { type: "number", description: "Width in pixels" },
      height: { type: "number", description: "Height in pixels" },
    },
    required: required ? ["width", "height"] : [],
  };
}

// ── Reusable property fragments ─────────────────────────────────────────

const seed = { type: "number", description: "Seed for deterministic generation (default 0)" };
const negativeDescription = { type: "string", description: "What to avoid in generation" };
const initImageStrength = { type: "number", description: "Initial image influence strength (0-1000, default 300)" };
const isometric = { type: "boolean", description: "Generate in isometric view (default false)" };
const obliqueProjection = { type: "boolean", description: "Use oblique projection (default false)" };
const coveragePercentage = { type: "number", description: "Percentage of canvas to cover (0-100)" };
const noBackground = { type: "boolean", description: "Generate with transparent background (default false)" };
const removeBackground = { type: "boolean", description: "Auto-remove background (default false)" };
const aiFreedom = { type: "number", description: "AI creativity level (0-1000, default 650)" };
const colorImage = imageSchema("Color palette reference image");

const styleParams = {
  outline: { type: "string", description: "Outline style" },
  shading: { type: "string", description: "Shading style" },
  detail: { type: "string", description: "Detail level" },
};

const viewEnum = {
  type: "string",
  enum: ["low_top_down", "high_top_down", "side"],
  description: "Camera perspective",
};

const directionEnum = {
  type: "string",
  enum: ["south", "north", "east", "west", "south-east", "south-west", "north-east", "north-west"],
  description: "Character facing direction",
};

const proportionsSchema = {
  type: "object",
  description: "Body proportions - preset (chibi, cartoon, stylized, realistic_male, realistic_female, heroic) or custom with head_size, arm_length, leg_length, shoulder_width, hip_width (0.5-2.0)",
  properties: {
    type: { type: "string", enum: ["preset", "custom"] },
    name: { type: "string", description: "Preset name" },
    head_size: { type: "number" }, arm_length: { type: "number" },
    leg_length: { type: "number" }, shoulder_width: { type: "number" },
    hip_width: { type: "number" },
  },
};

const colorPaletteArray = {
  type: "array",
  items: { type: "string" },
  description: "Forced color palette as hex strings (e.g. [\"#ff0000\", \"#00ff00\"])",
};

// ── Tools ───────────────────────────────────────────────────────────────

export const tools: ToolDef[] = [
  // ═══════ ACCOUNT ═══════
  {
    name: "get_balance",
    description: "Get your current PixelLab credit balance",
    inputSchema: { type: "object", properties: {} },
    handler: async (client) => client.get("/balance"),
  },
  {
    name: "get_job_status",
    description: "Check the status of a background job by its ID",
    inputSchema: {
      type: "object",
      properties: {
        job_id: { type: "string", description: "The background job ID" },
      },
      required: ["job_id"],
    },
    handler: async (client, args) =>
      client.get(`/background-jobs/${args.job_id}`),
  },
  {
    name: "list_pending_jobs",
    description: "List background jobs that were started but haven't completed yet. Use this to recover jobs after a disconnection or timeout.",
    inputSchema: { type: "object", properties: {} },
    handler: async () => {
      const pending = getPendingJobs();
      if (pending.length === 0) {
        return { message: "No pending jobs", jobs: [] };
      }
      return { jobs: pending };
    },
  },
  {
    name: "list_job_history",
    description: "List recent job history (completed, failed, and pending). Jobs are pruned after 24 hours.",
    inputSchema: { type: "object", properties: {} },
    handler: async () => getJobLog(),
  },

  // ═══════ IMAGE GENERATION (Pro/v2) ═══════
  {
    name: "generate_image",
    description:
      "Generate pixel art from a text description. Supports reference images and style images for guidance.",
    inputSchema: {
      type: "object",
      properties: {
        description: { type: "string", description: "Text description of the pixel art to generate" },
        image_size: sizeSchema("Output image dimensions"),
        reference_images: {
          type: "array",
          description: "Up to 4 reference images for subject guidance",
          items: imageSchema("Reference image"),
        },
        style_image: imageSchema("Style reference image for consistent pixel art style"),
        remove_background: removeBackground,
        guidance_scale: { type: "number", description: "How closely to follow the prompt (1.0-20.0, default 7.5)" },
      },
      required: ["description", "image_size"],
    },
    handler: async (client, args) => client.post("/generate-image-v2", args),
  },
  {
    name: "generate_with_style",
    description:
      "Generate pixel art matching a specific visual style from 1-4 style reference images.",
    inputSchema: {
      type: "object",
      properties: {
        style_images: {
          type: "array",
          description: "1-4 style reference images",
          items: imageSchema("Style image"),
        },
        description: { type: "string", description: "What to generate" },
        style_description: { type: "string", description: "Fine-tune style matching details" },
        image_size: sizeSchema("Output dimensions (square, 16-512px)"),
        remove_background: removeBackground,
        guidance_scale: { type: "number", description: "How closely to follow the prompt (1.0-20.0, default 7.5)" },
      },
      required: ["style_images", "description", "image_size"],
    },
    handler: async (client, args) => client.post("/generate-with-style-v2", args),
  },
  {
    name: "generate_ui",
    description: "Generate pixel art UI elements for games (buttons, panels, health bars, inventory slots, icons).",
    inputSchema: {
      type: "object",
      properties: {
        description: { type: "string", description: "UI element description (e.g. 'medieval stone button with gold trim')" },
        image_size: sizeSchema("Output dimensions (min 16x16)"),
        concept_image: imageSchema("Design guidance image"),
        color_palette: { type: "string", description: "Color palette description (e.g. 'brown and gold')" },
        remove_background: removeBackground,
        guidance_scale: { type: "number", description: "How closely to follow the prompt (1.0-20.0, default 7.5)" },
      },
      required: ["description", "image_size"],
    },
    handler: async (client, args) => client.post("/generate-ui-v2", args),
  },

  // ═══════ IMAGE GENERATION (Legacy engines) ═══════
  {
    name: "create_image_pixflux",
    description:
      "Generate pixel art using the Pixflux engine. Supports color reference images, transparent backgrounds, and style controls. Size 32x32 to 400x400.",
    inputSchema: {
      type: "object",
      properties: {
        description: { type: "string", description: "Image description" },
        image_size: sizeSchema("32x32 to 400x400"),
        negative_description: negativeDescription,
        text_guidance_scale: { type: "number", description: "How closely to follow text (1.0-20.0, default 8.0)" },
        ...styleParams,
        view: viewEnum,
        direction: directionEnum,
        isometric,
        no_background: noBackground,
        coverage_percentage: coveragePercentage,
        init_image: imageSchema("Starting image for img2img"),
        init_image_strength: initImageStrength,
        color_image: colorImage,
        seed,
      },
      required: ["description", "image_size"],
    },
    handler: async (client, args) => client.post("/create-image-pixflux", args),
  },
  {
    name: "create_image_bitforge",
    description:
      "Generate pixel art using the Bitforge engine. Supports style images, inpainting, skeleton keypoints, and color reference. Max 200x200.",
    inputSchema: {
      type: "object",
      properties: {
        description: { type: "string", description: "Image description" },
        image_size: sizeSchema("Max 200x200"),
        negative_description: negativeDescription,
        text_guidance_scale: { type: "number", description: "Text prompt adherence (1.0-20.0, default 3.0)" },
        extra_guidance_scale: { type: "number", description: "Additional guidance (default 3.0)" },
        style_strength: { type: "number", description: "Style image influence (default 0.0)" },
        skeleton_guidance_scale: { type: "number", description: "Skeleton keypoint influence (default 1.0)" },
        ...styleParams,
        view: viewEnum,
        direction: directionEnum,
        isometric,
        oblique_projection: obliqueProjection,
        no_background: noBackground,
        coverage_percentage: coveragePercentage,
        init_image: imageSchema("Starting image"),
        init_image_strength: initImageStrength,
        style_image: imageSchema("Style reference"),
        inpainting_image: imageSchema("Image to inpaint on"),
        mask_image: imageSchema("Inpainting mask"),
        skeleton_keypoints: { type: "array", description: "Body joint positions" },
        color_image: colorImage,
        seed,
      },
      required: ["description", "image_size"],
    },
    handler: async (client, args) => client.post("/create-image-bitforge", args),
  },

  // ═══════ IMAGE OPERATIONS ═══════
  {
    name: "image_to_pixelart",
    description:
      "Convert a photograph or regular image into pixel art. Input max 1280x1280, output max 320x320.",
    inputSchema: {
      type: "object",
      properties: {
        image: imageSchema("Source image to convert"),
        image_size: sizeSchema("Input image dimensions"),
        output_size: sizeSchema("Target pixel art size (max 320x320)"),
      },
      required: ["image", "image_size", "output_size"],
    },
    handler: async (client, args) => client.post("/image-to-pixelart", args),
  },
  {
    name: "resize_image",
    description:
      "AI-powered resize of a pixel art image to a different resolution while preserving quality.",
    inputSchema: {
      type: "object",
      properties: {
        description: { type: "string", description: "Description of the character/object" },
        reference_image: imageSchema("Image to resize"),
        reference_image_size: sizeSchema("Current image dimensions"),
        target_size: sizeSchema("Target dimensions (16-200px)"),
        init_image: imageSchema("Optional initialization image"),
        color_image: colorImage,
        no_background: noBackground,
        seed,
      },
      required: ["description", "reference_image", "reference_image_size", "target_size"],
    },
    handler: async (client, args) => client.post("/resize", args),
  },
  {
    name: "remove_background",
    description: "Remove the background from a pixel art image (max 400x400).",
    inputSchema: {
      type: "object",
      properties: {
        image: imageSchema("Source image"),
        image_size: sizeSchema("Image dimensions"),
        background_removal_task: {
          type: "string",
          enum: ["remove_simple_background", "remove_complex_background"],
          description: "Type of background removal",
        },
        text_hint: { type: "string", description: "Description of the foreground object" },
      },
      required: ["image", "image_size"],
    },
    handler: async (client, args) => client.post("/remove-background", args),
  },

  // ═══════ ANIMATION (Pro/v2) ═══════
  {
    name: "edit_animation",
    description:
      "Edit an existing animation sequence (2-16 frames) using a text description.",
    inputSchema: {
      type: "object",
      properties: {
        description: { type: "string", description: "Edit description" },
        frames: {
          type: "array",
          description: "Animation frames (2-16)",
          items: imageSchema("Animation frame"),
        },
        image_size: sizeSchema("Frame dimensions (16-256px)"),
        remove_background: removeBackground,
        guidance_scale: { type: "number", description: "Prompt adherence (1.0-20.0, default 8.0)" },
      },
      required: ["description", "frames", "image_size"],
    },
    handler: async (client, args) => client.post("/edit-animation-v2", args),
  },
  {
    name: "interpolate_frames",
    description:
      "Generate intermediate animation frames between a start and end keyframe. Size 16x16 to 128x128.",
    inputSchema: {
      type: "object",
      properties: {
        start_image: imageSchema("First keyframe"),
        end_image: imageSchema("Last keyframe"),
        action: { type: "string", description: "Animation action description" },
        image_size: sizeSchema("Frame size (16x16 to 128x128)"),
        remove_background: removeBackground,
        guidance_scale: { type: "number", description: "Prompt adherence (1.0-20.0, default 8.0)" },
      },
      required: ["start_image", "end_image", "action", "image_size"],
    },
    handler: async (client, args) => client.post("/interpolation-v2", args),
  },
  {
    name: "transfer_outfit",
    description:
      "Transfer an outfit from a reference image onto animation frames (2-16 frames).",
    inputSchema: {
      type: "object",
      properties: {
        reference_image: frameImageSchema("Outfit source image with dimensions"),
        frames: {
          type: "array",
          description: "Animation frames (2-16) with dimensions",
          items: frameImageSchema("Frame with dimensions"),
        },
        image_size: sizeSchema("Output frame dimensions"),
        remove_background: removeBackground,
        ai_freedom: { type: "number", description: "Creativity level (0-1000, default 500)" },
      },
      required: ["reference_image", "frames", "image_size"],
    },
    handler: async (client, args) => client.post("/transfer-outfit-v2", args),
  },

  // ═══════ ANIMATION (Legacy) ═══════
  {
    name: "animate_with_skeleton",
    description:
      "Create animation using skeleton keypoints for precise pose control. Size 16x16 to 256x256.",
    inputSchema: {
      type: "object",
      properties: {
        image_size: sizeSchema("16x16 to 256x256"),
        skeleton_keypoints: { type: "array", description: "Body joint positions per frame" },
        view: viewEnum,
        direction: directionEnum,
        reference_guidance_scale: { type: "number", description: "Reference image influence (default 1.1)" },
        pose_guidance_scale: { type: "number", description: "Skeleton pose influence (default 3.0)" },
        isometric,
        oblique_projection: obliqueProjection,
        reference_image: imageSchema("Character reference"),
        init_images: { type: "array", items: imageSchema("Init image"), description: "Initialization images per frame" },
        init_image_strength: initImageStrength,
        inpainting_images: { type: "array", items: imageSchema("Inpainting image") },
        mask_images: { type: "array", items: imageSchema("Mask image") },
        color_image: colorImage,
        seed,
      },
      required: ["image_size", "skeleton_keypoints", "view", "direction"],
    },
    handler: async (client, args) => client.post("/animate-with-skeleton", args),
  },
  {
    name: "animate_with_text",
    description:
      "Create a character animation from text description and action. Fixed 64x64 size.",
    inputSchema: {
      type: "object",
      properties: {
        description: { type: "string", description: "Character description" },
        action: { type: "string", description: "Animation action (e.g. 'walking', 'attacking')" },
        image_size: sizeSchema("Frame size"),
        reference_image: imageSchema("Character reference"),
        view: { ...viewEnum, description: "Camera angle (default 'side')" },
        direction: { ...directionEnum, description: "Facing direction (default 'east')" },
        negative_description: negativeDescription,
        text_guidance_scale: { type: "number", description: "Text prompt influence (1.0-20.0, default 7.5)" },
        image_guidance_scale: { type: "number", description: "Reference image influence (default 1.5)" },
        n_frames: { type: "number", description: "Number of frames (default 4)" },
        start_frame_index: { type: "number", description: "Starting frame index (default 0)" },
        init_images: { type: "array", items: imageSchema("Init image"), description: "Initialization images per frame" },
        init_image_strength: initImageStrength,
        inpainting_images: { type: "array", items: imageSchema("Inpainting image") },
        mask_images: { type: "array", items: imageSchema("Mask image") },
        color_image: colorImage,
        seed,
      },
      required: ["description", "action", "image_size", "reference_image"],
    },
    handler: async (client, args) => client.post("/animate-with-text", args),
  },
  {
    name: "animate_with_text_v2",
    description:
      "Animate an existing character image with text-described action. Size 32x32 to 256x256.",
    inputSchema: {
      type: "object",
      properties: {
        reference_image: frameImageSchema("Character image to animate with dimensions"),
        reference_image_size: sizeSchema("Character image dimensions"),
        action: { type: "string", description: "Action to animate (e.g. 'walk', 'cast spell')" },
        image_size: sizeSchema("Output frame size (32x32 to 256x256)"),
        view: {
          type: "string",
          enum: ["none", "low_top_down", "high_top_down", "side"],
          description: "Camera perspective (default 'none')",
        },
        direction: {
          type: "string",
          enum: ["none", "south", "north", "east", "west", "south-east", "south-west", "north-east", "north-west"],
          description: "Facing direction (default 'none')",
        },
        remove_background: removeBackground,
        ai_freedom: { type: "number", description: "Creativity level (0-1000, default 500)" },
      },
      required: ["reference_image", "reference_image_size", "action", "image_size"],
    },
    handler: async (client, args) => client.post("/animate-with-text-v2", args),
  },
  {
    name: "animate_with_text_v3",
    description:
      "Animate from a first frame with optional last frame keyframe. 4-16 frames output.",
    inputSchema: {
      type: "object",
      properties: {
        first_frame: imageSchema("Starting frame image"),
        action: { type: "string", description: "Action description" },
        frame_count: { type: "number", description: "Number of frames (4-16, default 4)" },
        last_frame: imageSchema("Optional ending keyframe"),
        guidance_scale: { type: "number", description: "Prompt adherence (1.0-20.0, default 7.5)" },
        ai_freedom: { type: "number", description: "Creativity level (0-1000)" },
      },
      required: ["first_frame", "action"],
    },
    handler: async (client, args) => client.post("/animate-with-text-v3", args),
  },
  {
    name: "estimate_skeleton",
    description:
      "Estimate skeleton keypoints from a character image. Size 16x16 to 256x256.",
    inputSchema: {
      type: "object",
      properties: {
        image: imageSchema("Character image"),
        image_size: sizeSchema("Image dimensions"),
      },
      required: ["image", "image_size"],
    },
    handler: async (client, args) => client.post("/estimate-skeleton", args),
  },

  // ═══════ ROTATION ═══════
  {
    name: "generate_8_rotations",
    description:
      "Generate 8 directional views of a character. Methods: rotate_character, create_with_style, create_from_concept. Size 32x32 to 168x168.",
    inputSchema: {
      type: "object",
      properties: {
        method: {
          type: "string",
          enum: ["rotate_character", "create_with_style", "create_from_concept"],
          description: "Generation method",
        },
        image_size: sizeSchema("32x32 to 168x168"),
        view: viewEnum,
        reference_image: frameImageSchema("For rotate_character: character image with dimensions"),
        description: { type: "string", description: "For create_with_style: character description" },
        concept_image: imageSchema("For create_from_concept: concept art"),
        ai_freedom: { type: "number", description: "Creativity level (0-1000, default 500)" },
        remove_background: removeBackground,
        color_image: colorImage,
        seed,
      },
      required: ["method", "image_size"],
    },
    handler: async (client, args) => client.post("/generate-8-rotations-v2", args),
  },
  {
    name: "rotate",
    description:
      "Rotate a character from one view/direction to another. Size 16x16 to 128x128.",
    inputSchema: {
      type: "object",
      properties: {
        image_size: sizeSchema("16x16 to 128x128"),
        from_image: imageSchema("Source image"),
        from_view: viewEnum,
        to_view: viewEnum,
        from_direction: directionEnum,
        to_direction: directionEnum,
        view_change: { type: "number", description: "Relative view change (alternative to from/to_view)" },
        direction_change: { type: "number", description: "Relative direction change (alternative to from/to_direction)" },
        image_guidance_scale: { type: "number", description: "Source image influence (default 3.0)" },
        isometric,
        oblique_projection: obliqueProjection,
        init_image: imageSchema("Initialization image"),
        init_image_strength: initImageStrength,
        mask_image: imageSchema("Mask image"),
        color_image: colorImage,
        seed,
      },
      required: ["image_size", "from_image"],
    },
    handler: async (client, args) => client.post("/rotate", args),
  },

  // ═══════ INPAINTING & EDITING ═══════
  {
    name: "inpaint_v3",
    description:
      "Edit a specific region of a pixel art image using a mask. White mask = generate, black mask = preserve. Size 32-512px.",
    inputSchema: {
      type: "object",
      properties: {
        description: { type: "string", description: "What to generate in the masked area" },
        inpainting_image: imageSchema("Image to edit"),
        mask_image: imageSchema("Mask (white=generate, black=preserve)"),
        inpainting_image_size: sizeSchema("Image dimensions (32-512px)"),
        context_image: imageSchema("Style guidance image (up to 1024x1024)"),
        context_image_size: sizeSchema("Context image dimensions", false),
        bounding_box: {
          type: "object",
          description: "Precise editing area within the image",
          properties: {
            x: { type: "number" }, y: { type: "number" },
            width: { type: "number" }, height: { type: "number" },
          },
        },
        remove_background: removeBackground,
        ai_freedom: { type: "number", description: "Creativity level (0-1000, default 500)" },
      },
      required: ["description", "inpainting_image", "mask_image", "inpainting_image_size"],
    },
    handler: async (client, args) => client.post("/inpaint-v3", args),
  },
  {
    name: "inpaint",
    description:
      "Inpaint a pixel art image using the legacy Bitforge engine. Max 200x200.",
    inputSchema: {
      type: "object",
      properties: {
        description: { type: "string", description: "What to generate" },
        image_size: sizeSchema("Max 200x200"),
        inpainting_image: imageSchema("Image to edit"),
        mask_image: imageSchema("Mask image"),
        negative_description: negativeDescription,
        text_guidance_scale: { type: "number", description: "Text prompt influence (1.0-20.0, default 3.0)" },
        extra_guidance_scale: { type: "number", description: "Additional guidance (default 3.0)" },
        ...styleParams,
        view: viewEnum,
        direction: directionEnum,
        isometric,
        oblique_projection: obliqueProjection,
        no_background: noBackground,
        init_image: imageSchema("Initialization image"),
        init_image_strength: initImageStrength,
        color_image: colorImage,
        seed,
      },
      required: ["description", "image_size", "inpainting_image", "mask_image"],
    },
    handler: async (client, args) => client.post("/inpaint", args),
  },
  {
    name: "edit_images",
    description:
      "Edit 1-16 images using text description or a reference image. Size 32x32 to 512x512.",
    inputSchema: {
      type: "object",
      properties: {
        method: {
          type: "string",
          enum: ["edit_with_text", "edit_with_reference"],
        },
        edit_images: {
          type: "array",
          description: "1-16 images to edit with dimensions",
          items: frameImageSchema("Image with dimensions"),
        },
        image_size: sizeSchema("Output size 32x32 to 512x512"),
        description: { type: "string", description: "Edit description (for edit_with_text)" },
        reference_image: frameImageSchema("Style reference with dimensions (for edit_with_reference)"),
        remove_background: removeBackground,
        ai_freedom: { type: "number", description: "Creativity level (0-1000, default 500)" },
      },
      required: ["method", "edit_images", "image_size"],
    },
    handler: async (client, args) => client.post("/edit-images-v2", args),
  },
  {
    name: "edit_image",
    description: "Edit a single image using a text description. Size 16x16 to 400x400.",
    inputSchema: {
      type: "object",
      properties: {
        description: { type: "string", description: "Edit description" },
        reference_image: imageSchema("Image to edit (16x16 to 400x400)"),
        reference_image_size: sizeSchema("Image dimensions"),
        target_canvas_size: sizeSchema("Output canvas size"),
        remove_background: removeBackground,
        ai_freedom: { type: "number", description: "Creativity level (0-1000, default 500)" },
      },
      required: ["description", "reference_image", "reference_image_size", "target_canvas_size"],
    },
    handler: async (client, args) => client.post("/edit-image", args),
  },

  // ═══════ TILESETS ═══════
  {
    name: "create_tileset",
    description:
      "Create a top-down tileset with base terrain, elevated terrain, and transitions. Tile size 16x16 or 32x32.",
    inputSchema: {
      type: "object",
      properties: {
        lower_description: { type: "string", description: "Base terrain (e.g. 'deep blue ocean water')" },
        upper_description: { type: "string", description: "Elevated terrain (e.g. 'golden sandy beach')" },
        transition_description: { type: "string", description: "Transition terrain (e.g. 'wet sand with foam')" },
        tile_size: sizeSchema("16x16 or 32x32"),
        transition_size: { type: "number", description: "Elevation difference 0.25-1.0 (default 0.5)" },
        view: { ...viewEnum, description: "Camera perspective (default 'high_top_down')" },
        ...styleParams,
        reference_image: imageSchema("Style reference image"),
        color_image: colorImage,
        seed,
      },
      required: ["lower_description", "upper_description", "tile_size"],
    },
    handler: async (client, args) => client.post("/create-tileset", args),
  },
  {
    name: "get_tileset",
    description: "Get a previously created tileset by ID.",
    inputSchema: {
      type: "object",
      properties: {
        tileset_id: { type: "string", description: "Tileset ID" },
      },
      required: ["tileset_id"],
    },
    handler: async (client, args) =>
      client.get(`/tilesets/${args.tileset_id}`),
  },
  {
    name: "create_tileset_sidescroller",
    description:
      "Create a sidescroller/platformer tileset with terrain and transitions.",
    inputSchema: {
      type: "object",
      properties: {
        lower_description: { type: "string", description: "Base terrain description" },
        transition_description: { type: "string", description: "Transition description" },
        tile_size: sizeSchema("Tile dimensions (16x16 or 32x32)"),
        transition_size: { type: "number", description: "0.25-1.0 (default 0.5)" },
        ...styleParams,
        reference_image: imageSchema("Style reference image"),
        color_image: colorImage,
        seed,
      },
      required: ["lower_description", "tile_size"],
    },
    handler: async (client, args) =>
      client.post("/create-tileset-sidescroller", args),
  },
  {
    name: "create_isometric_tile",
    description: "Create an isometric tile. Size 16x16 to 64x64.",
    inputSchema: {
      type: "object",
      properties: {
        description: { type: "string", description: "Tile description" },
        image_size: sizeSchema("16x16 to 64x64"),
        init_image: imageSchema("Optional starting image"),
        color_image: colorImage,
        seed,
      },
      required: ["description", "image_size"],
    },
    handler: async (client, args) =>
      client.post("/create-isometric-tile", args),
  },
  {
    name: "get_isometric_tile",
    description: "Get a previously created isometric tile by ID.",
    inputSchema: {
      type: "object",
      properties: {
        tile_id: { type: "string", description: "Isometric tile ID" },
      },
      required: ["tile_id"],
    },
    handler: async (client, args) =>
      client.get(`/isometric-tiles/${args.tile_id}`),
  },
  {
    name: "create_tiles_pro",
    description:
      "Create professional tiles. Types: hex, hex_pointy, isometric, octagon, square_topdown. Size 16-128px.",
    inputSchema: {
      type: "object",
      properties: {
        description: { type: "string", description: "Tile description" },
        tile_type: {
          type: "string",
          enum: ["hex", "hex_pointy", "isometric", "octagon", "square_topdown"],
          description: "Type of tile",
        },
        tile_size: { type: "number", description: "Tile size in pixels (16-128)" },
        n_tiles: { type: "number", description: "Number of tiles to generate" },
      },
      required: ["description", "tile_type", "tile_size", "n_tiles"],
    },
    handler: async (client, args) => client.post("/create-tiles-pro", args),
  },
  {
    name: "get_tiles_pro",
    description: "Get previously created pro tiles by ID.",
    inputSchema: {
      type: "object",
      properties: {
        tile_id: { type: "string", description: "Tiles pro ID" },
      },
      required: ["tile_id"],
    },
    handler: async (client, args) =>
      client.get(`/tiles-pro/${args.tile_id}`),
  },

  // ═══════ MAP OBJECTS ═══════
  {
    name: "create_map_object",
    description:
      "Generate a map object with transparent background for game use.",
    inputSchema: {
      type: "object",
      properties: {
        description: { type: "string", description: "Object description" },
        image_size: sizeSchema("Output dimensions"),
        view: viewEnum,
        ...styleParams,
        color_image: colorImage,
        seed,
      },
      required: ["description", "image_size"],
    },
    handler: async (client, args) => client.post("/map-objects", args),
  },

  // ═══════ CHARACTERS ═══════
  {
    name: "create_character_4dir",
    description:
      "Create a persistent character with 4 directional views (N/S/E/W). Size 32x32 to 168x168.",
    inputSchema: {
      type: "object",
      properties: {
        description: { type: "string", description: "Character description" },
        image_size: sizeSchema("Character sprite dimensions (32x32 to 168x168)"),
        view: viewEnum,
        proportions: proportionsSchema,
        guidance_scale: { type: "number", description: "Prompt adherence (1.0-20.0, default 8.0)" },
        ai_freedom: aiFreedom,
        color_palette: colorPaletteArray,
        ...styleParams,
        seed,
      },
      required: ["description", "image_size"],
    },
    handler: async (client, args) =>
      client.post("/create-character-with-4-directions", args),
  },
  {
    name: "create_character_8dir",
    description:
      "Create a persistent character with 8 directional views (N/NE/E/SE/S/SW/W/NW). Size 32x32 to 168x168.",
    inputSchema: {
      type: "object",
      properties: {
        description: { type: "string", description: "Character description" },
        image_size: sizeSchema("Character sprite dimensions (32x32 to 168x168)"),
        view: viewEnum,
        proportions: proportionsSchema,
        guidance_scale: { type: "number", description: "Prompt adherence (1.0-20.0, default 8.0)" },
        ai_freedom: aiFreedom,
        color_palette: colorPaletteArray,
        ...styleParams,
        seed,
      },
      required: ["description", "image_size"],
    },
    handler: async (client, args) =>
      client.post("/create-character-with-8-directions", args),
  },
  {
    name: "animate_character",
    description:
      "Animate an existing character by ID with a specific animation type.",
    inputSchema: {
      type: "object",
      properties: {
        character_id: { type: "string", description: "Character ID" },
        animation_type: { type: "string", description: "Animation type (e.g. 'walk', 'run', 'idle', 'attack')" },
        directions: {
          type: "array",
          items: { type: "string" },
          description: "Specific directions to animate, or omit for all",
        },
        frame_count: { type: "number", description: "Number of frames (2-12)" },
        ai_freedom: aiFreedom,
        ...styleParams,
        seed,
      },
      required: ["character_id", "animation_type"],
    },
    handler: async (client, args) =>
      client.post("/animate-character", args),
  },
  {
    name: "list_characters",
    description: "List your created characters with pagination.",
    inputSchema: {
      type: "object",
      properties: {
        limit: { type: "number", description: "Results per page (1-100, default 50)" },
        offset: { type: "number", description: "Pagination offset" },
      },
    },
    handler: async (client, args) => {
      const params = new URLSearchParams();
      if (args.limit) params.set("limit", String(args.limit));
      if (args.offset) params.set("offset", String(args.offset));
      const qs = params.toString();
      return client.get(`/characters${qs ? `?${qs}` : ""}`);
    },
  },
  {
    name: "get_character",
    description: "Get a character by ID including all directional views and animations.",
    inputSchema: {
      type: "object",
      properties: {
        character_id: { type: "string", description: "Character ID" },
      },
      required: ["character_id"],
    },
    handler: async (client, args) =>
      client.get(`/characters/${args.character_id}`),
  },
  {
    name: "delete_character",
    description: "Delete a character by ID.",
    inputSchema: {
      type: "object",
      properties: {
        character_id: { type: "string", description: "Character ID" },
      },
      required: ["character_id"],
    },
    handler: async (client, args) =>
      client.delete(`/characters/${args.character_id}`),
  },
  {
    name: "download_character_zip",
    description: "Download a character as a ZIP file with all sprites and metadata.",
    inputSchema: {
      type: "object",
      properties: {
        character_id: { type: "string", description: "Character ID" },
      },
      required: ["character_id"],
    },
    handler: async (client, args) =>
      client.get(`/characters/${args.character_id}/zip`),
  },
  {
    name: "update_character_tags",
    description: "Update tags on a character (max 20 tags, 50 chars each).",
    inputSchema: {
      type: "object",
      properties: {
        character_id: { type: "string", description: "Character ID" },
        tags: {
          type: "array",
          items: { type: "string" },
          description: "Tags to set",
        },
      },
      required: ["character_id", "tags"],
    },
    handler: async (client, args) =>
      client.patch(`/characters/${args.character_id}/tags`, { tags: args.tags }),
  },

  // ═══════ OBJECTS ═══════
  {
    name: "create_object_4dir",
    description: "Create an object with 4 directional views.",
    inputSchema: {
      type: "object",
      properties: {
        description: { type: "string", description: "Object description" },
        image_size: sizeSchema("Object dimensions"),
        view: viewEnum,
        guidance_scale: { type: "number", description: "Prompt adherence (1.0-20.0, default 8.0)" },
        ai_freedom: aiFreedom,
        color_palette: colorPaletteArray,
        ...styleParams,
        seed,
      },
      required: ["description", "image_size"],
    },
    handler: async (client, args) =>
      client.post("/create-object-with-4-directions", args),
  },
  {
    name: "list_objects",
    description: "List your created objects with pagination.",
    inputSchema: {
      type: "object",
      properties: {
        limit: { type: "number", description: "1-100, default 50" },
        offset: { type: "number" },
      },
    },
    handler: async (client, args) => {
      const params = new URLSearchParams();
      if (args.limit) params.set("limit", String(args.limit));
      if (args.offset) params.set("offset", String(args.offset));
      const qs = params.toString();
      return client.get(`/objects${qs ? `?${qs}` : ""}`);
    },
  },
  {
    name: "get_object",
    description: "Get an object by ID.",
    inputSchema: {
      type: "object",
      properties: {
        object_id: { type: "string", description: "Object ID" },
      },
      required: ["object_id"],
    },
    handler: async (client, args) =>
      client.get(`/objects/${args.object_id}`),
  },
  {
    name: "delete_object",
    description: "Delete an object by ID.",
    inputSchema: {
      type: "object",
      properties: {
        object_id: { type: "string", description: "Object ID" },
      },
      required: ["object_id"],
    },
    handler: async (client, args) =>
      client.delete(`/objects/${args.object_id}`),
  },
  {
    name: "update_object_tags",
    description: "Update tags on an object.",
    inputSchema: {
      type: "object",
      properties: {
        object_id: { type: "string", description: "Object ID" },
        tags: {
          type: "array",
          items: { type: "string" },
          description: "Tags to set",
        },
      },
      required: ["object_id", "tags"],
    },
    handler: async (client, args) =>
      client.patch(`/objects/${args.object_id}/tags`, { tags: args.tags }),
  },
];
