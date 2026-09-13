import { readFileSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { resolve, join, basename } from "node:path";
import type { PixelLabClient } from "./api-client.js";
import { getPendingJobs, getJobLog } from "./job-log.js";
import { OUTPUT_DIR, ensureOutputDir } from "./save-images.js";

export interface ToolDef {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  handler: (client: PixelLabClient, args: Record<string, unknown>) => Promise<unknown>;
}

// Directories a file_path image argument is permitted to read from.
const ALLOWED_ROOTS = [resolve(OUTPUT_DIR), resolve(process.cwd())];

/**
 * Recursively resolve any nested image object that carries a `file_path` (and no
 * `base64`) into a full { type, base64, format } object, so callers can pass a
 * saved file path instead of pasting a large base64 blob into an image argument.
 *
 * Only ever called on argument *values*, never the top-level args object, so a
 * top-level `file_path` param (e.g. read_image's) is left untouched. Reads are
 * confined to ALLOWED_ROOTS to prevent path traversal.
 */
export async function resolveImageArg(val: unknown): Promise<unknown> {
  if (typeof val !== "object" || val === null) return val;
  if (Array.isArray(val)) return Promise.all(val.map(resolveImageArg));

  const obj = val as Record<string, unknown>;

  if (typeof obj.file_path === "string" && !obj.base64) {
    const filePath = resolve(obj.file_path);
    const allowed = ALLOWED_ROOTS.some(
      (root) => filePath === root || filePath.startsWith(root + "/") || filePath.startsWith(root + "\\"),
    );
    if (!allowed) {
      throw new Error(
        `file_path "${obj.file_path}" is outside allowed directories (OUTPUT_DIR or workspace root)`,
      );
    }
    const data = await readFile(filePath);
    return { type: "base64", base64: data.toString("base64"), format: obj.format ?? "png" };
  }

  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    out[k] = await resolveImageArg(v);
  }
  return out;
}

/** Validate a path-segment ID (character/object id) to prevent injection/traversal. */
function validateId(val: unknown, label: string): string {
  const id = String(val);
  if (!/^[a-zA-Z0-9_-]{1,200}$/.test(id)) {
    throw new Error(`Invalid ${label}: must contain only letters, numbers, hyphens, or underscores`);
  }
  return id;
}

/**
 * Fetch a binary endpoint (ZIP etc.) and save it into OUTPUT_DIR under a safe filename
 * derived from the Content-Disposition header, falling back to `fallbackName`.
 */
async function downloadToOutputDir(client: PixelLabClient, path: string, fallbackName: string) {
  const { data, filename } = await client.getBinary(path);
  const buf = Buffer.from(data, "base64");
  ensureOutputDir();
  let baseName = fallbackName;
  if (filename) {
    const stripped = basename(filename).replace(/[^a-zA-Z0-9._-]/g, "_");
    if (stripped && stripped !== "." && stripped !== "..") baseName = stripped;
  }
  const outRoot = resolve(OUTPUT_DIR);
  const filePath = resolve(join(OUTPUT_DIR, baseName));
  if (filePath !== outRoot && !filePath.startsWith(outRoot + "/") && !filePath.startsWith(outRoot + "\\")) {
    throw new Error("Resolved output path escapes OUTPUT_DIR");
  }
  writeFileSync(filePath, buf);
  return { success: true, file_path: filePath, size_bytes: buf.length };
}

/** Build a `?limit=&offset=` suffix from list-tool args (empty string when neither is set). */
function paginationQuery(args: Record<string, unknown>): string {
  const params = new URLSearchParams();
  if (args.limit) params.set("limit", String(args.limit));
  if (args.offset) params.set("offset", String(args.offset));
  const qs = params.toString();
  return qs ? `?${qs}` : "";
}

/** Build the optional animation-scoping query for the delete-animations endpoints. */
function animationDeleteQuery(args: Record<string, unknown>): string {
  const params = new URLSearchParams();
  for (const key of ["animation_type", "animation_group_id", "direction"]) {
    if (args[key]) params.set(key, String(args[key]));
  }
  const qs = params.toString();
  return qs ? `?${qs}` : "";
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
const enhancePrompt = { type: "boolean", description: "Auto-expand the description into a richer prompt before generating (default false)", default: false };
const pixenOutline = { type: "string", enum: ["single color black outline", "single color outline", "selective outline", "lineless"], description: "Outline style" };
const detailEnum = { type: "string", enum: ["low detail", "medium detail", "highly detailed"], description: "Detail level (default 'highly detailed')" };

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

const proFlashStyleImage = {
  type: "object",
  description: "Optional style reference ('left-box' image) whose visual traits are copied into the result. Must fit the operation's native canvas",
  properties: {
    image: imageSchema("Style reference image"),
    size: sizeSchema("Dimensions of the style image"),
    usage_description: { type: "string", description: "Optional note on how the style image should be used" },
  },
  required: ["image", "size"],
};

const proFlashStyleOptions = {
  type: "object",
  description: "Which visual traits to copy from style_image (all default true)",
  properties: {
    color_palette: { type: "boolean", default: true },
    outline: { type: "boolean", default: true },
    detail: { type: "boolean", default: true },
    shading: { type: "boolean", default: true },
  },
};

const proFlashSeed = { type: "integer", minimum: 0, description: "Recorded seed (default 0); the Pro Flash provider does not promise deterministic output" };
const projectId = { type: "string", description: "Optional project ID to file the result under" };
const proFlashSizeNote =
  "Native sizes: 16x16 (experimental), 24x24, 32x32, 32x48, 64x64, 96x64, 96x96. Custom (Beta): 16-256 per side, both multiples of 4. Defaults to 64x64";

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
  {
    name: "create_image_pixen",
    description:
      "Generate pixel art using the Pixen engine. Width/height 16-768px each but max area 512x512, and both must be divisible by 4. Supports outline/detail style hints, view/direction, and optional prompt enhancement. A modern alternative to generate_image with finer outline/detail control.",
    inputSchema: {
      type: "object",
      properties: {
        description: { type: "string", description: "Text description of the image to generate" },
        image_size: sizeSchema("Width/height each 16-768, max area 512x512, both divisible by 4"),
        outline: pixenOutline,
        detail: detailEnum,
        view: viewEnum,
        direction: directionEnum,
        no_background: { type: "boolean", description: "Generate with transparent background (default false)", default: false },
        background_removal_task: {
          type: "string",
          enum: ["remove_simple_background", "remove_complex_background"],
          description: "Background removal complexity (default remove_simple_background)",
        },
        seed,
        enhance_prompt: enhancePrompt,
      },
      required: ["description", "image_size"],
    },
    handler: async (client, args) => client.post("/create-image-pixen", args),
  },
  {
    name: "create_image_pixflux_background",
    description:
      "Generate a seamless/background image using the Pixflux engine. Same parameters as create_image_pixflux but tuned for backgrounds and environments rather than isolated sprites.",
    inputSchema: {
      type: "object",
      properties: {
        description: { type: "string", description: "Background/scene description" },
        image_size: sizeSchema("32x32 to 400x400"),
        negative_description: negativeDescription,
        text_guidance_scale: { type: "number", description: "How closely to follow text (1.0-20.0, default 8.0)" },
        ...styleParams,
        view: viewEnum,
        direction: directionEnum,
        isometric,
        no_background: { type: "boolean", description: "Generate with transparent background (default false)", default: false },
        coverage_percentage: coveragePercentage,
        init_image: imageSchema("Starting image for img2img"),
        init_image_strength: initImageStrength,
        color_image: colorImage,
        seed,
      },
      required: ["description", "image_size"],
    },
    handler: async (client, args) => client.post("/create-image-pixflux-background", args),
  },

  // ═══════ PRO FLASH ═══════
  {
    name: "create_image_pro_flash",
    description:
      "Generate one native pixel-art image with the Pro Flash engine, optionally guided by a style image. Runs as a background job; the completed result carries the PNG, an image_url and a durable source_image_id — keep that ID to later build a Pro Flash character or object from the same image without paying for it again (create_character_pro_flash / create_object_pro_flash). About 5 generation units; call get_pro_flash_cost for current pricing and get_pro_flash_capabilities for the exact native sizes.",
    inputSchema: {
      type: "object",
      properties: {
        description: { type: "string", description: "What to generate (max 2000 chars)" },
        image_size: sizeSchema(`Output size. ${proFlashSizeNote}`),
        no_background: noBackground,
        style_image: proFlashStyleImage,
        style_options: proFlashStyleOptions,
        seed: proFlashSeed,
        project_id: projectId,
      },
      required: ["description", "image_size"],
    },
    handler: async (client, args) => client.post("/create-image-pro-flash", args),
  },
  {
    name: "edit_image_pro_flash",
    description:
      "Edit one image at a supported native size with the Pro Flash engine, using either a text instruction (method 'text') or a reference image (method 'reference'). The source canvas never grows or resizes, and reference art must fit inside it. Runs as a background job. Call get_pro_flash_capabilities for the exact native shapes.",
    inputSchema: {
      type: "object",
      properties: {
        image: imageSchema("Source image at a supported native size"),
        method: { type: "string", enum: ["text", "reference"], description: "Edit driver (default 'text')", default: "text" },
        description: { type: "string", description: "Edit instruction (used with method 'text')" },
        reference_image: imageSchema("Reference art to apply (used with method 'reference'); must fit the source canvas"),
        no_background: { type: "boolean", description: "Return on a transparent background (default false)", default: false },
        use_color_palette_correction: { type: "boolean", description: "Snap the result back to the source image's palette (default false)", default: false },
        seed: proFlashSeed,
        project_id: projectId,
      },
      required: ["image"],
    },
    handler: async (client, args) => client.post("/edit-image-pro-flash", args),
  },
  {
    name: "inpaint_image_pro_flash",
    description:
      "Pro Flash inpainting: replace only the WHITE pixels of mask_image, preserving unmasked RGBA exactly. Source and mask must share identical supported native dimensions; mask RGB must be pure black/white (alpha is ignored) and may not be empty. output_method controls whether you get the full composite or only the changed pixels (transparent elsewhere). An optional context_image requires its bounding_box in the source. Runs as a background job.",
    inputSchema: {
      type: "object",
      properties: {
        image: imageSchema("Source image at a supported native size"),
        mask_image: imageSchema("Black/white mask, same size as image; white = repaint"),
        description: { type: "string", description: "What to paint into the masked region (max 2000 chars)" },
        context_image: imageSchema("Optional native-size context image; requires bounding_box"),
        bounding_box: {
          type: "object",
          description: "Where context_image sits in the source (required when context_image is given)",
          properties: {
            x: { type: "integer", minimum: 0 },
            y: { type: "integer", minimum: 0 },
            width: { type: "integer", minimum: 1 },
            height: { type: "integer", minimum: 1 },
          },
          required: ["x", "y", "width", "height"],
        },
        no_background: { type: "boolean", description: "Return on a transparent background (default false)", default: false },
        background_removal_task: {
          type: "string",
          enum: ["remove_simple_background", "remove_complex_background"],
          description: "Background removal complexity when no_background is set (default remove_simple_background)",
        },
        output_method: {
          type: "string",
          enum: ["New layer with changes", "Modify current layer, only changes", "Modify current layer"],
          description: "'Modify current layer' returns the full composite (default); the other two return only the changed pixels, transparent outside the mask",
        },
        crop_to_mask: { type: "boolean", description: "Crop the working region to the mask bounds (default true)", default: true },
        seed: proFlashSeed,
        project_id: projectId,
      },
      required: ["image", "mask_image", "description"],
    },
    handler: async (client, args) => client.post("/inpaint-image-pro-flash", args),
  },
  {
    name: "create_character_pro_flash",
    description:
      "Create a saved character with the Pro Flash engine in one call: generates a south-facing image from the description, then produces eight v3 rotation views. To skip the (paid) first image, pass source_image_id from an earlier create_image_pro_flash result, or upload first_frame directly — you then pay only for rotations. Pixels are preserved and padded with transparency to the square v3 canvas. Returns a job plus character_id; poll get_job_status for itemized billing_stages, then get_character.",
    inputSchema: {
      type: "object",
      properties: {
        description: { type: "string", description: "Character description (max 2000 chars). Still required when reusing an image" },
        name: { type: "string", description: "Display name (max 200 chars)" },
        image_size: sizeSchema(`Size for text creation. ${proFlashSizeNote}`, false),
        source_image_id: { type: "string", description: "Owned south-facing image ID from a Pro Flash image job — reuses its pixels without another image charge. Mutually exclusive with first_frame" },
        first_frame: imageSchema("South-facing PNG to rotate instead of generating one. Mutually exclusive with source_image_id"),
        first_frame_direction: { ...directionEnum, description: "Direction the supplied/generated first frame faces (default 'south')" },
        view: { type: "string", enum: ["low top-down", "high top-down", "side"], description: "Camera view (default 'low top-down')" },
        template_id: { type: "string", enum: ["mannequin", "bear", "cat", "dog", "horse", "lion", "custom"], description: "Skeleton body template (default 'mannequin')" },
        n_directions: { type: "integer", description: "Number of rotation views to generate (default 8)", default: 8 },
        style_image: proFlashStyleImage,
        style_options: proFlashStyleOptions,
        seed: proFlashSeed,
      },
      required: ["description"],
    },
    handler: async (client, args) => client.post("/create-character-pro-flash", args),
  },
  {
    name: "create_object_pro_flash",
    description:
      "Create a saved object with the Pro Flash engine in one call: generates a south-facing image from the description and, with n_directions 8, adds v3 rotation views (n_directions 1 = single image). Pass source_image_id or first_frame to reuse an existing image: one-direction finalization is then free and eight views charge only rotations. Objects have no skeleton. Returns a job plus object_id; poll get_job_status for billing_stages, then get_object.",
    inputSchema: {
      type: "object",
      properties: {
        description: { type: "string", description: "Object description (max 2000 chars)" },
        name: { type: "string", description: "Display name (max 200 chars)" },
        image_size: sizeSchema(`Size for text creation. ${proFlashSizeNote}`, false),
        source_image_id: { type: "string", description: "Owned south-facing image ID from a Pro Flash image job — reuses its pixels free of the image charge. Mutually exclusive with first_frame" },
        first_frame: imageSchema("South-facing PNG to use instead of generating one. Mutually exclusive with source_image_id"),
        first_frame_direction: { ...directionEnum, description: "Direction the supplied/generated first frame faces (default 'south')" },
        view: { type: "string", enum: ["low top-down", "high top-down", "side"], description: "Camera view (default 'low top-down')" },
        n_directions: { type: "integer", enum: [1, 8], description: "1 = single image, 8 = full rotation set (default 8)", default: 8 },
        style_image: proFlashStyleImage,
        style_options: proFlashStyleOptions,
        seed: proFlashSeed,
      },
      required: ["description"],
    },
    handler: async (client, args) => client.post("/create-object-pro-flash", args),
  },
  {
    name: "get_pro_flash_capabilities",
    description:
      "List the Pro Flash engine's native size presets, beta custom-dimension rules, and supported controls. Free. Check this before calling create/edit/inpaint_image_pro_flash with a non-standard size.",
    inputSchema: { type: "object", properties: {} },
    handler: async (client) => client.get("/pro-flash/capabilities"),
  },
  {
    name: "get_pro_flash_cost",
    description:
      "Estimate the provisional cost of a Pro Flash operation in generation units, split into the first-image component and the v3 rotation component. Free. Actual billed usage is reported when the job completes.",
    inputSchema: {
      type: "object",
      properties: {
        operation: { type: "string", enum: ["create", "edit", "inpaint", "character", "object"], description: "Which Pro Flash operation to price" },
        width: { type: "integer", minimum: 1, description: "Canvas width in pixels" },
        height: { type: "integer", minimum: 1, description: "Canvas height in pixels" },
        n_directions: { type: "integer", description: "Rotation views for character/object (default 8)" },
      },
      required: ["operation", "width", "height"],
    },
    handler: async (client, args) => {
      const params = new URLSearchParams({
        operation: String(args.operation),
        width: String(args.width),
        height: String(args.height),
      });
      if (args.n_directions !== undefined) params.set("n_directions", String(args.n_directions));
      return client.get(`/pro-flash/cost?${params.toString()}`);
    },
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
    name: "image_to_pixelart_pro",
    description:
      "Convert a photograph or regular image into pixel art using the Pro engine. The model derives output size from the input — you only supply the source image and optional style instructions. Higher quality than image_to_pixelart but less manual size control.",
    inputSchema: {
      type: "object",
      properties: {
        image: imageSchema("Source image to convert"),
        description: { type: "string", description: "Optional extra style instructions" },
        seed,
      },
      required: ["image"],
    },
    handler: async (client, args) => client.post("/image-to-pixelart-pro", args),
  },
  {
    name: "unzoom",
    description:
      "Recover native-resolution pixel art from an upscaled image (e.g. a 32x32 sprite saved at 512x512). Detects the underlying pixel grid and downsamples back onto it, handling slightly uneven grids from lossy resizes. Input min 256x256, max area 2048x2048. The result is OPAQUE (transparency is composited onto white) — run remove_background afterwards if you need it cut out again. Use before passing user-supplied art as a style/reference image, or before correct_pixelart.",
    inputSchema: {
      type: "object",
      properties: {
        image: imageSchema("Upscaled pixel art image (min 256x256, max area 2048x2048)"),
        quantize: { type: "integer", minimum: -1, maximum: 256, description: "Palette handling: 0 auto-detects a palette (default), -1 keeps every color the downsample produces, 2-256 quantizes to exactly that many colors" },
      },
      required: ["image"],
    },
    handler: async (client, args) => client.post("/unzoom", args),
  },
  {
    name: "correct_pixelart",
    description:
      "Clean up existing pixel art WITHOUT changing its size: sharpens edges, removes stray/anti-aliased pixels, and tightens the palette while keeping the sprite on its pixel grid. Good for art that went through a lossy pipeline, hand-drawn art, or nearly-on-grid output from other tools. Pass several same-size frames together (an animation, or a character's directions) so they stay consistent. Max area 1024x1024; transparency is preserved. If the image is upscaled, run unzoom first.",
    inputSchema: {
      type: "object",
      properties: {
        images: { type: "array", items: imageSchema("Pixel art frame"), description: "Image(s) to clean up. All must be the same size" },
        strength: { type: "number", minimum: 0, maximum: 1, description: "How far the model may move from your art (0.0-1.0, default 0.1). Start low; raise only if the art needs real repair", default: 0.1 },
      },
      required: ["images"],
    },
    handler: async (client, args) => client.post("/correct-pixelart", args),
  },
  {
    name: "reduce_colors",
    description:
      "Quantize one or more images onto a smaller SHARED palette, optionally with ordered dithering. Pass an animation's frames or a character's eight directions in one call so they come back sharing one palette instead of drifting apart. Choose the palette by omitting both options (auto-detect size), num_colors (exact count), or palette_image (reuse an existing image's colors, max 256). Total pixel budget across all frames is 512x512 (e.g. sixteen 64x64 frames).",
    inputSchema: {
      type: "object",
      properties: {
        images: { type: "array", items: imageSchema("Frame to quantize"), description: "Image(s) to quantize together. All must be the same size" },
        num_colors: { type: "integer", description: "Target number of colors. Omit to auto-detect. Mutually exclusive with palette_image" },
        palette_image: imageSchema("Image whose colors become the palette (max 256 colors). Mutually exclusive with num_colors"),
        dithering: { type: "string", enum: ["none", "2x2", "4x4", "8x8"], description: "Ordered dithering matrix size (default 'none'). Larger = smoother gradients, busier look" },
        dithering_strength: { type: "number", minimum: 0, maximum: 10, description: "How strongly to dither (0-10, default 5). Ignored when dithering is 'none'" },
      },
      required: ["images"],
    },
    handler: async (client, args) => client.post("/reduce-colors", args),
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
    name: "animate_pixminimax",
    description:
      "Beta (tier 1+ subscription): animate a single frame from a text description of the MOTION using the PixMiniMax engine (MiniMax H3). Best for fluid, longer clips — 4 to 40 frames (multiples of 4) at up to 256x256. Result holds frame_count + 1 images: index 0 is your unchanged input frame. Optional last_frame makes it a keyframe interpolation. Priced by clip length and size (about 1-12 generations); sizes just above 64 or 128px are cheaper than just below. Typically takes 1-5 minutes. Use animate_with_text_v3 for the standard engine.",
    inputSchema: {
      type: "object",
      properties: {
        first_frame: imageSchema("Starting frame (max 256x256)"),
        last_frame: imageSchema("Optional end pose, same size as first_frame — the motion is generated between the two"),
        description: { type: "string", description: "The motion to generate (e.g. 'walking forward', 'sword slash', 'flame flickering'). Describe movement, not appearance. Max 1000 chars" },
        frame_count: { type: "integer", description: "Frames to generate — a multiple of 4 from 4 to 40 (default 8)", default: 8 },
        seed: { type: "integer", description: "Seed for reproducible generation (0 = random, default 0)" },
        no_background: { type: "boolean", description: "Return frames on transparency; an opaque input is cut out of its first frame before animating (default true)", default: true },
        drift_threshold: { type: "number", description: "Color de-flicker sensitivity. Frames whose foreground drifts from the first frame beyond this are corrected toward it; 0 corrects every frame, higher corrects fewer. Omit for the default" },
        enhance_prompt: { type: "boolean", description: "Expand description into a detailed PixMiniMax motion prompt before generating (+0.05 generations; expanded text returned as enhanced_prompt). Default false", default: false },
        direction: { ...directionEnum, description: "Facing direction of the sprite (south = towards camera). Only used with enhance_prompt to hold the facing and aim attacks that way. Omit to let the enhancer read it from the image" },
      },
      required: ["first_frame", "description"],
    },
    handler: async (client, args) => client.post("/animate-pixminimax", args),
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
    name: "generate_8_rotations_v3",
    description:
      "Generate 8 directional rotations from a single source frame using the v3 model. Simpler than generate_8_rotations — just provide one image and the model produces all 8 views. Does NOT create a persistent character; use create_character_8dir for that.",
    inputSchema: {
      type: "object",
      properties: {
        first_frame: imageSchema("Source frame to rotate into 8 directions"),
        no_background: { type: "boolean", description: "Remove background from generated frames" },
        seed: { type: "number", description: "Seed for reproducible generation (0 for random, default 0)" },
      },
      required: ["first_frame"],
    },
    handler: async (client, args) => client.post("/generate-8-rotations-v3", args),
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
  {
    name: "edit_image_pixen",
    description:
      "Edit an existing pixel art image with a text instruction on the Pixen model — pose, composition and pixel style are preserved and only what you ask for changes. Source max 256px per side (crop, don't rescale). Target canvas defaults to the source size; area 16x16 to 256x256 (a wide-but-short 128x512 is fine). The model re-renders at the target size rather than rescaling. Costs 1 generation. Prefer this over edit_image for Pixen-generated art.",
    inputSchema: {
      type: "object",
      properties: {
        image: imageSchema("Source pixel art (max 256px per side)"),
        description: { type: "string", description: "What to change (e.g. 'give him a red cape', 'make the armor gold'). Max 500 chars" },
        width: { type: "integer", description: "Target canvas width (defaults to source width). Area must be at most 256x256" },
        height: { type: "integer", description: "Target canvas height (defaults to source height)" },
        seed: { type: "integer", description: "Seed for reproducible generation" },
        no_background: noBackground,
      },
      required: ["image", "description"],
    },
    handler: async (client, args) => client.post("/edit-image-pixen", args),
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
    name: "list_tilesets",
    description: "List your previously created tilesets with pagination.",
    inputSchema: {
      type: "object",
      properties: {
        limit: { type: "number", description: "Results per page (1-100, default 50)" },
        offset: { type: "number", description: "Pagination offset (default 0)" },
      },
    },
    handler: async (client, args) => {
      const params = new URLSearchParams();
      if (args.limit) params.set("limit", String(args.limit));
      if (args.offset) params.set("offset", String(args.offset));
      const qs = params.toString();
      return client.get(`/tilesets${qs ? `?${qs}` : ""}`);
    },
  },
  {
    name: "delete_tileset",
    description: "Delete a top-down tileset by ID. For sidescroller tilesets use delete_tileset_sidescroller.",
    inputSchema: {
      type: "object",
      properties: {
        tileset_id: { type: "string", description: "Tileset ID" },
      },
      required: ["tileset_id"],
    },
    handler: async (client, args) => {
      const id = validateId(args.tileset_id, "tileset_id");
      return client.delete(`/tilesets/${encodeURIComponent(id)}`);
    },
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
    name: "get_tileset_sidescroller",
    description: "Get a previously created sidescroller tileset by ID. For top-down tilesets use get_tileset.",
    inputSchema: {
      type: "object",
      properties: {
        tileset_id: { type: "string", description: "Sidescroller tileset ID" },
      },
      required: ["tileset_id"],
    },
    handler: async (client, args) => {
      const id = validateId(args.tileset_id, "tileset_id");
      return client.get(`/tilesets-sidescroller/${encodeURIComponent(id)}`);
    },
  },
  {
    name: "list_tilesets_sidescroller",
    description: "List your sidescroller tilesets with pagination. For top-down tilesets use list_tilesets.",
    inputSchema: {
      type: "object",
      properties: {
        limit: { type: "number", description: "Results per page (1-50, default 10)" },
        offset: { type: "number", description: "Pagination offset (default 0)" },
      },
    },
    handler: async (client, args) =>
      client.get(`/tilesets-sidescroller${paginationQuery(args)}`),
  },
  {
    name: "delete_tileset_sidescroller",
    description: "Delete a sidescroller tileset by ID. For top-down tilesets use delete_tileset.",
    inputSchema: {
      type: "object",
      properties: {
        tileset_id: { type: "string", description: "Sidescroller tileset ID" },
      },
      required: ["tileset_id"],
    },
    handler: async (client, args) => {
      const id = validateId(args.tileset_id, "tileset_id");
      return client.delete(`/tilesets-sidescroller/${encodeURIComponent(id)}`);
    },
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
    name: "list_isometric_tiles",
    description: "List your previously created isometric tiles with pagination.",
    inputSchema: {
      type: "object",
      properties: {
        limit: { type: "number", description: "Results per page (1-100, default 50)" },
        offset: { type: "number", description: "Pagination offset (default 0)" },
      },
    },
    handler: async (client, args) => {
      const params = new URLSearchParams();
      if (args.limit) params.set("limit", String(args.limit));
      if (args.offset) params.set("offset", String(args.offset));
      const qs = params.toString();
      return client.get(`/isometric-tiles${qs ? `?${qs}` : ""}`);
    },
  },
  {
    name: "delete_isometric_tile",
    description: "Delete an isometric tile by ID.",
    inputSchema: {
      type: "object",
      properties: {
        tile_id: { type: "string", description: "Isometric tile ID" },
      },
      required: ["tile_id"],
    },
    handler: async (client, args) => {
      const id = validateId(args.tile_id, "tile_id");
      return client.delete(`/isometric-tiles/${encodeURIComponent(id)}`);
    },
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
  {
    name: "list_tiles_pro",
    description: "List your previously created pro tiles with pagination.",
    inputSchema: {
      type: "object",
      properties: {
        limit: { type: "number", description: "Results per page (1-50, default 10)" },
        offset: { type: "number", description: "Pagination offset (default 0)" },
      },
    },
    handler: async (client, args) => client.get(`/tiles-pro${paginationQuery(args)}`),
  },
  {
    name: "delete_tiles_pro",
    description: "Delete a pro tile by ID.",
    inputSchema: {
      type: "object",
      properties: {
        tile_id: { type: "string", description: "Tiles pro ID" },
      },
      required: ["tile_id"],
    },
    handler: async (client, args) => {
      const id = validateId(args.tile_id, "tile_id");
      return client.delete(`/tiles-pro/${encodeURIComponent(id)}`);
    },
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
  {
    name: "get_map_object",
    description: "Get a map object's status and metadata by ID (from create_map_object).",
    inputSchema: {
      type: "object",
      properties: {
        object_id: { type: "string", description: "Map object ID" },
      },
      required: ["object_id"],
    },
    handler: async (client, args) => {
      const id = validateId(args.object_id, "object_id");
      return client.get(`/map-objects/${encodeURIComponent(id)}`);
    },
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
    name: "create_character_v3",
    description:
      "Create a character using the v3 model. Two modes: provide a south-facing reference_image to rotate that exact character, or omit it to generate from scratch via description. Output 32-256px (advisory in reference mode). Returns a character_id. The newest character generator — prefer over create_character_4dir/8dir for best quality.",
    inputSchema: {
      type: "object",
      properties: {
        description: { type: "string", description: "Character description (used as prompt + display name)" },
        reference_image: imageSchema("South-facing reference image; if provided, v3 rotates this exact character"),
        image_size: sizeSchema("Output frame size, 32-256px (advisory in reference mode)", false),
        view: { type: "string", enum: ["low top-down", "high top-down", "side"], description: "Camera view angle (default 'low top-down')" },
        template_id: { type: "string", description: "Body type for skeleton reconstruction (default 'mannequin')" },
        name: { type: "string", description: "Display name (defaults to first 50 chars of description)" },
        outline: { type: "string", description: "Outline style hint for from-scratch mode (default 'single color black outline')" },
        detail: { type: "string", description: "Detail level hint for from-scratch mode (default 'medium detail')" },
        no_background: noBackground,
        enhance_prompt: enhancePrompt,
        seed,
      },
      required: ["description"],
    },
    handler: async (client, args) => client.post("/create-character-v3", args),
  },
  {
    name: "create_character_pro",
    description:
      "Create a character or object using the Pro engine. Output 32-168px. Methods: create_with_style (text-driven, optional style reference_image), create_from_concept (from a concept_image up to 1024x1024), rotate_character. Returns a character_id.",
    inputSchema: {
      type: "object",
      properties: {
        description: { type: "string", description: "Description of the character or object to generate" },
        image_size: sizeSchema("Output frame size (32-168px)"),
        method: {
          type: "string",
          enum: ["create_with_style", "create_from_concept", "rotate_character"],
          description: "How reference inputs are used (default 'create_with_style')",
        },
        view: { type: "string", enum: ["low top-down", "high top-down", "side"], description: "Camera view angle (default 'low top-down')" },
        template_id: { type: "string", description: "Body type for skeleton reconstruction (default 'mannequin')" },
        concept_image: imageSchema("Concept image (max 1024x1024) for method=create_from_concept"),
        reference_image: imageSchema("Style reference image (max 168x168) for method=create_with_style"),
        style_description: { type: "string", description: "Free-text style hint layered on top of the description (max 2000 chars)" },
        no_background: noBackground,
        seed,
      },
      required: ["description", "image_size"],
    },
    handler: async (client, args) => client.post("/create-character-pro", args),
  },
  {
    name: "create_character_state",
    description:
      "Create a new state/variant of an existing character by editing it with a text description (e.g. 'wearing armor', 'damaged'). Requires a source character_id. Optionally snap the edit to the source character's color palette for visual consistency.",
    inputSchema: {
      type: "object",
      properties: {
        character_id: { type: "string", description: "ID of the source character" },
        edit_description: { type: "string", description: "How to edit the character to create the new state" },
        use_color_palette_from_reference: { type: "boolean", description: "Snap edited rotations to the source character's existing color palette (default false)" },
        no_background: noBackground,
        seed,
      },
      required: ["character_id", "edit_description"],
    },
    handler: async (client, args) => client.post("/create-character-state", args),
  },
  {
    name: "create_character_animation",
    description:
      "Animate a SAVED character by ID with flexible modes. mode='template' uses a skeleton-based template_animation_id; mode='v3' interpolates frames from a custom action_description (4-16 frames); mode='pro' is the pro animator. More flexible than animate_character, which is template-only. Requires a character_id.",
    inputSchema: {
      type: "object",
      properties: {
        character_id: { type: "string", description: "ID of existing character to animate" },
        mode: { type: "string", enum: ["template", "v3", "pro"], description: "Animation mode: 'template' (skeleton from template_animation_id), 'v3' (custom action), 'pro'" },
        template_animation_id: { type: "string", description: "Animation template ID (required for template mode, e.g. 'walking', 'attack')" },
        action_description: { type: "string", description: "Action description (required for custom v3/pro animations, e.g. 'walking', 'jumping')" },
        animation_name: { type: "string", description: "Name for this animation (defaults to action_description)" },
        description: { type: "string", description: "Character description (uses character's original if omitted)" },
        frame_count: { type: "integer", description: "Number of frames (4-16, must be even, default 8). v3 mode only", minimum: 4, maximum: 16 },
        text_guidance_scale: textGuidanceScale,
        directions: { type: "array", items: { type: "string" }, description: "Directions to animate (south, north, east, west, etc.), or omit for default" },
        ...styleParams,
        isometric: { type: "boolean", description: "Generate in isometric view (default false)" },
        color_image: colorImage,
        force_colors: forceColors,
        enhance_prompt: enhancePrompt,
        seed,
      },
      required: ["character_id"],
    },
    handler: async (client, args) => client.post("/characters/animations", args),
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
    handler: async (client, args) => {
      const id = validateId(args.character_id, "character_id");
      return client.get(`/characters/${encodeURIComponent(id)}`);
    },
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
    handler: async (client, args) => {
      const id = validateId(args.character_id, "character_id");
      return client.delete(`/characters/${encodeURIComponent(id)}`);
    },
  },
  {
    name: "download_character_zip",
    description: "Download a character as a ZIP file with all sprites and metadata. Saves it to the pixellab-forge-output directory and returns the file path.",
    inputSchema: {
      type: "object",
      properties: {
        character_id: { type: "string", description: "Character ID" },
      },
      required: ["character_id"],
    },
    handler: async (client, args) => {
      const id = validateId(args.character_id, "character_id");
      return downloadToOutputDir(client, `/characters/${encodeURIComponent(id)}/zip`, `character_${id}_${Date.now()}.zip`);
    },
  },
  {
    name: "download_character_spritesheet",
    description:
      "Export a character as a single spritesheet: a small ZIP holding one uniform-grid PNG (row 0 = rotations, then one row per animation-direction, columns = frames) plus a layout JSON describing cell size and which animation/direction each row holds. Frames are centred in equal cells and never rescaled. Saves to pixellab-forge-output and returns the file path. Use download_character_zip instead for individual frame PNGs. Returns an error while the character is still generating (HTTP 423).",
    inputSchema: {
      type: "object",
      properties: {
        character_id: { type: "string", description: "Character ID" },
      },
      required: ["character_id"],
    },
    handler: async (client, args) => {
      const id = validateId(args.character_id, "character_id");
      return downloadToOutputDir(client, `/characters/${encodeURIComponent(id)}/spritesheet`, `character_${id}_spritesheet_${Date.now()}.zip`);
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
    handler: async (client, args) => {
      const id = validateId(args.character_id, "character_id");
      return client.patch(`/characters/${encodeURIComponent(id)}/tags`, { tags: args.tags });
    },
  },
  {
    name: "set_character_portrait",
    description:
      "Attach a bust portrait to a saved character (free — no generation runs). The portrait is the starting frame for talking animations: vocal_animation generates mouth positions from it. Overwrites any existing portrait. To generate a portrait from a full-body sprite first, use portrait_character_pro with direction='character_to_portrait'.",
    inputSchema: {
      type: "object",
      properties: {
        character_id: { type: "string", description: "Character ID" },
        image: imageSchema("Bust portrait image to attach"),
      },
      required: ["character_id", "image"],
    },
    handler: async (client, args) => {
      const id = validateId(args.character_id, "character_id");
      return client.post(`/characters/${encodeURIComponent(id)}/portrait`, { image: args.image });
    },
  },
  {
    name: "delete_character_animations",
    description:
      "Delete animations from a character. Omit all optional filters to delete every animation; pass animation_type and/or animation_group_id (both shown by get_character) to narrow it, and direction to remove a single direction only.",
    inputSchema: {
      type: "object",
      properties: {
        character_id: { type: "string", description: "Character ID" },
        animation_type: { type: "string", description: "Animation type shown by get_character (e.g. 'walk', 'idle')" },
        animation_group_id: { type: "string", description: "Animation group UUID shown by get_character as [group: ...]" },
        direction: { type: "string", description: "Single direction to delete (e.g. 'south'). Omit for all directions" },
      },
      required: ["character_id"],
    },
    handler: async (client, args) => {
      const id = validateId(args.character_id, "character_id");
      return client.delete(
        `/characters/${encodeURIComponent(id)}/animations${animationDeleteQuery(args)}`,
      );
    },
  },

  // ═══════ OBJECTS ═══════
  {
    name: "create_object_1dir",
    description:
      "Create a persistent single-direction object. Square size 32-256px (default 64). view 'top-down' or 'sidescroller'. Optionally pass style_images for visual reference. Larger sizes may yield multiple objects (use item_descriptions to label each). For an object rotatable to 8 directions use create_object_8dir. For single-view non-persistent props use create_map_object.",
    inputSchema: {
      type: "object",
      properties: {
        description: { type: "string", description: "Object description" },
        size: { type: "integer", description: "Square image size in pixels (32-256, default 64)", minimum: 32, maximum: 256 },
        view: { type: "string", enum: ["top-down", "sidescroller"], description: "View (default 'top-down')" },
        style_images: {
          type: "array",
          description: "Style reference images (PNG/JPEG base64, max 256x256 each)",
          items: imageSchema("Style reference image"),
        },
        item_descriptions: {
          type: "array",
          items: { type: "string" },
          description: "Per-object descriptions when the size produces multiple objects",
        },
      },
      required: ["description"],
    },
    handler: async (client, args) =>
      client.post("/create-1-direction-object", args),
  },
  {
    name: "create_object_8dir",
    description:
      "Create a persistent object with 8 directional views. Square size 32-256px (default 64). view 'low top-down', 'high top-down', or 'side'. Provide reference_image to rotate that exact object, OR style_image to generate a new object in that style (mutually exclusive). For a single-direction object use create_object_1dir.",
    inputSchema: {
      type: "object",
      properties: {
        description: { type: "string", description: "Object description" },
        size: { type: "integer", description: "Square image size in pixels (32-256, default 64)", minimum: 32, maximum: 256 },
        view: { type: "string", enum: ["low top-down", "high top-down", "side"], description: "Camera angle (default 'low top-down')" },
        reference_image: imageSchema("Reference image — generates 8 rotations of this exact object (mutually exclusive with style_image)"),
        style_image: imageSchema("Style reference — generates a new object matching the description in this style (mutually exclusive with reference_image)"),
      },
      required: ["description"],
    },
    handler: async (client, args) =>
      client.post("/create-8-direction-object", args),
  },
  {
    name: "animate_object",
    description:
      "Animate a SAVED object by ID. mode='v3' (default, higher quality, supports custom_start_frame/end_frame interpolation) or 'pro'. Do NOT pass directions for 1-direction objects; for 8-direction objects pass the directions to animate. Requires an object_id from create_object_1dir/8dir.",
    inputSchema: {
      type: "object",
      properties: {
        object_id: { type: "string", description: "ID of the object to animate" },
        mode: { type: "string", enum: ["pro", "v3"], description: "Animation mode (default 'v3')" },
        animation_description: { type: "string", description: "Describe the animation, e.g. 'walking cheerfully' (required for a new animation, max 1000 chars)" },
        directions: {
          type: "array",
          items: {
            type: "string",
            enum: ["south", "south-east", "east", "north-east", "north", "north-west", "west", "south-west"],
          },
          description: "Directions to animate (8-direction objects only; omit for 1-direction objects)",
        },
        animation_group_id: { type: "string", description: "For 8-direction objects: animation_group_id of an existing animation to add directions to" },
        display_name: { type: "string", description: "Optional name for the animation" },
        frame_count: { type: "integer", description: "Frames per direction" },
        replace_existing: { type: "boolean", description: "Regenerate a direction already animated in this animation (default false)" },
        custom_start_frame: imageSchema("Optional custom starting pose (v3 mode only)"),
        end_frame: imageSchema("Optional target pose to interpolate toward (v3 mode only)"),
        enhance_prompt: enhancePrompt,
      },
      required: ["object_id"],
    },
    handler: async (client, args) => {
      const { object_id, ...body } = args;
      const id = validateId(object_id, "object_id");
      return client.post(`/objects/${encodeURIComponent(id)}/animations`, body);
    },
  },
  {
    name: "create_object_state",
    description:
      "Create a new state/variant of an existing object by editing it with a text description (e.g. 'open chest', 'broken'). Requires a source object_id.",
    inputSchema: {
      type: "object",
      properties: {
        object_id: { type: "string", description: "ID of the source object" },
        edit_description: { type: "string", description: "How to edit the object to create the new state" },
        seed,
      },
      required: ["object_id", "edit_description"],
    },
    handler: async (client, args) => {
      const { object_id, ...body } = args;
      const id = validateId(object_id, "object_id");
      return client.post(`/objects/${encodeURIComponent(id)}/states`, body);
    },
  },
  {
    name: "select_object_frames",
    description:
      "From an object that generated multiple candidate frames, keep specific frames (by 0-based index) as completed individual objects. Optionally tag all newly-created objects.",
    inputSchema: {
      type: "object",
      properties: {
        object_id: { type: "string", description: "ID of the object whose frames to select" },
        indices: {
          type: "array",
          items: { type: "integer" },
          description: "Frame indices (0-based) to keep as completed individual objects",
        },
        common_tag: { type: "string", description: "Optional tag applied to every newly-created object" },
      },
      required: ["object_id", "indices"],
    },
    handler: async (client, args) => {
      const { object_id, ...body } = args;
      const id = validateId(object_id, "object_id");
      return client.post(`/objects/${encodeURIComponent(id)}/select-frames`, body);
    },
  },
  {
    name: "dismiss_object_review",
    description:
      "Dismiss the review state on an object, accepting it as-is without selecting specific frames. Takes no body beyond the object_id.",
    inputSchema: {
      type: "object",
      properties: {
        object_id: { type: "string", description: "ID of the object to dismiss review for" },
      },
      required: ["object_id"],
    },
    handler: async (client, args) => {
      const id = validateId(args.object_id, "object_id");
      return client.post(`/objects/${encodeURIComponent(id)}/dismiss-review`, {});
    },
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
    handler: async (client, args) => {
      const id = validateId(args.object_id, "object_id");
      return client.get(`/objects/${encodeURIComponent(id)}`);
    },
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
    handler: async (client, args) => {
      const id = validateId(args.object_id, "object_id");
      return client.delete(`/objects/${encodeURIComponent(id)}`);
    },
  },
  {
    name: "download_object_spritesheet",
    description:
      "Export an object as a single spritesheet: a small ZIP holding one uniform-grid PNG (row 0 = rotations, then one row per animation-direction, columns = frames) plus a layout JSON describing cell size and which animation/direction each row holds. Frames are centred in equal cells and never rescaled. Saves to pixellab-forge-output and returns the file path. Only works for objects you created; errors while rotations are still generating.",
    inputSchema: {
      type: "object",
      properties: {
        object_id: { type: "string", description: "Object ID" },
      },
      required: ["object_id"],
    },
    handler: async (client, args) => {
      const id = validateId(args.object_id, "object_id");
      return downloadToOutputDir(client, `/objects/${encodeURIComponent(id)}/spritesheet`, `object_${id}_spritesheet_${Date.now()}.zip`);
    },
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
    handler: async (client, args) => {
      const id = validateId(args.object_id, "object_id");
      return client.patch(`/objects/${encodeURIComponent(id)}/tags`, { tags: args.tags });
    },
  },
  {
    name: "delete_object_animations",
    description:
      "Delete animations from an object. Omit all optional filters to delete every animation; pass animation_type and/or animation_group_id (both shown by get_object) to narrow it, and direction to remove a single direction only.",
    inputSchema: {
      type: "object",
      properties: {
        object_id: { type: "string", description: "Object ID" },
        animation_type: { type: "string", description: "Animation type shown by get_object (e.g. 'walk', 'idle')" },
        animation_group_id: { type: "string", description: "Animation group UUID shown by get_object as [group: ...]" },
        direction: { type: "string", description: "Single direction to delete (e.g. 'south'). Omit for all directions" },
      },
      required: ["object_id"],
    },
    handler: async (client, args) => {
      const id = validateId(args.object_id, "object_id");
      return client.delete(
        `/objects/${encodeURIComponent(id)}/animations${animationDeleteQuery(args)}`,
      );
    },
  },

  // ═══════ UI ASSETS, FONTS & PORTRAITS (Pro) ═══════
  {
    name: "create_ui_asset",
    description:
      "Generate a shape-based pixel-art UI panel (Pro) from a text description — a persistent, saved UI asset (distinct from generate_ui, which is a one-shot generator). Returns a job_id and a ui_asset_id immediately; poll get_job_status or get_ui_asset until ready. Optionally scaffold the panel from named UI elements or a custom shape template.",
    inputSchema: {
      type: "object",
      properties: {
        description: { type: "string", description: "Style description for the UI panel (e.g. 'wooden RPG panel with gold trim')" },
        image_size: sizeSchema("Output size in pixels, 192–688 per axis (max per axis depends on aspect; default 256×256)", false),
        elements: {
          type: "array",
          items: {
            type: "string",
            enum: ["button", "icon_button", "toolbar", "tab", "panel", "window", "health_bar", "avatar", "triangle", "pentagon", "hexagon", "octagon"],
          },
          description: "Optional named UI element types to scaffold the panel from (auto-positioned, no coords needed). Combine with pieces for custom shapes; omit both for a default full-canvas panel.",
        },
        pieces: {
          type: "array",
          description:
            "Optional custom shape template. Each piece needs a unique id, a kind, and an optional label. Coords are on a virtual canvas where the longer side spans 0–512 and the shorter side scales to the output aspect ratio. kinds: rounded_rect {x,y,w,h,radius}, circle {x,y,r}, polygon {x,y,r,sides,phase}.",
          items: {
            type: "object",
            properties: {
              id: { type: "string", description: "Unique piece ID" },
              kind: { type: "string", enum: ["rounded_rect", "circle", "polygon"], description: "Shape kind" },
              label: { type: "string", description: "Optional label" },
              x: { type: "number" },
              y: { type: "number" },
              w: { type: "number", description: "Width (rounded_rect)" },
              h: { type: "number", description: "Height (rounded_rect)" },
              radius: { type: "number", description: "Corner radius (rounded_rect)" },
              r: { type: "number", description: "Radius (circle/polygon)" },
              sides: { type: "integer", description: "Number of sides (polygon)" },
              phase: { type: "number", description: "Rotation phase (polygon)" },
            },
            required: ["id", "kind"],
          },
        },
        style_image: imageSchema("Optional style reference image (PNG/JPEG)"),
        color_palette: { type: "string", description: "Optional palette specification (e.g. 'brown and gold')" },
        no_background: noBackground,
        seed,
        name: { type: "string", description: "Friendly name for the saved asset" },
        project_id: { type: "string", description: "If set, assign the finished asset to this project" },
      },
      required: ["description"],
    },
    handler: async (client, args) => client.post("/create-ui-asset", args),
  },
  {
    name: "list_ui_assets",
    description: "List your saved UI panels (newest first), with pagination. Includes ghost rows for panels still generating.",
    inputSchema: {
      type: "object",
      properties: {
        limit: { type: "number", description: "Results per page" },
        offset: { type: "number", description: "Pagination offset" },
      },
    },
    handler: async (client, args) => {
      const params = new URLSearchParams();
      if (args.limit) params.set("limit", String(args.limit));
      if (args.offset) params.set("offset", String(args.offset));
      const qs = params.toString();
      return client.get(`/ui-assets${qs ? `?${qs}` : ""}`);
    },
  },
  {
    name: "get_ui_asset",
    description: "Get a UI panel's details by ID. Reports progress while the panel is still generating.",
    inputSchema: {
      type: "object",
      properties: {
        ui_asset_id: { type: "string", description: "UI asset ID" },
      },
      required: ["ui_asset_id"],
    },
    handler: async (client, args) => {
      const id = validateId(args.ui_asset_id, "ui_asset_id");
      return client.get(`/ui-assets/${encodeURIComponent(id)}`);
    },
  },
  {
    name: "delete_ui_asset",
    description: "Permanently delete a UI panel and its backing image files.",
    inputSchema: {
      type: "object",
      properties: {
        ui_asset_id: { type: "string", description: "UI asset ID" },
      },
      required: ["ui_asset_id"],
    },
    handler: async (client, args) => {
      const id = validateId(args.ui_asset_id, "ui_asset_id");
      return client.delete(`/ui-assets/${encodeURIComponent(id)}`);
    },
  },
  {
    name: "generate_font_pro",
    description:
      "Generate a styled pixel-art font (Pro) from a text description. Produces a glyph atlas plus a ready-to-use TrueType (.ttf) font. Returns a job_id immediately — poll get_job_status for the result.",
    inputSchema: {
      type: "object",
      properties: {
        description: { type: "string", description: "Style description, e.g. 'warm orange arcade font'" },
        weight: { type: "string", enum: ["Bold", "Regular"], description: "Stroke weight; guides glyph thickness" },
        image_size: { type: "string", enum: ["1K", "2K"], description: "Generation resolution tier / pricing key (default '1K'). 1K costs fewer generations", default: "1K" },
        glyph_px: { type: "integer", enum: [8, 16, 32, 64], description: "Native glyph resolution in pixels — the real bitmap size per glyph in the output (default 16)", default: 16 },
        seed,
        font_name: { type: "string", description: "Explicit font family name; defaults to '{description} {weight}'" },
      },
      required: ["description", "weight"],
    },
    handler: async (client, args) => client.post("/generate-font-pro", args),
  },
  {
    name: "get_font_pro_job",
    description:
      "Get the status and result of a generate_font_pro job by its job_id. Use this rather than get_job_status for font-pro jobs — they are served from a dedicated endpoint.",
    inputSchema: {
      type: "object",
      properties: {
        job_id: { type: "string", description: "Job ID returned by generate_font_pro" },
      },
      required: ["job_id"],
    },
    handler: async (client, args) => {
      const id = validateId(args.job_id, "job_id");
      return client.get(`/generate-font-pro/${encodeURIComponent(id)}`);
    },
  },
  {
    name: "portrait_character_pro",
    description:
      "Convert between a bust portrait and a full-body character sprite (Pro). direction='portrait_to_character' takes a portrait in and returns a full-body sprite; 'character_to_portrait' does the reverse. Returns a job_id immediately — poll get_job_status for the result.",
    inputSchema: {
      type: "object",
      properties: {
        direction: {
          type: "string",
          enum: ["portrait_to_character", "character_to_portrait"],
          description: "Conversion direction (default 'portrait_to_character')",
          default: "portrait_to_character",
        },
        image: imageSchema("Input image (a portrait or a character, matching direction)"),
        view: { type: "string", enum: ["low top-down", "high top-down", "side"], description: "Camera angle of the character (default 'low top-down')" },
        result_size: { type: "integer", enum: [16, 32, 48, 64, 128, 160], description: "Output sprite size in pixels (default 64). 128/160 render at 2K for extra detail and cost more" },
        seed,
      },
      required: ["image"],
    },
    handler: async (client, args) => client.post("/portrait-character-pro", args),
  },
  {
    name: "get_portrait_character_pro_job",
    description:
      "Get the status and result of a portrait_character_pro job by its job_id. Use this rather than get_job_status for portrait↔character jobs — they are served from a dedicated endpoint.",
    inputSchema: {
      type: "object",
      properties: {
        job_id: { type: "string", description: "Job ID returned by portrait_character_pro" },
      },
      required: ["job_id"],
    },
    handler: async (client, args) => {
      const id = validateId(args.job_id, "job_id");
      return client.get(`/portrait-character-pro/${encodeURIComponent(id)}`);
    },
  },

  // ═══════ TALKING ANIMATION ═══════
  {
    name: "vocal_animation",
    description:
      "Generate the set of mouth positions ('visemes') that lets a portrait be lip-synced to any line of text. This is the only talking-animation step that costs generations — pay it once per expression, then talking_gif and lip_sync are free and unlimited. Provide either character_id (uses the character's stored portrait, set via set_character_portrait, and saves the result onto it) or an inline portrait image (max 256x256, result returned inline). Returns a job_id — poll get_vocal_animation_job.",
    inputSchema: {
      type: "object",
      properties: {
        character_id: { type: "string", description: "Generate from this character's stored portrait and save the result onto it. Required to later use character_id with talking_gif. Mutually exclusive with portrait" },
        portrait: imageSchema("Generate from this image instead and store nothing — mouth positions come back inline. Max 256x256. Mutually exclusive with character_id"),
        mood: { type: "string", enum: ["neutral", "happy", "angry", "sad", "surprised"], description: "Expression held on the face throughout (default 'neutral'). Call once per expression you want", default: "neutral" },
        viseme_count: { type: "integer", enum: [3, 5, 7, 12], description: "How many mouth positions to generate (default 7). 3 for tiny portraits, 12 for large close-ups. Must be the same for every expression on one character", default: 7 },
        no_background: { type: "boolean", description: "Return frames with a transparent background (default true)", default: true },
        seed,
      },
    },
    handler: async (client, args) => client.post("/vocal-animation", args),
  },
  {
    name: "get_vocal_animation_job",
    description:
      "Get the status and result of a vocal_animation job by its job_id. Mouth positions stream in as they are produced (completed_visemes fills up while the job runs). On completion, a character_id job has saved the set onto the character; a portrait job returns the frames in visemes.",
    inputSchema: {
      type: "object",
      properties: {
        job_id: { type: "string", description: "Job ID returned by vocal_animation" },
      },
      required: ["job_id"],
    },
    handler: async (client, args) => {
      const id = validateId(args.job_id, "job_id");
      return client.get(`/vocal-animation/${encodeURIComponent(id)}`);
    },
  },
  {
    name: "talking_gif",
    description:
      "Turn a line of text into an animated GIF of a character speaking it. Free — spends no generations; it only re-orders mouth positions already produced by vocal_animation. Provide either character_id (with mouth positions stored on the character) or supply visemes directly as returned by get_vocal_animation_job.",
    inputSchema: {
      type: "object",
      properties: {
        text: { type: "string", maxLength: 500, description: "The line of dialogue to lip-sync. Mouth shapes are derived from the letters, so any language using the latin alphabet works" },
        character_id: { type: "string", description: "Use the mouth positions stored on this character. Mutually exclusive with visemes" },
        visemes: {
          type: "object",
          description: "Supply the mouth positions directly, as returned by get_vocal_animation_job (map of viseme name to image). Mutually exclusive with character_id",
          additionalProperties: imageSchema("Mouth position image"),
        },
        mood: { type: "string", enum: ["neutral", "happy", "angry", "sad", "surprised"], description: "Which stored expression to talk with (defaults to the character's first). Only valid with character_id" },
        frame_ms: { type: "integer", minimum: 20, maximum: 500, description: "Milliseconds per mouth position (default 90)", default: 90 },
        hold_ms: { type: "integer", minimum: 0, maximum: 5000, description: "Pause held on the closed mouth at the end, so a looping GIF has a beat between takes (default 600)", default: 600 },
      },
      required: ["text"],
    },
    handler: async (client, args) => client.post("/talking-gif", args),
  },
  {
    name: "lip_sync",
    description:
      "Get the frame-by-frame lip-sync plan for a line of text — which mouth position to show, for how long, and how far through the text it lands. Free, and nothing is rendered: use this instead of talking_gif when animating in a game engine and driving the mouth yourself. Provide character_id (response also carries the spritesheet URL and row to read) or a bare viseme_count preset.",
    inputSchema: {
      type: "object",
      properties: {
        text: { type: "string", maxLength: 500, description: "The line of dialogue to lip-sync" },
        character_id: { type: "string", description: "Use the mouth positions stored on this character; the response then also carries the spritesheet URL and the row to read. Mutually exclusive with viseme_count" },
        mood: { type: "string", enum: ["neutral", "happy", "angry", "sad", "surprised"], description: "Which stored expression to use (defaults to the character's first). Only valid with character_id" },
        viseme_count: { type: "integer", enum: [3, 5, 7, 12], description: "Plan against a preset without touching a character — useful if you hold the frames yourself. Mutually exclusive with character_id" },
        frame_ms: { type: "integer", minimum: 1, maximum: 5000, description: "Milliseconds to hold each mouth position (default 90)", default: 90 },
        hold_ms: { type: "integer", minimum: 0, maximum: 10000, description: "Extra time on the final closed mouth (default 600)", default: 600 },
      },
      required: ["text"],
    },
    handler: async (client, args) => client.post("/lip-sync", args),
  },

  // ═══════ PROMPT ENHANCEMENT ═══════
  {
    name: "enhance_character_prompt",
    description:
      "Expand a short character description into a richer, more detailed prompt for create_character_v3. Returns enhanced text — does not generate an image. Use this to preview/refine a prompt before generating.",
    inputSchema: {
      type: "object",
      properties: {
        description: { type: "string", description: "Character description to enhance" },
        image_size: sizeSchema("Output frame size, 32-256px (advisory)"),
        view: { type: "string", enum: ["low top-down", "high top-down", "side"], description: "Camera view (default 'low top-down')" },
        outline: { type: "string", description: "Outline style hint" },
        detail: { type: "string", description: "Detail level hint" },
      },
      required: ["description", "image_size"],
    },
    handler: async (client, args) => client.post("/enhance-character-v3-prompt", args),
  },
  {
    name: "enhance_animation_prompt",
    description:
      "Expand a short action description into a richer motion prompt for animate_with_text_v3. Provide the first frame (and optional last frame for interpolation). Returns enhanced text — does not generate frames.",
    inputSchema: {
      type: "object",
      properties: {
        first_frame: imageSchema("Starting frame image"),
        action: { type: "string", description: "Action description to enhance (e.g. 'walking', 'sword swing')" },
        last_frame: imageSchema("Optional end frame; when provided the prompt describes the interpolated motion"),
      },
      required: ["first_frame", "action"],
    },
    handler: async (client, args) => client.post("/enhance-animation-v3-prompt", args),
  },
  {
    name: "enhance_pixen_prompt",
    description:
      "Expand a short image description into a richer prompt for create_image_pixen. Returns enhanced text — does not generate an image.",
    inputSchema: {
      type: "object",
      properties: {
        description: { type: "string", description: "Image description to enhance" },
        image_size: sizeSchema("Width/height each 16-768, max area 512x512, both divisible by 4"),
        outline: pixenOutline,
        detail: detailEnum,
        view: viewEnum,
        direction: directionEnum,
        no_background: { type: "boolean", description: "Enhanced description targets a plain background (default false)", default: false },
      },
      required: ["description", "image_size"],
    },
    handler: async (client, args) => client.post("/enhance-pixen-prompt", args),
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
