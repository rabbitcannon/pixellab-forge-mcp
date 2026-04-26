#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
  ListPromptsRequestSchema,
  GetPromptRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { PixelLabClient } from "./api-client.js";
import { tools } from "./tools.js";
import { prompts } from "./prompts.js";
import { extractAndSaveImages } from "./save-images.js";
import { getJobEndpoint, getJobDescription } from "./job-log.js";

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, 60);
}

const apiKey = process.env["PIXELLAB_API_KEY"];
if (!apiKey) {
  console.error("Error: PIXELLAB_API_KEY environment variable is required.");
  console.error("Get your API key from https://pixellab.ai/account");
  process.exit(1);
}

const client = new PixelLabClient(apiKey);

const server = new Server(
  { name: "pixellab-forge-mcp", version: "1.2.0" },
  { capabilities: { tools: {}, prompts: {} } },
);

const toolMap = new Map(tools.map((t) => [t.name, t]));

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: tools.map((t) => ({
    name: t.name,
    description: t.description,
    inputSchema: t.inputSchema as any,
  })),
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name } = request.params;
  // Resolve file_path inside image parameters so tools never receive large base64 blobs.
  // We iterate values (not the top-level dict) so plain file_path params like read_image's are unaffected.
  const rawArgs = request.params.arguments ?? {};
  const args: Record<string, unknown> = Object.fromEntries(
    await Promise.all(
      Object.entries(rawArgs).map(async ([k, v]) => [k, await resolveImageArg(v)] as const)
    )
  );
  const tool = toolMap.get(name);

  if (!tool) {
    return {
      content: [{ type: "text" as const, text: `Unknown tool: ${name}` }],
      isError: true,
    };
  }

  try {
    const result = await tool.handler(client, args);
    process.stderr.write(`[pixellab-forge-mcp] Raw response keys for ${name}: ${result && typeof result === "object" ? JSON.stringify(Object.keys(result as object)) : typeof result}\n`);

    // read_image returns raw base64 for use in subsequent tool calls — skip extraction/stripping
    if (name === "read_image") {
      return {
        content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
      };
    }

    // Derive a meaningful filename from the prompt description when available
    let imageLabel = name;
    const desc = args.description ?? args.text;
    if (typeof desc === "string" && desc.length > 0) {
      imageLabel = slugify(desc);
    } else if (name === "get_job_status" && typeof args.job_id === "string") {
      // Look up the original description stored when the job was created
      const jobDesc = getJobDescription(args.job_id);
      if (jobDesc) {
        imageLabel = slugify(jobDesc);
      } else {
        const endpoint = getJobEndpoint(args.job_id);
        if (endpoint) {
          imageLabel = endpoint.replace(/^\//, "").replace(/-/g, "_");
        }
      }
    }

    const { images, result: strippedResult } = extractAndSaveImages(result, imageLabel);
    process.stderr.write(`[pixellab-forge-mcp] Extracted ${images.length} image(s), valid for inline: ${images.filter(i => i.base64.length > 0).length}\n`);
    if (images.length > 0) {
      const first = images[0];
      process.stderr.write(`[pixellab-forge-mcp] First image: base64 length=${first.base64.length}, mime=${first.mimeType}, path=${first.filePath}\n`);
    }

    const parts: Array<{ type: "text"; text: string } | { type: "image"; data: string; mimeType: string }> = [];

    if (images.length > 0) {
      // Limit inline image blocks to avoid overwhelming the Claude API.
      // All images are still saved to disk regardless.
      const MAX_INLINE_IMAGES = 4;
      const inlineImages = images.slice(0, MAX_INLINE_IMAGES);

      parts.push({
        type: "text" as const,
        text: `Saved ${images.length} image(s):\n${images.map((img) => img.filePath).join("\n")}${
          images.length > MAX_INLINE_IMAGES
            ? `\n\n(Showing first ${MAX_INLINE_IMAGES} of ${images.length} images inline. All images saved to disk.)`
            : ""
        }`,
      });

      for (const img of inlineImages) {
        if (img.base64) {
          parts.push({
            type: "image" as const,
            data: img.base64,
            mimeType: img.mimeType,
          });
        }
      }
    }

    parts.push({
      type: "text" as const,
      text: JSON.stringify(strippedResult, null, 2),
    });

    return { content: parts };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      content: [{ type: "text" as const, text: `Error: ${message}` }],
      isError: true,
    };
  }
});

const promptMap = new Map(prompts.map((p) => [p.name, p]));

server.setRequestHandler(ListPromptsRequestSchema, async () => ({
  prompts: prompts.map((p) => ({
    name: p.name,
    description: p.description,
    arguments: p.arguments,
  })),
}));

server.setRequestHandler(GetPromptRequestSchema, async (request) => {
  const { name } = request.params;
  const args = request.params.arguments ?? {};
  const prompt = promptMap.get(name);

  if (!prompt) {
    throw new Error(`Unknown prompt: ${name}`);
  }

  return {
    description: prompt.description,
    messages: prompt.messages(args),
  };
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
