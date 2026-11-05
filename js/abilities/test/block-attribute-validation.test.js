/* global afterEach, beforeEach, describe, expect, it, jest */

import { deepMergeAttributes, normalizeAttributes } from "../block-attribute-validation";
import { normalizeColorAttributeValues } from "../color-attribute-normalization";

const paragraphType = {
	name: "core/paragraph",
	attributes: {
		content: { type: "string", default: "" },
		dropCap: { type: "boolean", default: false },
		level: { type: "integer" },
		style: { type: "object", default: {} },
		textColor: { type: "string" },
		backgroundColor: { type: "string" },
		gradient: { type: "string" },
	},
};

describe("block attribute validation", () => {
	beforeEach(() => {
		globalThis.window = {
			CSS: {
				supports: jest.fn(
					(_property, value) => value === "pink" || /^#(?:[\da-f]{3}|[\da-f]{6})$/i.test(value)
				),
			},
			wp: {
				data: {
					select: jest.fn((store) =>
						store === "core/block-editor"
							? { getSettings: jest.fn(() => ({ colors: [] })) }
							: {
									getBlockType: jest.fn((name) =>
										name === "core/paragraph" ? paragraphType : null
									),
								}
					),
				},
			},
		};
	});

	afterEach(() => {
		delete globalThis.window;
	});

	it("rejects unknown attributes and scalar type mismatches", () => {
		expect(() => normalizeAttributes("core/paragraph", { mystery: true })).toThrow(
			/unknown attribute.*mystery/i
		);
		expect(() => normalizeAttributes("core/paragraph", { dropCap: "yes" })).toThrow(
			/dropCap.*boolean/i
		);
		expect(() => normalizeAttributes("core/paragraph", { level: 2.5 })).toThrow(/level.*integer/i);
	});

	it("fills defaults for query items and validates nested values", () => {
		paragraphType.attributes.links = {
			type: "array",
			source: "query",
			query: {
				url: { type: "string" },
				label: { type: "string", default: "Read more" },
				meta: {
					type: "object",
					properties: { featured: { type: "boolean", default: false } },
				},
			},
		};
		expect(normalizeAttributes("core/paragraph", { links: [{ url: "/news" }] })).toEqual({
			links: [{ url: "/news", label: "Read more", meta: { featured: false } }],
		});
		expect(() => normalizeAttributes("core/paragraph", { links: [{ url: 12 }] })).toThrow(
			/links\[0\]\.url.*string/i
		);
	});

	it("does not fill defaults in ordinary partial object patches", () => {
		paragraphType.attributes.settings = {
			type: "object",
			properties: {
				typography: {
					type: "object",
					properties: {
						fontSize: { type: "string", default: "16px" },
						fontWeight: { type: "string", default: "400" },
					},
				},
			},
		};
		const current = {
			settings: {
				typography: {
					fontSize: "24px",
					fontWeight: "400",
				},
			},
		};
		const patch = normalizeAttributes("core/paragraph", {
			settings: { typography: { fontWeight: "700" } },
		});

		expect(patch).toEqual({
			settings: { typography: { fontWeight: "700" } },
		});
		expect(deepMergeAttributes(current, patch)).toEqual({
			settings: {
				typography: {
					fontSize: "24px",
					fontWeight: "700",
				},
			},
		});
	});

	it("deep merges objects, treats arrays atomically, and removes null keys", () => {
		expect(
			deepMergeAttributes(
				{
					content: "Old",
					style: {
						color: { text: "#111", background: "#fff" },
						spacing: { margin: ["1px", "2px"] },
					},
				},
				{
					style: {
						color: { text: "#222", background: null },
						spacing: { margin: ["3px"] },
					},
				}
			)
		).toEqual({
			content: "Old",
			style: {
				color: { text: "#222", background: undefined },
				spacing: { margin: ["3px"] },
			},
		});
	});

	it("cleans conflicting preset and custom color values", () => {
		expect(
			deepMergeAttributes(
				{
					textColor: "primary",
					backgroundColor: "secondary",
					gradient: "sunset",
					style: {
						color: {
							text: "#111",
							background: "#222",
							gradient: "linear-gradient(#111,#222)",
						},
					},
				},
				{
					textColor: "accent",
					style: { color: { background: "#333", gradient: "none" } },
				}
			)
		).toEqual({
			textColor: "accent",
			backgroundColor: undefined,
			gradient: undefined,
			style: { color: { background: "#333", gradient: "none" } },
		});
	});

	it("moves CSS color literals from preset attributes into custom styles", () => {
		const patch = normalizeColorAttributeValues(
			normalizeAttributes("core/paragraph", {
				backgroundColor: "pink",
				textColor: "#112233",
			})
		);

		expect(patch).toEqual({
			style: { color: { background: "pink", text: "#112233" } },
		});
	});

	it("keeps registered palette slugs in preset attributes", () => {
		window.wp.data.select.mockImplementation((store) =>
			store === "core/block-editor"
				? { getSettings: jest.fn(() => ({ colors: [{ slug: "pink", color: "#ffc0cb" }] })) }
				: {
						getBlockType: jest.fn((name) => (name === "core/paragraph" ? paragraphType : null)),
					}
		);

		expect(normalizeColorAttributeValues({ backgroundColor: "pink" })).toEqual({
			backgroundColor: "pink",
		});
	});

	it("preserves values when a normalized patch is unchanged", () => {
		const current = { content: "Same", style: { typography: { fontSize: "16px" } } };
		const patch = normalizeAttributes("core/paragraph", {
			content: "Same",
			style: { typography: { fontSize: "16px" } },
		});
		expect(deepMergeAttributes(current, patch)).toEqual(current);
	});
});
