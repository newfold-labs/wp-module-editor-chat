/**
 * Validate Gutenberg block markup in entity create/update ability parameters
 * before forwarding to MCP (blu-add-page, blu-add-post, etc.).
 */
import { validateBlockMarkup } from "./blockValidator";

/** MCP abilities whose `content` field is Gutenberg block markup. */
export const ENTITY_CONTENT_ABILITIES = new Set([
	"blu-add-page",
	"blu-add-post",
	"blu-add-cpt",
	"blu-update-page",
	"blu-update-post",
	"blu-update-cpt",
]);

/**
 * @param {string} toolName Hyphen-form ability name.
 * @return {boolean} Whether the ability accepts Gutenberg block markup in `content`.
 */
export function abilityUsesBlockContent(toolName) {
	return ENTITY_CONTENT_ABILITIES.has(toolName);
}

/**
 * Resolve block markup from ability parameters (models use several aliases).
 *
 * @param {Object} args Ability parameters.
 * @return {string|undefined} Raw markup string if present.
 */
function resolveContentField(args) {
	return args.content || args.block_content || args.markup || args.html || args.block_markup;
}

/**
 * Validate and normalize block markup on entity create/update args.
 * Mutates `args.content` in place when validation succeeds.
 *
 * @param {string} toolName Hyphen-form ability name.
 * @param {Object} args     Ability parameters (mutated on success).
 * @return {{ ok: true } | { ok: false, error: string }} Validation outcome.
 */
export function validateEntityContentArgs(toolName, args) {
	if (!abilityUsesBlockContent(toolName)) {
		return { ok: true };
	}

	const raw = resolveContentField(args);
	if (!raw || typeof raw !== "string") {
		return { ok: true };
	}

	const content = raw.replace(/\\"/g, '"');
	const validation = validateBlockMarkup(content);
	if (!validation.valid) {
		return { ok: false, error: validation.error };
	}

	args.content = validation.correctedContent || content;
	return { ok: true };
}
