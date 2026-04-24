/**
 * Block lexicon — maps user vocabulary to block match rules.
 *
 * Shared by every intent-based verb (duplicate, insert, delete, move, update-attrs).
 * Add a new entry here and ALL verbs gain support for that kind — no new tool needed.
 *
 * Match rules:
 * - `names`: block names to match (exact). A block matches if its name is in this list.
 * - `hasClassPattern`: optional — additional requirement that the block's className
 *   attribute matches the regex. Used to disambiguate semantic variants (e.g. "card"
 *   is a core/group with a card-ish class).
 *
 * A block matches a kind iff it passes BOTH `names` (if specified) and
 * `hasClassPattern` (if specified).
 */
export const BLOCK_LEXICON = {
	column: {
		names: ["core/column"],
	},
	button: {
		names: ["core/button"],
	},
	buttons: {
		names: ["core/buttons"],
	},
	image: {
		names: ["core/image"],
	},
	heading: {
		names: ["core/heading"],
	},
	paragraph: {
		names: ["core/paragraph"],
	},
	list: {
		names: ["core/list"],
	},
	"list-item": {
		names: ["core/list-item"],
	},
	"menu-item": {
		names: ["core/navigation-link", "core/navigation-submenu"],
	},
	card: {
		// "Card" is semantic, not a WP core name. Match a group/column with a
		// card-ish class. Keep this pattern generous — missed matches are worse
		// than slightly loose ones, since the resolver picks the closest match.
		names: ["core/group", "core/column"],
		hasClassPattern: /(?:^|\s)(?:is-style-card|wp-block-card|nfd-card|card)(?:\s|$)|(?:^|\s)[\w-]*card[\w-]*(?:\s|$)/i,
	},
	testimonial: {
		names: ["core/group", "core/column"],
		hasClassPattern: /testimonial/i,
	},
	"team-member": {
		names: ["core/group", "core/column"],
		hasClassPattern: /team[-_]?member|staff|person/i,
	},
	"pricing-tier": {
		names: ["core/group", "core/column"],
		hasClassPattern: /pricing|tier|plan/i,
	},
	"faq-item": {
		names: ["core/details", "core/group"],
		hasClassPattern: /faq/i,
	},
	section: {
		// Top-level section — usually a group/cover directly under post-content.
		names: ["core/group", "core/cover"],
	},
	row: {
		names: ["core/columns", "core/row"],
	},
};

/**
 * Normalize the user's word to a canonical kind.
 *
 * Handles simple aliases (singular/plural + common short forms) so lexicon
 * lookups stay forgiving. Returns null if no canonical kind matches.
 *
 * @param {string} word The raw kind value from the tool call.
 * @return {string|null} Canonical kind key present in BLOCK_LEXICON, or null.
 */
export function normalizeKind(word) {
	if (!word || typeof word !== "string") return null;
	const w = word.trim().toLowerCase();

	// Direct hit
	if (BLOCK_LEXICON[w]) return w;

	// Alias map — keep narrow; don't over-normalize or we'll mask real user intent.
	const aliases = {
		col: "column",
		cols: "column",
		columns: "column",
		btn: "button",
		cta: "button",
		img: "image",
		picture: "image",
		photo: "image",
		h1: "heading",
		h2: "heading",
		h3: "heading",
		h4: "heading",
		title: "heading",
		subtitle: "heading",
		text: "paragraph",
		p: "paragraph",
		"nav-item": "menu-item",
		link: "menu-item",
		cards: "card",
		testimonials: "testimonial",
		review: "testimonial",
		reviews: "testimonial",
		"team-members": "team-member",
		member: "team-member",
		staff: "team-member",
		plan: "pricing-tier",
		tier: "pricing-tier",
		price: "pricing-tier",
		faq: "faq-item",
		question: "faq-item",
		sections: "section",
		rows: "row",
	};
	if (aliases[w]) return aliases[w];

	// Strip trailing "s" (simple plural)
	if (w.endsWith("s") && BLOCK_LEXICON[w.slice(0, -1)]) {
		return w.slice(0, -1);
	}

	return null;
}

/**
 * Test whether a block matches the given kind entry.
 *
 * @param {Object} block     WordPress block (must have .name, .attributes).
 * @param {Object} lexEntry  A BLOCK_LEXICON entry: { names, hasClassPattern? }.
 * @return {boolean} True if block matches.
 */
export function blockMatchesKind(block, lexEntry) {
	if (!block || !lexEntry) return false;
	if (lexEntry.names && !lexEntry.names.includes(block.name)) return false;
	if (lexEntry.hasClassPattern) {
		const className = block.attributes?.className || "";
		if (!lexEntry.hasClassPattern.test(className)) return false;
	}
	return true;
}
