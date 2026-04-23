import { readFileSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";
import type { PixelLabClient } from "./api-client.js";
import { getPendingJobs, getJobLog } from "./job-log.js";
import { OUTPUT_DIR, ensureOutputDir } from "./save-images.js";

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
      type: { type: "string", const: "base64", default: "base64", description: "Image data type (always \"base64\")" },
      base64: { type: "string", description: "Base64-encoded PNG image data" },
      format: { type: "string", default: "png", description: "Image format (default \"png\")" },
    },
    required: ["base64"],
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
      width: { type: "integer", description: "Width in pixels" },
      height: { type: "integer", description: "Height in pixels" },
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
const noBackground = { type: "boolean", description: "Generate with transparent background", default: true };
const textGuidanceScale = { type: "number", description: "How closely to follow the text (1.0-20.0, default 8)", minimum: 1, maximum: 20 };
const forceColors = { type: "boolean", description: "Force use of colors from color_image (default false)" };
const colorImage = imageSchema("Color palette reference image");

const styleParams = {
  outline: { type: "string", description: "Outline style" },
  shading: { type: "string", description: "Shading style" },
  detail: { type: "string", description: "Detail level" },
};

const viewEnum = {
  type: "string",
  enum: ["low top-down", "high top-down", "side"],
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
    description: "Check the status of a background job and retrieve its results when complete. All creation tools return a job_id immediately — use this tool to poll for completion and get the generated images/data.",
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
      "Generate pixel art from a text description. PRIMARY generation tool — use this for standalone sprites, icons, and one-off images. 16-512px. Variants by size: ≤42px → 64, 43-85px → 16, 86-170px → 4, >170px → 1. For style-matched sets use generate_with_style. For game characters with directional views use create_character_4dir/8dir instead. For UI elements use generate_ui.",
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
        style_options: {
          type: "object",
          description: "Options controlling what to copy from the style image",
          properties: {
            copy_outline: { type: "boolean", description: "Copy outline style" },
            copy_shading: { type: "boolean", description: "Copy shading style" },
            copy_detail: { type: "boolean", description: "Copy detail level" },
            copy_colors: { type: "boolean", description: "Copy color palette" },
          },
        },
        seed,
        no_background: noBackground,
      },
      required: ["description", "image_size"],
    },
    handler: async (client, args) => client.post("/generate-image-v2", args),
  },
  {
    name: "generate_with_style",
    description:
      "Generate pixel art matching a specific visual style from 1-4 style reference images. Use this when you need consistent style across multiple assets. SQUARE images only, 16-512px. Auto-pads to nearest bucket (16/32/64/128/256/512). Variants: 16-32px → 64, 33-64px → 16, 65-128px → 4, 129-512px → 1.",
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
        seed,
        no_background: noBackground,
      },
      required: ["style_images", "description", "image_size"],
    },
    handler: async (client, args) => client.post("/generate-with-style-v2", args),
  },
  {
    name: "generate_ui",
    description: "Generate pixel art UI elements for games — buttons, panels, health bars, inventory slots, icons, frames. Use this instead of generate_image when creating interface/HUD elements. Min 16x16, max 512x512.",
    inputSchema: {
      type: "object",
      properties: {
        description: { type: "string", description: "UI element description (e.g. 'medieval stone button with gold trim')" },
        image_size: sizeSchema("Output dimensions (min 16x16)"),
        concept_image: imageSchema("Design guidance image"),
        color_palette: { type: "string", description: "Color palette description (e.g. 'brown and gold')" },
        seed,
        no_background: noBackground,
      },
      required: ["description", "image_size"],
    },
    handler: async (client, args) => client.post("/generate-ui-v2", args),
  },

  // ═══════ IMAGE GENERATION (Legacy engines) ═══════
  {
    name: "create_image_pixflux",
    description:
      "Generate pixel art using the legacy Pixflux engine. 32-400px. Prefer generate_image (v2) for most tasks — use Pixflux only when you need fine-grained control over outline/shading/detail style params, view/direction, or coverage_percentage.",
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
      "Generate pixel art using the legacy Bitforge engine. Max 200x200. Prefer generate_image (v2) for most tasks — use Bitforge only when you need inline skeleton keypoints, combined inpainting+generation, or style_image influence control in a single call.",
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
      "Convert a photograph or regular image into pixel art. Input 16-1280px, output 16-320px. Recommended: output = 1/4 of input size.",
    inputSchema: {
      type: "object",
      properties: {
        image: imageSchema("Source image to convert"),
        image_size: sizeSchema("Input image dimensions"),
        output_size: sizeSchema("Target pixel art size (max 320x320)"),
        text_guidance_scale: { type: "number", description: "Pixel art style adherence (default 8.0)" },
        seed,
      },
      required: ["image", "image_size", "output_size"],
    },
    handler: async (client, args) => client.post("/image-to-pixelart", args),
  },
  {
    name: "resize_image",
    description:
      "AI-powered resize of a pixel art image to a different resolution while preserving quality. Source and target 16-200px. Best in steps: max 50% shrink or 2x grow per operation.",
    inputSchema: {
      type: "object",
      properties: {
        description: { type: "string", description: "Description of the character/object" },
        reference_image: imageSchema("Image to resize"),
        reference_image_size: sizeSchema("Current image dimensions"),
        target_size: sizeSchema("Target dimensions (16-200px)"),
        view: viewEnum,
        direction: directionEnum,
        isometric,
        oblique_projection: obliqueProjection,
        no_background: noBackground,
        color_image: colorImage,
        init_image: imageSchema("Optional initialization image"),
        init_image_strength: { type: "number", description: "Init image influence (default 150.0)" },
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
          description: "Type of background removal (default remove_simple_background)",
        },
        text: { type: "string", description: "Description of the foreground object to help removal" },
        seed,
      },
      required: ["image", "image_size"],
    },
    handler: async (client, args) => client.post("/remove-background", args),
  },

  // ═══════ ANIMATION (Pro/v2) ═══════
  {
    name: "edit_animation",
    description:
      "Edit an existing animation sequence (2-16 frames) using a text description. 16-256px. Use this to modify animations you already have — to create new animations from scratch use animate_with_text_v2 or animate_character.",
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
        seed,
        no_background: noBackground,
      },
      required: ["description", "frames", "image_size"],
    },
    handler: async (client, args) => client.post("/edit-animation-v2", args),
  },
  {
    name: "interpolate_frames",
    description:
      "Generate intermediate animation frames between a start and end keyframe. 16-128px. Use this to smooth out animations by adding in-between frames. For full animation creation from a single image use animate_with_text_v2.",
    inputSchema: {
      type: "object",
      properties: {
        start_image: imageSchema("First keyframe"),
        end_image: imageSchema("Last keyframe"),
        action: { type: "string", description: "Animation action description" },
        image_size: sizeSchema("Frame size (16x16 to 128x128)"),
        seed,
        no_background: noBackground,
      },
      required: ["start_image", "end_image", "action", "image_size"],
    },
    handler: async (client, args) => client.post("/interpolation-v2", args),
  },
  {
    name: "transfer_outfit",
    description:
      "Transfer an outfit/costume from a reference image onto animation frames (2-16 frames, 32-256px). Use this to reskin an existing animation with a different character appearance.",
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
        seed,
        no_background: noBackground,
      },
      required: ["reference_image", "frames", "image_size"],
    },
    handler: async (client, args) => client.post("/transfer-outfit-v2", args),
  },

  // ═══════ ANIMATION (Legacy) ═══════
  {
    name: "animate_with_skeleton",
    description:
      "Create animation using skeleton keypoints for precise joint/pose control. Fixed sizes only: 16, 32, 64, 128, or 256px. Use this when you need exact body positioning per frame. For simpler text-described animation use animate_with_text_v2.",
    inputSchema: {
      type: "object",
      properties: {
        image_size: sizeSchema("16x16 to 256x256"),
        skeleton_keypoints: { type: "array", description: "Body joint positions per frame" },
        view: viewEnum,
        direction: directionEnum,
        guidance_scale: { type: "number", description: "How closely to follow reference image and skeleton keypoints (1.0-20.0, default 4.0)", minimum: 1, maximum: 20 },
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
      "Legacy animation from text description + reference image. FIXED 64x64 only. Prefer animate_with_text_v2 (any size 32-256px) or animate_with_text_v3 (keyframe-based) for new work. Use animate_character if you already have a saved character ID.",
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
      "RECOMMENDED animation tool — animate a character image with a text-described action. Provide a reference image + action text. 32-256px. Frames by size: 32-64px → 16, 128-256px → 4. Use this when you have a character image but NOT a saved character ID. If you have a character ID, use animate_character instead.",
    inputSchema: {
      type: "object",
      properties: {
        reference_image: frameImageSchema("Character image to animate with dimensions"),
        reference_image_size: sizeSchema("Character image dimensions"),
        action: { type: "string", description: "Action to animate (e.g. 'walk', 'cast spell')" },
        image_size: sizeSchema("Output frame size (32x32 to 256x256)"),
        view: {
          type: "string",
          enum: ["none", "low top-down", "high top-down", "side"],
          description: "Camera perspective (default 'none')",
        },
        direction: {
          type: "string",
          enum: ["none", "south", "north", "east", "west", "south-east", "south-west", "north-east", "north-west"],
          description: "Facing direction (default 'none')",
        },
        seed,
        no_background: noBackground,
      },
      required: ["reference_image", "reference_image_size", "action", "image_size"],
    },
    handler: async (client, args) => client.post("/animate-with-text-v2", args),
  },
  {
    name: "animate_with_text_v3",
    description:
      "Keyframe-based animation — provide a first frame and optional last frame, get interpolated animation. Best for precise start/end control. 4-16 frames, max 256px. Pixel budget: W×H×frames ≤ 524,288. Use animate_with_text_v2 instead if you just want to describe an action.",
    inputSchema: {
      type: "object",
      properties: {
        first_frame: imageSchema("Starting frame image"),
        action: { type: "string", description: "Action description" },
        frame_count: { type: "integer", description: "Number of frames (4-16, default 8, must be even)" },
        last_frame: imageSchema("Optional ending keyframe"),
        seed,
        no_background: noBackground,
      },
      required: ["first_frame", "action"],
    },
    handler: async (client, args) => client.post("/animate-with-text-v3", args),
  },
  {
    name: "estimate_skeleton",
    description:
      "Estimate skeleton keypoints from a character image.",
    inputSchema: {
      type: "object",
      properties: {
        image: imageSchema("Character image"),
      },
      required: ["image"],
    },
    handler: async (client, args) => client.post("/estimate-skeleton", args),
  },

  // ═══════ ROTATION ═══════
  {
    name: "generate_8_rotations",
    description:
      "Generate 8 directional views from an existing image, style, or concept art. 32-168px. Does NOT create a persistent character — for that use create_character_8dir instead. Methods: rotate_character (from existing sprite), create_with_style (from description), create_from_concept (from concept art).",
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
        style_description: { type: "string", description: "Style description for the character" },
        no_background: noBackground,
        seed,
      },
      required: ["method", "image_size"],
    },
    handler: async (client, args) => client.post("/generate-8-rotations-v2", args),
  },
  {
    name: "rotate",
    description:
      "Rotate a single character sprite from one view/direction to another. Fixed sizes only: 16, 32, 64, or 128px. For generating all 8 directions at once use generate_8_rotations or create_character_8dir instead.",
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
      "Edit a specific region of a pixel art image using a mask. White mask = generate, black mask = preserve. Image 32-512px, optional context image up to 1024x1024. Preferred over legacy inpaint (which caps at 200px).",
    inputSchema: {
      type: "object",
      properties: {
        description: { type: "string", description: "What to generate in the masked area" },
        inpainting_image: imageSchema("Image to edit"),
        mask_image: imageSchema("Mask (white=generate, black=preserve)"),
        context_image: imageSchema("Style guidance image (up to 1024x1024) (deprecated)"),
        bounding_box: {
          type: "object",
          description: "Precise editing area within the image (deprecated)",
          properties: {
            x: { type: "number" }, y: { type: "number" },
            width: { type: "number" }, height: { type: "number" },
          },
        },
        seed,
        no_background: noBackground,
        crop_to_mask: { type: "boolean", description: "Whether to crop generated content to mask boundary (default true)" },
      },
      required: ["description", "inpainting_image", "mask_image"],
    },
    handler: async (client, args) => client.post("/inpaint-v3", args),
  },
  {
    name: "inpaint",
    description:
      "Legacy inpainting using the Bitforge engine. Max 200x200. Prefer inpaint_v3 (up to 512px, better quality). Only use this if you need Bitforge-specific params like style controls or oblique projection during inpainting.",
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
      "Batch-edit 1-16 images consistently using text or a reference image. Use this for editing animation frames or sprite sets uniformly. Output 32-512px, input max 256px each. Max frames by output size: 32-64px → 16, 65-80px → 9, 81-128px → 4, 129-512px → 1. For single image edits use edit_image instead.",
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
        seed,
        no_background: noBackground,
      },
      required: ["method", "edit_images", "image_size"],
    },
    handler: async (client, args) => client.post("/edit-images-v2", args),
  },
  {
    name: "edit_image",
    description: "Edit a single image globally using a text description (e.g. 'add a hat', 'change colors'). 16-400px. For editing a specific REGION use inpaint_v3 with a mask instead. For batch-editing multiple images at once use edit_images.",
    inputSchema: {
      type: "object",
      properties: {
        image: imageSchema("Image to edit"),
        image_size: sizeSchema("Current image dimensions"),
        description: { type: "string", description: "Edit description" },
        width: { type: "number", description: "Target canvas width (16-400px)" },
        height: { type: "number", description: "Target canvas height (16-400px)" },
        seed,
        no_background: noBackground,
        text_guidance_scale: { type: "number", description: "How closely to follow text (1.0-10.0, default 8)" },
        color_image: imageSchema("Color reference image"),
      },
      required: ["image", "image_size", "description", "width", "height"],
    },
    handler: async (client, args) => client.post("/edit-image", args),
  },

  // ═══════ TILESETS ═══════
  {
    name: "create_tileset",
    description:
      "Create a TOP-DOWN tileset with base terrain, elevated terrain, and transitions (16x16 or 32x32 tiles). Outputs 16-23 seamless tiles. Use this for RPG/strategy maps. For platformer/sidescroller games use create_tileset_sidescroller. For isometric games use create_isometric_tile or create_tiles_pro.",
    inputSchema: {
      type: "object",
      properties: {
        lower_description: { type: "string", description: "Base terrain (e.g. 'deep blue ocean water')" },
        upper_description: { type: "string", description: "Elevated terrain (e.g. 'golden sandy beach')" },
        transition_description: { type: "string", description: "Transition terrain (e.g. 'wet sand with foam')" },
        tile_size: sizeSchema("16x16 or 32x32"),
        transition_size: { type: "number", description: "Elevation difference 0.25-1.0 (default 0.5)" },
        view: {
          type: "string",
          enum: ["low top-down", "high top-down"],
          description: "Camera perspective (default 'high top-down')",
        },
        ...styleParams,
        lower_base_tile_id: { type: "string", description: "ID of existing lower base tile to use" },
        upper_base_tile_id: { type: "string", description: "ID of existing upper base tile to use" },
        text_guidance_scale: { type: "number", description: "How closely to follow text (1-20, default 8)", minimum: 1, maximum: 20 },
        tile_strength: { type: "number", description: "Tile pattern strength (0.1-2, default 1)", minimum: 0.1, maximum: 2 },
        tileset_adherence_freedom: { type: "number", description: "Freedom from tileset constraints (0-900, default 500)", minimum: 0, maximum: 900 },
        tileset_adherence: { type: "number", description: "Adherence to tileset patterns (0-500, default 100)", minimum: 0, maximum: 500 },
        lower_reference_image: imageSchema("Reference image for lower terrain style"),
        upper_reference_image: imageSchema("Reference image for upper terrain style"),
        transition_reference_image: imageSchema("Reference image for transition style"),
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
      "Create a SIDESCROLLER/PLATFORMER tileset with terrain and transitions (16x16 or 32x32 tiles). Side-view perspective only. Use this for platformer games. For top-down RPG maps use create_tileset instead.",
    inputSchema: {
      type: "object",
      properties: {
        lower_description: { type: "string", description: "Base terrain description" },
        transition_description: { type: "string", description: "Transition description" },
        tile_size: sizeSchema("Tile dimensions (16x16 or 32x32)"),
        transition_size: { type: "number", description: "0.25-1.0 (default 0.5)" },
        ...styleParams,
        lower_base_tile_id: { type: "string", description: "ID of existing lower base tile to use" },
        text_guidance_scale: { type: "number", description: "How closely to follow text (1-20, default 8)", minimum: 1, maximum: 20 },
        tile_strength: { type: "number", description: "Tile pattern strength (0.1-2, default 1)", minimum: 0.1, maximum: 2 },
        tileset_adherence_freedom: { type: "number", description: "Freedom from tileset constraints (0-900, default 500)", minimum: 0, maximum: 900 },
        tileset_adherence: { type: "number", description: "Adherence to tileset patterns (0-500, default 100)", minimum: 0, maximum: 500 },
        lower_reference_image: imageSchema("Reference image for lower terrain style"),
        transition_reference_image: imageSchema("Reference image for transition style"),
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
    description: "Create an isometric tile. Size 16x16 to 64x64 (best quality >24px). For other tile types (hex, octagon, square_topdown) use create_tiles_pro instead.",
    inputSchema: {
      type: "object",
      properties: {
        description: { type: "string", description: "Tile description" },
        image_size: sizeSchema("16x16 to 64x64"),
        init_image: imageSchema("Optional starting image"),
        color_image: colorImage,
        seed,
        text_guidance_scale: { type: "number", description: "How closely to follow text (1-20, default 8)", minimum: 1, maximum: 20 },
        ...styleParams,
        init_image_strength: { type: "number", description: "Initial image influence strength (1-999, default 300)", minimum: 1, maximum: 999 },
        isometric_tile_size: { type: "number", description: "Isometric tile size in pixels (default 16)" },
        isometric_tile_shape: {
          type: "string",
          enum: ["thick tile", "thin tile", "block"],
          description: "Shape of the isometric tile (default 'block')",
        },
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
      "Create professional tiles. Types: hex, hex_pointy, isometric, octagon, square_topdown. Size 16-128px (32px recommended).",
    inputSchema: {
      type: "object",
      properties: {
        description: { type: "string", description: "Tile description" },
        tile_type: {
          type: "string",
          enum: ["hex", "hex_pointy", "isometric", "octagon", "square_topdown"],
          description: "Type of tile",
        },
        tile_size: { type: "integer", description: "Tile size in pixels (16-128, default 32)", minimum: 16, maximum: 128 },
        n_tiles: { type: "number", description: "Number of tiles to generate" },
        tile_height: { type: "number", description: "Tile height in pixels (16-128)", minimum: 16, maximum: 128 },
        tile_view: {
          type: "string",
          enum: ["top-down", "high top-down", "low top-down", "side"],
          description: "Camera perspective for tiles",
        },
        tile_view_angle: { type: "number", description: "View angle in degrees (0-90)" },
        tile_depth_ratio: { type: "number", description: "Depth ratio (0-1)" },
        seed,
        style_images: { type: "string", description: "Style reference images (JSON string)" },
        style_options: { type: "string", description: "Style options (JSON string)" },
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
      "Generate a single-view map object (tree, rock, chest, etc.) with transparent background. Use this for environment/prop assets that don't need multiple directions. For objects with 4 directional views use create_object_4dir. For characters use create_character_4dir/8dir.",
    inputSchema: {
      type: "object",
      properties: {
        description: { type: "string", description: "Object description" },
        image_size: sizeSchema("Output dimensions"),
        view: viewEnum,
        ...styleParams,
        color_image: colorImage,
        seed,
        text_guidance_scale: { type: "number", description: "How closely to follow text (1-20, default 8)", minimum: 1, maximum: 20 },
        init_image: imageSchema("Optional starting image"),
        init_image_strength: { type: "number", description: "Initial image influence strength (1-999, default 300)", minimum: 1, maximum: 999 },
        background_image: imageSchema("Background image for context"),
        inpainting: { type: "string", description: "Inpainting configuration (JSON string or object)" },
      },
      required: ["description", "image_size"],
    },
    handler: async (client, args) => client.post("/map-objects", args),
  },

  // ═══════ CHARACTERS ═══════
  {
    name: "create_character_4dir",
    description:
      "Create a PERSISTENT game character with 4 directional views (N/S/E/W). 32-168px. Returns a character_id that can be reused with animate_character for animations. Use this for game characters that need multiple directions and animations. For 8 directions use create_character_8dir. For one-off sprites without persistence use generate_image.",
    inputSchema: {
      type: "object",
      properties: {
        description: { type: "string", description: "Character description" },
        image_size: sizeSchema("Character sprite dimensions (32x32 to 168x168)"),
        view: viewEnum,
        proportions: proportionsSchema,
        text_guidance_scale: textGuidanceScale,
        isometric: { type: "boolean", description: "Generate in isometric view (default false)" },
        color_image: imageSchema("Color reference image"),
        force_colors: forceColors,
        template_id: { type: "string", description: "Template ID (e.g. 'mannequin' for humanoid, 'bear'/'cat'/'dog'/'horse'/'lion' for quadruped)" },
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
      "Create a PERSISTENT game character with 8 directional views (N/NE/E/SE/S/SW/W/NW). 32-168px. Returns a character_id for use with animate_character. Use this for top-down or isometric games needing diagonal directions. For 4-direction games use create_character_4dir.",
    inputSchema: {
      type: "object",
      properties: {
        description: { type: "string", description: "Character description" },
        image_size: sizeSchema("Character sprite dimensions (32x32 to 168x168)"),
        view: viewEnum,
        proportions: proportionsSchema,
        text_guidance_scale: textGuidanceScale,
        isometric: { type: "boolean", description: "Generate in isometric view (default false)" },
        color_image: imageSchema("Color reference image"),
        force_colors: forceColors,
        template_id: { type: "string", description: "Template ID (e.g. 'mannequin' for humanoid, 'bear'/'cat'/'dog'/'horse'/'lion' for quadruped)" },
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
      "Animate a SAVED character by ID using a preset animation template (walk, run, attack, etc). Requires a character_id from create_character_4dir/8dir. Uses the character's existing size. If you only have an image (not a saved character), use animate_with_text_v2 instead.",
    inputSchema: {
      type: "object",
      properties: {
        character_id: { type: "string", description: "Character ID" },
        template_animation_id: {
          type: "string",
          enum: [
            "backflip", "breathing-idle", "cross-punch", "crouched-walking",
            "crouching", "drinking", "falling-back-death", "fight-stance-idle-8-frames",
            "fireball", "flying-kick", "front-flip", "getting-up",
            "high-kick", "hurricane-kick", "jumping-1", "jumping-2",
            "lead-jab", "leg-sweep", "picking-up", "pull-heavy-object",
            "pushing", "roundhouse-kick", "running-4-frames", "running-6-frames",
            "running-8-frames", "running-jump", "running-slide", "sad-walk",
            "scary-walk", "surprise-uppercut", "taking-punch", "throw-object",
            "two-footed-jump", "walk", "walk-1", "walk-2",
            "walking", "walking-10", "walking-2", "walking-3",
            "walking-4", "walking-4-frames", "walking-5", "walking-6",
            "walking-6-frames", "walking-7", "walking-8", "walking-8-frames",
            "walking-9",
          ],
          description: "Animation template ID",
        },
        animation_name: { type: "string", description: "Custom animation name" },
        description: { type: "string", description: "Character description for context" },
        action_description: { type: "string", description: "Action description for custom animations" },
        directions: {
          type: "array",
          items: { type: "string" },
          description: "Specific directions to animate, or omit for all",
        },
        text_guidance_scale: textGuidanceScale,
        isometric: { type: "boolean", description: "Generate in isometric view" },
        color_image: imageSchema("Color reference image"),
        force_colors: forceColors,
        ...styleParams,
        seed,
      },
      required: ["character_id", "template_animation_id"],
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
    description: "Download a character as a ZIP file. Saves to the pixellab-forge-output directory and returns the file path.",
    inputSchema: {
      type: "object",
      properties: {
        character_id: { type: "string", description: "Character ID" },
      },
      required: ["character_id"],
    },
    handler: async (client, args) => {
      const { data } = await client.getBinary(`/characters/${args.character_id}/zip`);
      const buf = Buffer.from(data, "base64");
      ensureOutputDir();
      const filePath = join(OUTPUT_DIR, `character_${args.character_id}_${Date.now()}.zip`);
      writeFileSync(filePath, buf);
      return { success: true, file_path: filePath, size_bytes: buf.length };
    },
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
    description: "Create a persistent non-character object with 4 directional views (N/S/E/W). Use for furniture, vehicles, or props that the camera rotates around. For single-view props use create_map_object. For characters use create_character_4dir/8dir.",
    inputSchema: {
      type: "object",
      properties: {
        description: { type: "string", description: "Object description" },
        image_size: sizeSchema("Object dimensions"),
        view: viewEnum,
        text_guidance_scale: textGuidanceScale,
        color_image: imageSchema("Color reference image"),
        force_colors: forceColors,
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

  // ═══════ UTILITY ═══════
  {
    name: "read_image",
    description:
      "Read a previously saved image from disk and return it as a Base64Image object " +
      "that can be passed directly to other tools (e.g. edit_image, remove_background, " +
      "image_to_pixelart). Use the file paths shown in earlier tool responses.",
    inputSchema: {
      type: "object",
      properties: {
        file_path: {
          type: "string",
          description: "Absolute path to a saved PNG image (from a previous tool response)",
        },
      },
      required: ["file_path"],
    },
    handler: async (_client, args) => {
      const filePath = resolve(args.file_path as string);
      const buf = readFileSync(filePath);
      const base64 = buf.toString("base64");
      return { image: { type: "base64", base64, format: "png" } };
    },
  },
];
