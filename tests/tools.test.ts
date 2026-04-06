import { describe, it, expect } from "vitest";
import { tools } from "../src/tools.js";

describe("Tool definitions", () => {
  it("registers all 47 tools", () => {
    expect(tools.length).toBe(47);
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
      "animate_with_skeleton",
      "animate_with_text",
      "inpaint",
      "rotate",
    ];

    for (const name of legacyTools) {
      it(`${name} uses legacy field names (not v2)`, () => {
        const tool = tools.find((t) => t.name === name)!;
        const props = Object.keys(tool.inputSchema.properties as Record<string, unknown>);

        // Legacy endpoints should NOT have v2 field names
        expect(props).not.toContain("guidance_scale");
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

    it("animate_with_skeleton has correct guidance scales", () => {
      const tool = tools.find((t) => t.name === "animate_with_skeleton")!;
      const props = Object.keys(tool.inputSchema.properties as Record<string, unknown>);
      expect(props).toContain("reference_guidance_scale");
      expect(props).toContain("pose_guidance_scale");
    });

    it("rotate has view_change and direction_change", () => {
      const tool = tools.find((t) => t.name === "rotate")!;
      const props = Object.keys(tool.inputSchema.properties as Record<string, unknown>);
      expect(props).toContain("view_change");
      expect(props).toContain("direction_change");
      expect(props).toContain("image_guidance_scale");
    });
  });

  describe("Pro/v2 endpoint field names", () => {
    const v2Tools = [
      "generate_image",
      "generate_with_style",
      "generate_ui",
      "edit_animation",
      "interpolate_frames",
      "animate_with_text_v2",
      "edit_images",
      "edit_image",
      "inpaint_v3",
    ];

    for (const name of v2Tools) {
      it(`${name} uses v2 field names (not legacy)`, () => {
        const tool = tools.find((t) => t.name === name)!;
        const props = Object.keys(tool.inputSchema.properties as Record<string, unknown>);

        // V2 endpoints should NOT have legacy field names
        expect(props).not.toContain("text_guidance_scale");
        expect(props).not.toContain("no_background");
        expect(props).not.toContain("color_image");
      });
    }
  });

  describe("Character/object endpoints", () => {
    it("create_character_4dir has proportions schema", () => {
      const tool = tools.find((t) => t.name === "create_character_4dir")!;
      const props = tool.inputSchema.properties as Record<string, any>;
      expect(props).toHaveProperty("proportions");
      expect(props.proportions.properties).toHaveProperty("type");
      expect(props.proportions.properties).toHaveProperty("name");
    });

    it("animate_character has frame_count and style params", () => {
      const tool = tools.find((t) => t.name === "animate_character")!;
      const props = Object.keys(tool.inputSchema.properties as Record<string, unknown>);
      expect(props).toContain("frame_count");
      expect(props).toContain("outline");
      expect(props).toContain("shading");
      expect(props).toContain("detail");
    });
  });

  describe("inpaint_v3 uses correct field names", () => {
    it("uses inpainting_image_size not image_size", () => {
      const tool = tools.find((t) => t.name === "inpaint_v3")!;
      const props = Object.keys(tool.inputSchema.properties as Record<string, unknown>);
      expect(props).toContain("inpainting_image_size");
      expect(props).not.toContain("image_size");
    });
  });
});
