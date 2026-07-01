/**
 * Navigation helpers for editor content (pages in Site Editor, posts/CPT in post editor).
 */
import { addQueryArgs } from "@wordpress/url";

/** MCP abilities that create new content. */
export const CREATE_ABILITIES = new Set([
	"blu-add-page",
	"blu-add-post",
	"blu-add-cpt",
	"blu-wc-add-product",
]);

/**
 * Map a create ability name to a WordPress post type slug.
 *
 * @param {string} abilityName Hyphen-form ability name (e.g. blu-add-page).
 * @return {string|null} Post type slug or null for blu-add-cpt (from response).
 */
export function getPostTypeFromAbility(abilityName) {
	switch (abilityName) {
		case "blu-add-page":
			return "page";
		case "blu-add-post":
			return "post";
		case "blu-wc-add-product":
			return "product";
		default:
			return null;
	}
}

/**
 * Build the URL to edit a piece of content.
 *
 * @param {string} postType WordPress post type slug.
 * @param {number} id       Post ID.
 * @return {string} Relative admin URL.
 */
export function getEditUrl(postType, id) {
	if (postType === "page") {
		const base = window.__experimentalExtensibleSiteEditor
			? "admin.php?page=site-editor-v2"
			: "site-editor.php";

		return addQueryArgs(base, {
			p: `/page/${id}`,
			canvas: "edit",
			referrer: "nfd-editor-chat",
		});
	}

	return addQueryArgs("post.php", {
		post: id,
		action: "edit",
	});
}

/**
 * Navigate to a page inside the Site Editor without a full reload.
 *
 * @param {number} pageId Page post ID.
 */
export function loadPage(pageId) {
	const url = getEditUrl("page", pageId);
	window.history.pushState({}, "", url);
	window.dispatchEvent(new PopStateEvent("popstate"));
}

/**
 * Open a page in the Site Editor in a new tab.
 *
 * @param {number} pageId Page post ID.
 */
export function openPageInNewTab(pageId) {
	window.open(getEditUrl("page", pageId), "_blank", "noopener,noreferrer");
}

/**
 * Parse a standardized MCP REST response for a newly created entity.
 *
 * @param {string} toolResultText JSON text from the MCP tool result.
 * @return {{ id: number, postType: string|null, title: string }|null}
 */
export function parseCreatedEntity(toolResultText) {
	if (!toolResultText) {
		return null;
	}
	try {
		const parsed = JSON.parse(toolResultText);
		const message = parsed?.message ?? parsed;
		if (!message || typeof message !== "object") {
			return null;
		}
		const id = message.id;
		if (!id) {
			return null;
		}
		const postType = message.type || message.post_type || null;
		const title =
			(typeof message.title === "object" && message.title?.rendered) ||
			message.title ||
			message.name ||
			"";
		return { id, postType, title: String(title) };
	} catch {
		return null;
	}
}

/**
 * Handle post-create navigation and return metadata for the chat loop.
 *
 * @param {string}  toolName Ability name (hyphen form).
 * @param {Object}  result   Tool handler result.
 * @param {Object}  ctx      Tool execution context.
 * @return {Promise<Object|null>} Creation outcome metadata.
 */
export async function handleContentCreation(toolName, result, ctx) {
	if (!CREATE_ABILITIES.has(toolName) || result?.isError) {
		return null;
	}

	const text = result?.result?.[0]?.text;
	const entity = parseCreatedEntity(text);
	if (!entity) {
		return null;
	}

	const postType = entity.postType || getPostTypeFromAbility(toolName) || "post";
	const editUrl = getEditUrl(postType, entity.id);

	let navigated = false;
	let cancelled = false;

	if (postType === "page" && typeof ctx.requestNavigateToPage === "function") {
		const nav = await ctx.requestNavigateToPage(entity.id);
		navigated = nav.navigated === true;
		cancelled = nav.cancelled === true;
	}

	return {
		id: entity.id,
		postType,
		title: entity.title,
		editUrl,
		navigated,
		cancelled,
	};
}

/**
 * Append an edit link to the assistant display message when navigation did not occur.
 *
 * @param {string} displayMessage Assistant message text shown to the user.
 * @param {Object} outcome         Creation outcome from handleContentCreation.
 * @return {string} Message with link appended when appropriate.
 */
export function appendCreationLinkIfNeeded(displayMessage, outcome) {
	if (!outcome?.editUrl) {
		return displayMessage;
	}
	const needsLink =
		outcome.cancelled ||
		outcome.postType !== "page" ||
		(outcome.postType === "page" && !outcome.navigated);
	if (!needsLink) {
		return displayMessage;
	}
	if (displayMessage && displayMessage.includes(outcome.editUrl)) {
		return displayMessage;
	}
	const label = outcome.title || "Open draft";
	const link = `[${label}](${outcome.editUrl})`;
	if (!displayMessage || !displayMessage.trim()) {
		return link;
	}
	return `${displayMessage}\n\n${link}`;
}
