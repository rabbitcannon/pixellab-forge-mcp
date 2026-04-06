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

  describe("inpaint_v3 uses correct field names", () => {
    it("has crop_to_mask and no_background, not inpainting_image_size", () => {
      const tool = tools.find((t) => t.name === "inpaint_v3")!;
      const props = Object.keys(tool.inputSchema.properties as Record<string, unknown>);
      expect(props).toContain("crop_to_mask");
      expect(props).toContain("no_background");
      expect(props).not.toContain("inpainting_image_size");
    });
  });
});
