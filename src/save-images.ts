import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const OUTPUT_DIR = join(process.cwd(), "pixelforge-output");

function ensureOutputDir() {
  mkdirSync(OUTPUT_DIR, { recursive: true });
}

/** Generate a filename from the tool name and a short ID */
function makeFilename(toolName: string, index: number, id?: string): string {
  const timestamp = Date.now();
  const suffix = id ? `_${id.slice(0, 8)}` : "";
  const indexStr = index > 0 ? `_${index}` : "";
  return `${toolName}${suffix}${indexStr}_${timestamp}.png`;
}

/** Decode a base64 image string, handling data URI prefix if present */
function decodeBase64(data: string): Buffer {
  const raw = data.replace(/^data:image\/\w+;base64,/, "");
  return Buffer.from(raw, "base64");
}

/** Save a single base64 image and return the file path */
function saveImage(base64: string, toolName: string, index: number, id?: string): string {
  ensureOutputDir();
  const filename = makeFilename(toolName, index, id);
  const filepath = join(OUTPUT_DIR, filename);
  writeFileSync(filepath, decodeBase64(base64));
  return filepath;
}

export interface ExtractedImage {
  base64: string;
  filePath: string;
}

/**
 * Walk through an API response, find all base64 image data,
 * save them to disk, and return the file paths + raw base64 for MCP image blocks.
 * Also strips base64 data from the result to keep the JSON response small.
 */
export function extractAndSaveImages(
  result: unknown,
  toolName: string,
): { images: ExtractedImage[]; result: unknown } {
  const images: ExtractedImage[] = [];

  if (!result || typeof result !== "object") {
    return { images, result };
  }

  const data = result as Record<string, unknown>;

  // Single image response: { image: { type: "base64", base64: "...", format: "png" } }
  if (isImageObj(data.image)) {
    const b64 = (data.image as any).base64;
    const path = saveImage(b64, toolName, 0);
    images.push({ base64: b64, filePath: path });
    stripBase64(data.image);
  }

  // Single image as direct base64 string: { image: "base64..." }
  if (typeof data.image === "string" && data.image.length > 100) {
    const path = saveImage(data.image, toolName, 0);
    images.push({ base64: data.image, filePath: path });
    data.image = "[base64 image data stripped]";
  }

  // Multiple images: { images: [{ type: "base64", base64: "..." }, ...] }
  if (Array.isArray(data.images)) {
    data.images.forEach((img: unknown, i: number) => {
      if (isImageObj(img)) {
        const b64 = (img as any).base64;
        const path = saveImage(b64, toolName, i);
        images.push({ base64: b64, filePath: path });
        stripBase64(img);
      } else if (typeof img === "string" && img.length > 100) {
        const path = saveImage(img, toolName, i);
        images.push({ base64: img, filePath: path });
        (data.images as any[])[i] = "[base64 image data stripped]";
      }
    });
  }

  // Frames response: { frames: [{ type: "base64", base64: "..." }, ...] }
  if (Array.isArray(data.frames)) {
    data.frames.forEach((frame: unknown, i: number) => {
      if (isImageObj(frame)) {
        const b64 = (frame as any).base64;
        const path = saveImage(b64, toolName, i);
        images.push({ base64: b64, filePath: path });
        stripBase64(frame);
      }
    });
  }

  // Character directions: { directions: { south: { image: {...} }, ... } }
  if (data.directions && typeof data.directions === "object") {
    const dirs = data.directions as Record<string, unknown>;
    let i = 0;
    for (const [dir, value] of Object.entries(dirs)) {
      if (value && typeof value === "object") {
        const dirData = value as Record<string, unknown>;
        if (isImageObj(dirData.image)) {
          const b64 = (dirData.image as any).base64;
          const path = saveImage(b64, `${toolName}_${dir}`, i);
          images.push({ base64: b64, filePath: path });
          stripBase64(dirData.image);
          i++;
        }
      }
    }
  }

  // Tileset tiles: { tiles: [{ image: {...} }, ...] }
  if (Array.isArray(data.tiles)) {
    data.tiles.forEach((tile: unknown, i: number) => {
      if (tile && typeof tile === "object") {
        const t = tile as Record<string, unknown>;
        if (isImageObj(t.image)) {
          const b64 = (t.image as any).base64;
          const path = saveImage(b64, toolName, i);
          images.push({ base64: b64, filePath: path });
          stripBase64(t.image);
        }
      }
    });
  }

  // Nested in last_response (from job polling)
  if (data.last_response && typeof data.last_response === "object") {
    const nested = extractAndSaveImages(data.last_response, toolName);
    images.push(...nested.images);
  }

  return { images, result };
}

function isImageObj(val: unknown): boolean {
  return (
    val !== null &&
    typeof val === "object" &&
    typeof (val as any).base64 === "string" &&
    (val as any).base64.length > 100
  );
}

/** Replace base64 data in-place with a placeholder to keep JSON responses small */
function stripBase64(obj: unknown): void {
  if (obj && typeof obj === "object") {
    (obj as any).base64 = "[stripped]";
  }
}
