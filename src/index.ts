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

const apiKey = process.env["PIXELLAB_API_KEY"];
if (!apiKey) {
  console.error("Error: PIXELLAB_API_KEY environment variable is required.");
  console.error("Get your API key from https://pixellab.ai/account");
  process.exit(1);
}

const client = new PixelLabClient(apiKey);

const server = new Server(
  { name: "pixelforge-mcp", version: "1.1.0" },
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
  const args = request.params.arguments ?? {};
  const tool = toolMap.get(name);

  if (!tool) {
    return {
      content: [{ type: "text" as const, text: `Unknown tool: ${name}` }],
      isError: true,
    };
  }

  try {
    const result = await tool.handler(client, args);
    const { images, result: strippedResult } = extractAndSaveImages(result, name);

    const parts: Array<{ type: "text"; text: string } | { type: "image"; data: string; mimeType: string }> = [];

    if (images.length > 0) {
      parts.push({
        type: "text" as const,
        text: `Saved ${images.length} image(s):\n${images.map((img) => img.filePath).join("\n")}`,
      });

      for (const img of images) {
        parts.push({
          type: "image" as const,
          data: img.base64,
          mimeType: "image/png",
        });
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
