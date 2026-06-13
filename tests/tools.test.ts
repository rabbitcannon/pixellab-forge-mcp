import { describe, it, expect } from "vitest";
import { tools, resolveImageArg } from "../src/tools.js";

describe("Tool definitions", () => {
  it("registers all 66 tools", () => {
    expect(tools.length).toBe(66);
  });

  it("every tool has a unique name", () => {
    const names = tools.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it("every tool has a non-empty description", () => {
    for (const tool of tools) {
      expect(tool.description.length).toBeGreaterThan(0);
    }
  });

  it("every tool has a valid inputSchema with type 'object'", () => {
    for (const tool of tools) {
      expect(tool.inputSchema.type).toBe("object");
      expect(tool.inputSchema).toHaveProperty("properties");
    }
  });

  it("every tool has a handler function", () => {
    for (const tool of tools) {
      expect(typeof tool.handler).toBe("function");
    }
  });

  it("required fields reference existing properties", () => {
    for (const tool of tools) {
      const required = tool.inputSchema.required as string[] | undefined;
      if (!required) continue;
      const properties = tool.inputSchema.properties as Record<string, unknown>;
      for (const field of required) {
        expect(properties).toHaveProperty(
          field,
          expect.anything(),
        );
      }
    }
  });

  // Verify correct field names per API generation
  describe("Legacy endpoint field names", () => {
    const legacyTools = [
      "create_image_pixflux",
      "create_image_bitforge",
      "animate_with_text",
      "inpaint",
      "rotate",
    ];

    for (const name of legacyTools) {
      it(`${name} uses legacy field names (not v2)`, () => {
        const tool = tools.find((t) => t.name === name)!;
        const props = Object.keys(tool.inputSchema.properties as Record<string, unknown>);

        // Legacy endpoints should NOT have v2 field names
        expect(props).not.toContain("remove_background");
        expect(props).not.toContain("ai_freedom");
      });
    }

    it("create_image_pixflux has correct legacy fields", () => {
      const tool = tools.find((t) => t.name === "create_image_pixflux")!;
      const props = Object.keys(tool.inputSchema.properties as Record<string, unknown>);
      expect(props).toContain("text_guidance_scale");
      expect(props).toContain("no_background");
      expect(props).toContain("color_image");
      expect(props).toContain("seed");
    });

    it("create_image_bitforge has correct legacy fields", () => {
      const tool = tools.find((t) => t.name === "create_image_bitforge")!;
      const props = Object.keys(tool.inputSchema.properties as Record<string, unknown>);
      expect(props).toContain("text_guidance_scale");
      expect(props).toContain("no_background");
      expect(props).toContain("color_image");
      expect(props).toContain("skeleton_keypoints");
    });

    it("animate_with_skeleton has correct guidance_scale", () => {
      const tool = tools.find((t) => t.name === "animate_with_skeleton")!;
      const props = Object.keys(tool.inputSchema.properties as Record<string, unknown>);
      expect(props).toContain("guidance_scale");
    });

    it("rotate has view_change and direction_change", () => {
      const tool = tools.find((t) => t.name === "rotate")!;
      const props = Object.keys(tool.inputSchema.properties as Record<string, unknown>);
      expect(props).toContain("view_change");
      expect(props).toContain("direction_change");
      expect(props).toContain("image_guidance_scale");
    });
  });

  describe("v2/Pro endpoints use no_background and seed (not guidance_scale/remove_background/ai_freedom)", () => {
    const v2Tools = [
      "generate_image",
      "generate_with_style",
      "generate_ui",
      "edit_animation",
      "interpolate_frames",
      "animate_with_text_v2",
      "edit_images",
      "inpaint_v3",
    ];

    for (const name of v2Tools) {
      it(`${name} has no_background and seed, not guidance_scale/remove_background/ai_freedom`, () => {
        const tool = tools.find((t) => t.name === name)!;
        const props = Object.keys(tool.inputSchema.properties as Record<string, unknown>);

        expect(props).toContain("no_background");
        expect(props).toContain("seed");
        expect(props).not.toContain("guidance_scale");
        expect(props).not.toContain("remove_background");
        expect(props).not.toContain("ai_freedom");
      });
    }
  });

  describe("edit_image uses correct field names per OpenAPI spec", () => {
    it("has image, width, height (not reference_image, target_canvas_size)", () => {
      const tool = tools.find((t) => t.name === "edit_image")!;
      const props = Object.keys(tool.inputSchema.properties as Record<string, unknown>);
      expect(props).toContain("image");
      expect(props).toContain("width");
      expect(props).toContain("height");
      expect(props).not.toContain("reference_image");
      expect(props).not.toContain("target_canvas_size");
      expect(props).not.toContain("reference_image_size");
    });
  });

  describe("Character/object endpoints", () => {
    it("create_character_4dir has proportions schema", () => {
      const tool = tools.find((t) => t.name === "create_character_4dir")!;
      const props = tool.inputSchema.properties as Record<string, any>;
      expect(props).toHaveProperty("proportions");
      expect(props.proportions.properties).toHaveProperty("type");
      expect(props.proportions.properties).toHaveProperty("name");
    });

    it("create_character_4dir uses text_guidance_scale not guidance_scale", () => {
      const tool = tools.find((t) => t.name === "create_character_4dir")!;
      const props = Object.keys(tool.inputSchema.properties as Record<string, unknown>);
      expect(props).toContain("text_guidance_scale");
      expect(props).not.toContain("guidance_scale");
      expect(props).not.toContain("ai_freedom");
    });

    it("animate_character uses template_animation_id and style params", () => {
      const tool = tools.find((t) => t.name === "animate_character")!;
      const props = Object.keys(tool.inputSchema.properties as Record<string, unknown>);
      expect(props).toContain("template_animation_id");
      expect(props).toContain("outline");
      expect(props).toContain("shading");
      expect(props).toContain("detail");
      expect(props).not.toContain("animation_type");
      expect(props).not.toContain("frame_count");
    });
  });

  describe("read_image utility tool", () => {
    it("exists and accepts file_path", () => {
      const tool = tools.find((t) => t.name === "read_image")!;
      expect(tool).toBeDefined();
      const props = Object.keys(tool.inputSchema.properties as Record<string, unknown>);
      expect(props).toContain("file_path");
      expect(tool.inputSchema.required).toContain("file_path");
    });

    it("reads a PNG file and returns Base64Image object", async () => {
      const { writeFileSync, rmSync } = await import("node:fs");
      const { join } = await import("node:path");
      const { rgbaToPng } = await import("../src/save-images.js");

      const tmpFile = join(process.cwd(), "test_read_image_tmp.png");
      const png = rgbaToPng(Buffer.alloc(4, 255), 1, 1);
      writeFileSync(tmpFile, png);

      try {
        const tool = tools.find((t) => t.name === "read_image")!;
        const result = await tool.handler(null as any, { file_path: tmpFile }) as any;

        expect(result.image).toBeDefined();
        expect(result.image.type).toBe("base64");
        expect(result.image.format).toBe("png");
        expect(result.image.base64.length).toBeGreaterThan(0);

        // Verify the base64 decodes to valid PNG
        const decoded = Buffer.from(result.image.base64, "base64");
        expect(decoded[0]).toBe(0x89);
        expect(decoded[1]).toBe(0x50);
      } finally {
        rmSync(tmpFile);
      }
    });
  });

  describe("inpaint_v3 uses correct field names", () => {
    it("has crop_to_mask and no_background, not inpainting_image_size", () => {
      const tool = tools.find((t) => t.name === "inpaint_v3")!;
      const props = Object.keys(tool.inputSchema.properties as Record<string, unknown>);
      expect(props).toContain("crop_to_mask");
      expect(props).toContain("no_background");
      expect(props).not.toContain("inpainting_image_size");
    });
  });

  // Helper to fetch props for a tool by name
  const propsOf = (name: string) =>
    Object.keys(
      tools.find((t) => t.name === name)!.inputSchema.properties as Record<string, unknown>,
    );

  describe("Object endpoints (fixed create_object_4dir)", () => {
    it("does not register the non-existent create_object_4dir", () => {
      expect(tools.find((t) => t.name === "create_object_4dir")).toBeUndefined();
    });

    it("registers create_object_1dir mapping to /create-1-direction-object", async () => {
      const tool = tools.find((t) => t.name === "create_object_1dir")!;
      expect(tool).toBeDefined();
      const props = propsOf("create_object_1dir");
      // Object endpoints use a single `size` int, not character-style image_size/text_guidance_scale
      expect(props).toContain("size");
      expect(props).toContain("style_images");
      expect(props).not.toContain("image_size");
      expect(props).not.toContain("text_guidance_scale");
      expect(tool.inputSchema.required).toEqual(["description"]);

      const calls: any[] = [];
      await tool.handler({ post: (p: string, b: unknown) => (calls.push([p, b]), Promise.resolve({})) } as any, { description: "barrel" });
      expect(calls[0][0]).toBe("/create-1-direction-object");
    });

    it("registers create_object_8dir mapping to /create-8-direction-object", async () => {
      const tool = tools.find((t) => t.name === "create_object_8dir")!;
      expect(tool).toBeDefined();
      const props = propsOf("create_object_8dir");
      expect(props).toContain("size");
      expect(props).toContain("reference_image");
      expect(props).toContain("style_image");
      expect(props).not.toContain("image_size");

      const calls: any[] = [];
      await tool.handler({ post: (p: string, b: unknown) => (calls.push([p, b]), Promise.resolve({})) } as any, { description: "crate" });
      expect(calls[0][0]).toBe("/create-8-direction-object");
    });
  });

  describe("Path-parameter handlers strip the id from the body", () => {
    const cases = [
      { name: "animate_object", arg: "object_id", id: "obj-1", expectedPath: "/objects/obj-1/animations", extra: { animation_description: "walk" } },
      { name: "create_object_state", arg: "object_id", id: "obj-2", expectedPath: "/objects/obj-2/states", extra: { edit_description: "open" } },
      { name: "select_object_frames", arg: "object_id", id: "obj-3", expectedPath: "/objects/obj-3/select-frames", extra: { indices: [0, 1] } },
    ];

    for (const { name, arg, id, expectedPath, extra } of cases) {
      it(`${name} posts to ${expectedPath} without ${arg} in body`, async () => {
        const tool = tools.find((t) => t.name === name)!;
        const calls: any[] = [];
        const mockClient = { post: (p: string, b: unknown) => (calls.push([p, b]), Promise.resolve({ ok: true })) } as any;

        await tool.handler(mockClient, { [arg]: id, ...extra });

        expect(calls[0][0]).toBe(expectedPath);
        expect(calls[0][1]).not.toHaveProperty(arg);
        for (const key of Object.keys(extra)) {
          expect(calls[0][1]).toHaveProperty(key);
        }
      });
    }

    it("dismiss_object_review posts to dismiss-review with an empty body", async () => {
      const tool = tools.find((t) => t.name === "dismiss_object_review")!;
      const calls: any[] = [];
      const mockClient = { post: (p: string, b: unknown) => (calls.push([p, b]), Promise.resolve({})) } as any;

      await tool.handler(mockClient, { object_id: "obj-9" });

      expect(calls[0][0]).toBe("/objects/obj-9/dismiss-review");
      expect(calls[0][1]).toEqual({});
    });
  });

  describe("New v3/Pro generation endpoints", () => {
    it("create_character_v3 only requires description and supports reference_image", () => {
      const tool = tools.find((t) => t.name === "create_character_v3")!;
      const props = propsOf("create_character_v3");
      expect(props).toContain("reference_image");
      expect(props).toContain("enhance_prompt");
      expect(tool.inputSchema.required).toEqual(["description"]);
    });

    it("create_character_pro requires description and image_size", () => {
      const tool = tools.find((t) => t.name === "create_character_pro")!;
      expect(propsOf("create_character_pro")).toContain("method");
      expect(tool.inputSchema.required).toEqual(["description", "image_size"]);
    });

    it("create_character_state requires character_id and edit_description", () => {
      const tool = tools.find((t) => t.name === "create_character_state")!;
      expect(tool.inputSchema.required).toEqual(["character_id", "edit_description"]);
    });

    it("create_character_animation supports template/v3/pro modes", () => {
      const props = propsOf("create_character_animation");
      expect(props).toContain("mode");
      expect(props).toContain("template_animation_id");
      expect(props).toContain("action_description");
      expect(props).toContain("frame_count");
    });

    it("generate_8_rotations_v3 requires first_frame", () => {
      const tool = tools.find((t) => t.name === "generate_8_rotations_v3")!;
      expect(tool.inputSchema.required).toEqual(["first_frame"]);
    });

    it("image_to_pixelart_pro requires only image", () => {
      const tool = tools.find((t) => t.name === "image_to_pixelart_pro")!;
      expect(tool.inputSchema.required).toEqual(["image"]);
    });

    it("create_image_pixen uses outline/detail enums and enhance_prompt", () => {
      const props = propsOf("create_image_pixen");
      expect(props).toContain("outline");
      expect(props).toContain("detail");
      expect(props).toContain("enhance_prompt");
    });
  });

  describe("Prompt enhancement endpoints", () => {
    const enhancers = ["enhance_character_prompt", "enhance_animation_prompt", "enhance_pixen_prompt"];
    for (const name of enhancers) {
      it(`${name} is registered with a handler`, () => {
        const tool = tools.find((t) => t.name === name)!;
        expect(tool).toBeDefined();
        expect(typeof tool.handler).toBe("function");
      });
    }

    it("enhance_animation_prompt requires first_frame and action", () => {
      const tool = tools.find((t) => t.name === "enhance_animation_prompt")!;
      expect(tool.inputSchema.required).toEqual(["first_frame", "action"]);
    });
  });

  describe("List endpoints build pagination query strings", () => {
    for (const [name, base] of [
      ["list_tilesets", "/tilesets"],
      ["list_isometric_tiles", "/isometric-tiles"],
    ] as const) {
      it(`${name} appends limit/offset to ${base}`, async () => {
        const tool = tools.find((t) => t.name === name)!;
        const calls: string[] = [];
        const mockClient = { get: (p: string) => (calls.push(p), Promise.resolve({})) } as any;

        await tool.handler(mockClient, { limit: 10, offset: 5 });
        expect(calls[0]).toBe(`${base}?limit=10&offset=5`);

        await tool.handler(mockClient, {});
        expect(calls[1]).toBe(base);
      });
    }
  });

  describe("validateId on path-parameter handlers", () => {
    // Every handler that interpolates an id into a URL path.
    const idTools: Array<[string, string, string]> = [
      ["get_character", "character_id", "/characters/"],
      ["delete_character", "character_id", "/characters/"],
      ["update_character_tags", "character_id", "/characters/"],
      ["download_character_zip", "character_id", "/characters/"],
      ["get_object", "object_id", "/objects/"],
      ["delete_object", "object_id", "/objects/"],
      ["update_object_tags", "object_id", "/objects/"],
      ["animate_object", "object_id", "/objects/"],
      ["create_object_state", "object_id", "/objects/"],
      ["select_object_frames", "object_id", "/objects/"],
      ["dismiss_object_review", "object_id", "/objects/"],
    ];

    for (const [name, idField] of idTools) {
      it(`${name} rejects an id with path-traversal characters`, async () => {
        const tool = tools.find((t) => t.name === name)!;
        const mockClient = {
          get: () => Promise.resolve({}),
          delete: () => Promise.resolve({}),
          patch: () => Promise.resolve({}),
          post: () => Promise.resolve({}),
          getBinary: () => Promise.resolve({ data: "", mimeType: "application/zip" }),
        } as any;
        await expect(
          tool.handler(mockClient, { [idField]: "../../etc/passwd", indices: [0], edit_description: "x" }),
        ).rejects.toThrow(/Invalid/);
      });
    }

    it("get_character passes a valid id through (encoded)", async () => {
      const tool = tools.find((t) => t.name === "get_character")!;
      const calls: string[] = [];
      const mockClient = { get: (p: string) => (calls.push(p), Promise.resolve({})) } as any;
      await tool.handler(mockClient, { character_id: "abc-123_XYZ" });
      expect(calls[0]).toBe("/characters/abc-123_XYZ");
    });
  });

  describe("download_character_zip saves the ZIP to disk (binary, not JSON)", () => {
    it("uses getBinary, writes a file, and returns its path", async () => {
      const { rmSync, existsSync, readFileSync } = await import("node:fs");
      const tool = tools.find((t) => t.name === "download_character_zip")!;
      const zip = Buffer.from([0x50, 0x4b, 0x03, 0x04, 9, 9]);
      let calledPath = "";
      const mockClient = {
        getBinary: (p: string) => {
          calledPath = p;
          return Promise.resolve({ data: zip.toString("base64"), mimeType: "application/zip", filename: "hero.zip" });
        },
      } as any;

      const result = await tool.handler(mockClient, { character_id: "char1" }) as any;
      try {
        expect(calledPath).toBe("/characters/char1/zip");
        expect(result.success).toBe(true);
        expect(result.size_bytes).toBe(zip.length);
        expect(result.file_path).toMatch(/pixellab-forge-output[\\/]hero\.zip$/);
        expect(existsSync(result.file_path)).toBe(true);
        expect(readFileSync(result.file_path)).toEqual(zip);
      } finally {
        try { rmSync(result.file_path); } catch {}
      }
    });
  });

  describe("resolveImageArg", () => {
    it("resolves a nested image object's file_path into a base64 object", async () => {
      const { writeFileSync, rmSync } = await import("node:fs");
      const { join } = await import("node:path");
      const tmp = join(process.cwd(), "test_resolve_img_tmp.png");
      writeFileSync(tmp, Buffer.from([1, 2, 3, 4]));
      try {
        const out = await resolveImageArg({ image: { file_path: tmp } }) as any;
        expect(out.image.type).toBe("base64");
        expect(out.image.format).toBe("png");
        expect(Buffer.from(out.image.base64, "base64")).toEqual(Buffer.from([1, 2, 3, 4]));
      } finally {
        rmSync(tmp);
      }
    });

    it("rejects a file_path outside the allowed roots", async () => {
      await expect(
        resolveImageArg({ image: { file_path: "/etc/passwd" } }),
      ).rejects.toThrow(/outside allowed directories/);
    });

    it("leaves an image object that already has base64 untouched", async () => {
      const input = { image: { type: "base64", base64: "QUJD", format: "png" } };
      const out = await resolveImageArg(input) as any;
      expect(out.image.base64).toBe("QUJD");
    });

    it("passes primitives through unchanged (e.g. read_image's top-level file_path string)", async () => {
      expect(await resolveImageArg("some/path.png")).toBe("some/path.png");
      expect(await resolveImageArg(42)).toBe(42);
    });
  });
});
