import { describe, it, expect } from "vitest";
import { Readable, Writable } from "node:stream";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { tools } from "../src/tools.js";

/** Send a JSON message through a Readable stream */
function sendMessage(stream: Readable, msg: object) {
  stream.push(JSON.stringify(msg) + "\n");
}

/** Collect output from a Writable stream */
function createCollector() {
  const chunks: Buffer[] = [];
  const stream = new Writable({
    write(chunk, _enc, cb) {
      chunks.push(chunk);
      cb();
    },
  });
  return {
    stream,
    getMessages(): object[] {
      return Buffer.concat(chunks)
        .toString()
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line));
    },
  };
}

describe("MCP Server integration", () => {
  it("completes handshake and lists all tools", async () => {
    const fakeStdin = new Readable({ read() {} });
    const collector = createCollector();

    const server = new Server(
      { name: "pixelforge-mcp", version: "1.0.0" },
      { capabilities: { tools: {} } },
    );

    server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: tools.map((t) => ({
        name: t.name,
        description: t.description,
        inputSchema: t.inputSchema as any,
      })),
    }));

    const transport = new StdioServerTransport(fakeStdin, collector.stream);
    await server.connect(transport);

    // Initialize
    sendMessage(fakeStdin, {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "test", version: "1.0.0" },
      },
    });

    await new Promise((r) => setTimeout(r, 200));

    // Initialized notification
    sendMessage(fakeStdin, {
      jsonrpc: "2.0",
      method: "notifications/initialized",
    });

    // List tools
    sendMessage(fakeStdin, {
      jsonrpc: "2.0",
      id: 2,
      method: "tools/list",
      params: {},
    });

    await new Promise((r) => setTimeout(r, 500));

    const messages = collector.getMessages();

    // Find initialize response
    const initResponse = messages.find((m: any) => m.id === 1) as any;
    expect(initResponse.result.serverInfo.name).toBe("pixelforge-mcp");

    // Find tools/list response
    const toolsResponse = messages.find((m: any) => m.id === 2) as any;
    expect(toolsResponse.result.tools).toHaveLength(47);

    // Verify a few tool names
    const toolNames = toolsResponse.result.tools.map((t: any) => t.name);
    expect(toolNames).toContain("generate_image");
    expect(toolNames).toContain("create_character_4dir");
    expect(toolNames).toContain("list_pending_jobs");
    expect(toolNames).toContain("get_balance");

    await server.close();
  });
});
