/**
 * Navigation Editor utilities.
 *
 * Logic for editing blocks inside WordPress navigation menus that use a
 * linked wp_navigation entity (core/navigation with a ref attribute).
 * Mirrors templatePartEditor.js for wp_template_part entities.
 */
import { dispatch, select, resolveSelect } from "@wordpress/data";
import { serialize, parse, createBlock } from "@wordpress/blocks";
import apiFetch from "@wordpress/api-fetch";

import { createBlockFromParsed } from "../utils/blockUtils";
import { deepMergeAttrs as deepMerge } from "../utils/deepMerge";
import { insertBlocksAtPath, replaceBlockAtPath } from "./templatePartEditor";

/** wp_navigation entity IDs mutated this session (for explicit save on Publish/Accept). */
const touchedNavigationEntityIds = new Set();

/**
 * Last markup written per wp_navigation entity this session.
 * Survives core-data sync races when insert + delete run back-to-back before save.
 *
 * @type {Map<string, string>}
 */
const sessionNavigationContentByEntityId = new Map();

/**
 * @param {string|number} entityId
 * @param {string} rawContent
 */
function cacheNavigationSessionContent(entityId, rawContent) {
	const key = normalizeNavigationEntityId(entityId);
	if (key && rawContent != null) {
		sessionNavigationContentByEntityId.set(key, rawContent);
	}
}

/**
 * @param {string|number} entityId
 * @return {string|undefined}
 */
function getCachedNavigationSessionContent(entityId) {
	const key = normalizeNavigationEntityId(entityId);
	return key ? sessionNavigationContentByEntityId.get(key) : undefined;
}

/**
 * @param {string|number} entityId
 */
export function markNavigationEntityTouched(entityId) {
	if (entityId != null && entityId !== "") {
		touchedNavigationEntityIds.add(entityId);
	}
}

/**
 * @return {Array<string|number>}
 */
export function getTouchedNavigationEntityIds() {
	return [...touchedNavigationEntityIds];
}

export function clearTouchedNavigationEntityIds() {
	touchedNavigationEntityIds.clear();
	sessionNavigationContentByEntityId.clear();
}

/**
 * Normalize wp_navigation entity IDs for consistent core-data lookups.
 *
 * @param {string|number|null|undefined} entityId
 * @return {string|null}
 */
function normalizeNavigationEntityId(entityId) {
	if (entityId == null || entityId === "") {
		return null;
	}
	return String(entityId);
}

/**
 * Extract raw block markup from a wp_navigation entity record.
 *
 * @param {Object|null|undefined} record
 * @return {string|null}
 */
function extractNavigationEntityContentRaw(record) {
	if (!record?.content) {
		return null;
	}
	if (typeof record.content === "string") {
		return record.content;
	}
	if (record.content.raw != null && record.content.raw !== "") {
		return record.content.raw;
	}
	if (record.content.rendered) {
		return record.content.rendered;
	}
	return null;
}

/**
 * Read edited navigation entity content, trying both string and numeric IDs.
 *
 * @param {Object} coreSelect core store selector.
 * @param {string|number} entityId
 * @return {string|null}
 */
function getEditedNavigationContentRaw(coreSelect, entityId) {
	const normalized = normalizeNavigationEntityId(entityId);
	if (!normalized) {
		return null;
	}

	const candidates = [normalized];
	const numeric = Number(normalized);
	if (!Number.isNaN(numeric) && String(numeric) !== normalized) {
		candidates.push(numeric);
	}

	for (const id of candidates) {
		const edited = coreSelect.getEditedEntityRecord?.("postType", "wp_navigation", id);
		const raw = extractNavigationEntityContentRaw(edited);
		if (raw != null) {
			return raw;
		}
	}

	return null;
}

/**
 * Normalize navigation-link attrs before persisting to wp_navigation.
 *
 * @param {Object} attrs
 * @return {Object}
 */
export function normalizeNavigationLinkAttrs(attrs) {
	const next = { ...attrs };

	if (next.id != null && next.id !== "") {
		const numericId = Number(next.id);
		if (!Number.isNaN(numericId)) {
			next.id = numericId;
		}
	}

	const isPostReference =
		next.id != null &&
		(next.type === "page" || next.type === "post" || next.kind === "post-type");

	if (isPostReference) {
		if ((next.type === "page" || next.type === "post") && !next.kind) {
			next.kind = "post-type";
		}
	} else if (next.url) {
		delete next.id;
		delete next.type;
		delete next.kind;
	} else if (next.url === "" || next.url == null) {
		delete next.url;
	}

	return next;
}

/**
 * Strip HTML tags from a post title string.
 *
 * @param {string} html
 * @return {string}
 */
function stripHtml(html) {
	if (typeof html !== "string") {
		return "";
	}
	return html.replace(/<[^>]*>/g, "").trim();
}

/**
 * @param {Object|null|undefined} rec core entity record.
 * @return {string}
 */
function pageTitleFromRecord(rec) {
	if (!rec?.title) {
		return "";
	}
	if (typeof rec.title === "string") {
		return stripHtml(rec.title);
	}
	return stripHtml(rec.title.rendered || rec.title.raw || "");
}

/**
 * @param {number} id
 * @param {string} postType
 * @return {Promise<string>}
 */
async function fetchPostTitleViaRest(id, postType = "page") {
	const endpoint = postType === "post" ? "posts" : "pages";
	try {
		const post = await apiFetch({
			path: `/wp/v2/${endpoint}/${Number(id)}?context=edit`,
		});
		return stripHtml(
			post?.title?.rendered ||
				post?.title?.raw ||
				(typeof post?.title === "string" ? post.title : "")
		);
	} catch {
		return "";
	}
}

/**
 * Ensure page/post navigation links always have a visible label before save.
 *
 * @param {Object} attrs
 * @return {Object}
 */
export function finalizeNavigationLinkLabel(attrs) {
	const next = { ...attrs };
	if (String(next.label || "").trim()) {
		return next;
	}
	if (next.id == null || next.id === "") {
		return next;
	}
	const type = next.type || "page";
	if (type === "page" || type === "post" || next.kind === "post-type") {
		next.label = type === "post" ? `Post ${next.id}` : `Page ${next.id}`;
	}
	return next;
}

/**
 * Merge a navigation-link patch and clear attrs that conflict with the new target.
 *
 * @param {Object} current Existing block attributes.
 * @param {Object} patch   Incoming attribute patch.
 * @return {Object}
 */
export function applyNavigationLinkAttrPatch(current, patch) {
	const withClears = { ...patch };
	if (
		patch.id != null &&
		(patch.type === "page" || patch.type === "post" || patch.kind === "post-type")
	) {
		if (!("url" in patch)) {
			withClears.url = null;
		}
	}
	return normalizeNavigationLinkAttrs(deepMerge(current, withClears));
}

/**
 * Build block markup for a new navigation-link (no stale url/id from duplicates).
 *
 * @param {Object} params
 * @param {string} params.label
 * @param {string} [params.type]
 * @param {number} params.id
 * @param {string} [params.kind]
 * @return {string}
 */
export function buildNavigationLinkMarkup({ label, type = "page", id, kind = "post-type", url }) {
	const attrs = normalizeNavigationLinkAttrs({ label, type, id, kind, url });
	return `<!-- wp:navigation-link ${JSON.stringify(attrs)} /-->`;
}

/**
 * @param {number|string} pageId
 * @param {string} [type]
 * @return {Promise<string>}
 */
export async function getPageTitleForNavigationLink(pageId, type = "page") {
	const postType = type === "post" ? "post" : "page";
	const numericId = Number(pageId);
	if (Number.isNaN(numericId)) {
		return "";
	}

	try {
		const coreResolve = resolveSelect("core");
		let rec = await coreResolve.getEntityRecord("postType", postType, numericId);
		if (!rec) {
			const list = await coreResolve.getEntityRecords("postType", postType, {
				include: [numericId],
			});
			rec = Array.isArray(list) ? list.find((r) => Number(r.id) === numericId) : null;
		}
		const title = pageTitleFromRecord(rec);
		if (title) {
			return title;
		}
	} catch {
		// Fall through to REST lookup.
	}

	return fetchPostTitleViaRest(numericId, postType);
}

/**
 * Whether an intended menu label matches the WordPress page/post title.
 *
 * @param {string} intendedLabel
 * @param {string} pageTitle
 * @return {boolean}
 */
export function navigationPageLabelsMatch(intendedLabel, pageTitle) {
	const normalize = (value) =>
		String(value || "")
			.trim()
			.toLowerCase()
			.replace(/\s+/g, " ");
	const intended = normalize(intendedLabel);
	if (!intended) {
		return true;
	}
	return intended === normalize(pageTitle);
}

/**
 * Reject navigation links whose label does not match the target page title.
 *
 * @param {Object} attrs navigation-link attributes with id + label.
 * @return {Promise<void>}
 */
export async function assertNavigationLinkPageMatch(attrs) {
	if (attrs?.id == null || attrs.id === "") {
		return;
	}
	const type = attrs.type || "page";
	if (type !== "page" && type !== "post") {
		return;
	}
	const intendedLabel = String(attrs.label || "").trim();
	if (!intendedLabel) {
		return;
	}
	const pageTitle = await getPageTitleForNavigationLink(attrs.id, type);
	if (!pageTitle) {
		return;
	}
	if (!navigationPageLabelsMatch(intendedLabel, pageTitle)) {
		throw new Error(
			`Cannot link menu item "${intendedLabel}" to page id ${attrs.id}: that page is titled "${pageTitle}". ` +
				`Call blu/pages-search for "${intendedLabel}" and use the id and title from the matching result only.`
		);
	}
}

/**
 * Resolve label/url for a page/post navigation-link from core data.
 *
 * @param {Object} attrs Partial navigation-link attributes.
 * @return {Promise<Object>}
 */
export async function resolvePageNavigationAttrs(attrs) {
	const next = { ...(attrs || {}) };
	if (next.id == null || next.id === "") {
		return normalizeNavigationLinkAttrs(next);
	}

	const type = next.type || "page";
	if (type !== "page" && type !== "post") {
		return normalizeNavigationLinkAttrs(finalizeNavigationLinkLabel(next));
	}

	const postType = type === "post" ? "post" : "page";
	const numericId = Number(next.id);
	const needsLabel = !String(next.label || "").trim();

	const pageTitle = await getPageTitleForNavigationLink(numericId, type);
	if (pageTitle && needsLabel) {
		next.label = pageTitle;
	}

	try {
		const coreResolve = resolveSelect("core");
		let rec = await coreResolve.getEntityRecord("postType", postType, numericId);
		if (!rec) {
			const list = await coreResolve.getEntityRecords("postType", postType, {
				include: [numericId],
			});
			rec = Array.isArray(list) ? list.find((r) => Number(r.id) === numericId) : null;
		}
		if (rec?.link && !next.url) {
			next.url = rec.link;
		}
		if (needsLabel && !next.label && rec) {
			const title = pageTitleFromRecord(rec);
			if (title) {
				next.label = title;
			}
		}
	} catch {
		// Fall through to REST lookup.
	}

	if (!String(next.label || "").trim() && pageTitle) {
		next.label = pageTitle;
	}

	if (!String(next.label || "").trim()) {
		const restTitle = await fetchPostTitleViaRest(numericId, postType);
		if (restTitle) {
			next.label = restTitle;
		}
	}

	return normalizeNavigationLinkAttrs(finalizeNavigationLinkLabel(next));
}

/**
 * Normalize parsed navigation-link blocks before entity insert.
 *
 * @param {Array} parsedBlocks
 * @return {Array}
 */
export function normalizeParsedNavigationLinks(parsedBlocks) {
	return (parsedBlocks || []).map((block) => {
		const name = block.name || block.blockName;
		if (name !== "core/navigation-link" && name !== "core/navigation-submenu") {
			return block;
		}
		const attrs = normalizeNavigationLinkAttrs(block.attributes || block.attrs || {});
		return { ...block, attributes: attrs, attrs };
	});
}

/**
 * Build parsed navigation-link blocks from normalized attrs (entity-safe insert).
 *
 * @param {Object} attrs navigation-link attributes.
 * @return {Array|null}
 */
export function buildParsedNavigationLinkFromAttrs(attrs) {
	if (!attrs || (attrs.id == null && !attrs.url)) {
		return null;
	}

	const finalized = finalizeNavigationLinkLabel(normalizeNavigationLinkAttrs(attrs));
	const markup = buildNavigationLinkMarkup({
		label: finalized.label,
		type: finalized.type || "page",
		id: finalized.id,
		kind: finalized.kind || "post-type",
		url: finalized.url,
	});

	return normalizeParsedNavigationLinks(parse(markup));
}

/**
 * Convert parsed menu blocks to editor block instances, preserving nav-link attrs.
 *
 * @param {Array} parsedBlocks Parsed block tree from the navigation entity.
 * @return {Array<Object>} Editor-ready block instances.
 */
export function createNavigationEditorBlocks(parsedBlocks) {
	return normalizeParsedNavigationLinks(parsedBlocks).map((block) => {
		const name = block.name || block.blockName;
		const attrs = normalizeNavigationLinkAttrs(block.attributes || block.attrs || {});

		if (name === "core/navigation-link") {
			return createBlock(name, finalizeNavigationLinkLabel(attrs), []);
		}

		if (name === "core/navigation-submenu") {
			const innerBlocks = createNavigationEditorBlocks(block.innerBlocks || []);
			return createBlock(name, attrs, innerBlocks);
		}

		return createBlockFromParsed(block);
	});
}

/**
 * Build wp_navigation entity markup from editor blocks without serialize().
 *
 * @param {Array<Object>} blocks Navigation menu inner blocks.
 * @return {string}
 */
export function serializeNavigationMenuBlocks(blocks) {
	return (blocks || [])
		.map((block) => {
			const name = block.name;

			if (name === "core/navigation-link") {
				const attrs = normalizeNavigationLinkAttrs({ ...(block.attributes || {}) });
				return `<!-- wp:navigation-link ${JSON.stringify(attrs)} /-->`;
			}

			if (name === "core/navigation-submenu") {
				const attrs = normalizeNavigationLinkAttrs({ ...(block.attributes || {}) });
				const inner = serializeNavigationMenuBlocks(block.innerBlocks || []);
				return `<!-- wp:navigation-submenu ${JSON.stringify(attrs)} -->\n${inner}\n<!-- /wp:navigation-submenu -->`;
			}

			return serialize(block);
		})
		.join("\n");
}

/**
 * Build wp_navigation entity markup from parsed blocks (source of truth for saves).
 *
 * @param {Array<Object>} parsedBlocks Parsed navigation menu blocks.
 * @return {string}
 */
export function serializeNavigationParsedBlocks(parsedBlocks) {
	return normalizeParsedNavigationLinks(parsedBlocks)
		.map((block) => {
			const name = block.name || block.blockName;

			if (name === "core/navigation-link") {
				const attrs = finalizeNavigationLinkLabel(
					normalizeNavigationLinkAttrs(block.attributes || block.attrs || {})
				);
				return `<!-- wp:navigation-link ${JSON.stringify(attrs)} /-->`;
			}

			if (name === "core/navigation-submenu") {
				const attrs = finalizeNavigationLinkLabel(
					normalizeNavigationLinkAttrs(block.attributes || block.attrs || {})
				);
				const inner = serializeNavigationParsedBlocks(block.innerBlocks || []);
				return `<!-- wp:navigation-submenu ${JSON.stringify(attrs)} -->\n${inner}\n<!-- /wp:navigation-submenu -->`;
			}

			return serialize(createBlockFromParsed(block));
		})
		.join("\n");
}

// ────────────────────────────────────────────────────────────────────
// Navigation identity & entity helpers
// ────────────────────────────────────────────────────────────────────

/**
 * Whether a block is a linked navigation menu (core/navigation with ref).
 *
 * @param {Object} block Block object.
 * @return {boolean}
 */
export const isRefNavigation = (block) => {
	return block?.name === "core/navigation" && Boolean(block.attributes?.ref);
};

/**
 * Get the wp_navigation entity record for a linked navigation block.
 *
 * @param {Object} navBlock core/navigation block with ref.
 * @return {Promise<Object|null>}
 */
export const getNavigationEntity = async (navBlock) => {
	if (!navBlock?.attributes?.ref) {
		return null;
	}

	const coreResolve = resolveSelect("core");
	return await coreResolve.getEntityRecord("postType", "wp_navigation", navBlock.attributes.ref);
};

/**
 * Resolve wp_navigation entity ID from a navigation block.
 *
 * @param {Object} navBlock core/navigation block.
 * @return {Promise<string|number|null>}
 */
const getNavigationEntityId = async (navBlock) => {
	if (navBlock?.attributes?.ref) {
		return navBlock.attributes.ref;
	}

	const entity = await getNavigationEntity(navBlock);
	return entity?.id || null;
};

/**
 * Fetch navigation menu content from the wp_navigation entity.
 *
 * @param {Object} navBlock    core/navigation block with ref.
 * @param {Object} coreResolve Optional core resolve selector.
 * @return {Promise<string>}
 */
const fetchNavigationContent = async (navBlock, coreResolve = null) => {
	const entityId = normalizeNavigationEntityId(navBlock?.attributes?.ref);
	if (!entityId) {
		return "";
	}

	const coreSelect = select("core");
	const editedRaw = getEditedNavigationContentRaw(coreSelect, entityId);
	if (editedRaw != null) {
		return editedRaw;
	}

	const resolve = coreResolve || resolveSelect("core");
	const numericId = Number(entityId);
	const rec =
		(await resolve.getEntityRecord("postType", "wp_navigation", entityId)) ||
		(!Number.isNaN(numeric)
			? await resolve.getEntityRecord("postType", "wp_navigation", numericId)
			: null);

	return extractNavigationEntityContentRaw(rec) || "";
};

/**
 * @param {Object} block Parsed or editor block.
 * @return {Object}
 */
function navigationLinkAttrsFromBlock(block) {
	return block?.attributes || block?.attrs || {};
}

/**
 * Whether parsed navigation links have enough data to be safe edit sources.
 *
 * @param {Array} parsedBlocks
 * @return {boolean}
 */
function parsedNavigationLinksLookValid(parsedBlocks) {
	for (const block of parsedBlocks || []) {
		const name = block.name || block.blockName;
		if (name === "core/navigation-submenu") {
			if (!parsedNavigationLinksLookValid(block.innerBlocks || [])) {
				return false;
			}
			continue;
		}
		if (name !== "core/navigation-link") {
			continue;
		}
		const attrs = navigationLinkAttrsFromBlock(block);
		const hasTarget = (attrs.id != null && attrs.id !== "") || Boolean(attrs.url);
		if (!hasTarget) {
			return false;
		}
	}
	return true;
}

/**
 * Fetch saved (server) navigation entity markup — ignores pending edits.
 *
 * @param {Object} navBlock
 * @return {Promise<string>}
 */
async function fetchSavedNavigationContent(navBlock) {
	const entityId = normalizeNavigationEntityId(navBlock?.attributes?.ref);
	if (!entityId) {
		return "";
	}

	const resolve = resolveSelect("core");
	const numericId = Number(entityId);
	const rec =
		(await resolve.getEntityRecord("postType", "wp_navigation", entityId)) ||
		(!Number.isNaN(numericId)
			? await resolve.getEntityRecord("postType", "wp_navigation", numericId)
			: null);

	return extractNavigationEntityContentRaw(rec) || "";
}

/**
 * Load parsed navigation menu blocks for entity edits (entity-first).
 *
 * @param {Object} navBlock core/navigation block with ref.
 * @return {Promise<Array>}
 */
export async function getNavigationParsedBlocksForEdit(navBlock) {
	const entityId = normalizeNavigationEntityId(navBlock?.attributes?.ref);
	const coreSelect = select("core");

	if (entityId) {
		const cachedRaw = getCachedNavigationSessionContent(entityId);
		if (cachedRaw != null) {
			const cachedParsed = normalizeParsedNavigationLinks(parse(cachedRaw));
			if (
				cachedParsed.length === 0 ||
				parsedNavigationLinksLookValid(cachedParsed)
			) {
				return cachedParsed;
			}
		}

		const editedRaw = getEditedNavigationContentRaw(coreSelect, entityId);
		if (editedRaw != null) {
			const editedParsed = normalizeParsedNavigationLinks(parse(editedRaw));
			if (
				editedParsed.length === 0 ||
				parsedNavigationLinksLookValid(editedParsed)
			) {
				return editedParsed;
			}
		}
	}

	const savedRaw = await fetchSavedNavigationContent(navBlock);
	return normalizeParsedNavigationLinks(parse(savedRaw || ""));
}

/**
 * Find a page link in the header navigation menu (editor-visible state first).
 *
 * @param {Object} navBlock
 * @param {number|string} pageId
 * @param {string|null} [intendedLabel] When set, labelMatches is false if the link label differs.
 * @return {Promise<{present: boolean, labelMatches: boolean, label: string}>}
 */
export async function findNavigationPageLinkInMenu(navBlock, pageId, intendedLabel = null) {
	await ensureNavigationInnerBlocksLoaded(navBlock);
	const blockEditor = select("core/block-editor");
	const inner = blockEditor.getBlocks(navBlock.clientId);
	const needle = Number(pageId);
	const wantLabel = intendedLabel?.trim().toLowerCase() || null;

	const checkAttrs = (attrs) => {
		if (Number(attrs.id) !== needle) {
			return null;
		}
		const label = (attrs.label || "").trim();
		const labelMatches = !wantLabel || label.toLowerCase() === wantLabel;
		return { present: true, labelMatches, label };
	};

	for (const link of inner) {
		if (link.name !== "core/navigation-link") {
			continue;
		}
		const hit = checkAttrs(link.attributes || {});
		if (hit) {
			return hit;
		}
	}

	const hasVisibleNavLinks = inner.some(
		(b) => b.name === "core/navigation-link" || b.name === "core/navigation-submenu"
	);
	if (hasVisibleNavLinks) {
		return { present: false, labelMatches: false, label: "" };
	}

	const parsed = await getNavigationParsedBlocksForEdit(navBlock);
	for (const block of parsed) {
		if ((block.name || block.blockName) !== "core/navigation-link") {
			continue;
		}
		const hit = checkAttrs(navigationLinkAttrsFromBlock(block));
		if (hit) {
			return hit;
		}
	}

	return { present: false, labelMatches: false, label: "" };
}

/**
 * Whether a page is already linked in a navigation menu entity.
 *
 * @param {Object} navBlock
 * @param {number|string} pageId
 * @param {string|null} [intendedLabel]
 * @return {Promise<boolean>}
 */
export async function navigationEntityHasPageLink(navBlock, pageId, intendedLabel = null) {
	const found = await findNavigationPageLinkInMenu(navBlock, pageId, intendedLabel);
	return found.present && found.labelMatches;
}

/**
 * Reload navigation inner blocks from the wp_navigation entity (never serialize()).
 *
 * @param {Object} navBlock core/navigation block with ref.
 * @param {Object} [options]
 * @param {boolean} [options.force=false] Replace inner blocks even when already loaded.
 * @return {Promise<Array>}
 */
export async function syncNavigationInnerBlocksFromEntity(navBlock, { force = false } = {}) {
	if (!isRefNavigation(navBlock)) {
		return select("core/block-editor").getBlocks(navBlock.clientId);
	}

	const entityId = normalizeNavigationEntityId(navBlock.attributes?.ref);
	if (entityId && force) {
		const coreDispatch = dispatch("core");
		const ids = [entityId];
		const numericId = Number(entityId);
		if (!Number.isNaN(numericId)) {
			ids.push(numericId);
		}
		for (const id of ids) {
			coreDispatch.invalidateResolution("getEntityRecord", [
				"postType",
				"wp_navigation",
				id,
			]);
		}
		await resolveSelect("core").getEntityRecord("postType", "wp_navigation", entityId);
		await new Promise((resolve) => requestAnimationFrame(resolve));
	}

	return ensureNavigationInnerBlocksLoaded(navBlock, { force: true });
}

/**
 * Persist parsed navigation blocks to the wp_navigation entity.
 *
 * @param {Object} navBlock       core/navigation block with ref.
 * @param {Array}  parsedBlocks Parsed menu blocks (post-modifyFn).
 * @return {Promise<Object>}
 */
async function updateNavigationContentFromParsed(navBlock, parsedBlocks) {
	try {
		const entityId = await getNavigationEntityId(navBlock);

		if (!entityId) {
			throw new Error("Could not resolve navigation entity ID");
		}

		const updatedContent = serializeNavigationParsedBlocks(parsedBlocks);
		cacheNavigationSessionContent(entityId, updatedContent);
		const coreDispatch = dispatch("core");
		const coreResolve = resolveSelect("core");

		const existing =
			select("core").getEditedEntityRecord?.("postType", "wp_navigation", entityId) ||
			(await coreResolve.getEntityRecord("postType", "wp_navigation", entityId));

		const contentPayload =
			existing?.content && typeof existing.content === "object" && !Array.isArray(existing.content)
				? { ...existing.content, raw: updatedContent }
				: updatedContent;

		await coreDispatch.editEntityRecord("postType", "wp_navigation", entityId, {
			content: contentPayload,
		});

		markNavigationEntityTouched(normalizeNavigationEntityId(entityId) || entityId);

		return {
			success: true,
			message: "Navigation menu updated successfully",
			entityId,
			content: updatedContent,
		};
	} catch (error) {
		// eslint-disable-next-line no-console
		console.error("Error updating navigation menu:", error);
		return {
			success: false,
			message: `Failed to update navigation menu: ${error.message}`,
			error,
		};
	}
}

/**
 * Persist navigation inner blocks to the wp_navigation entity (pending edit).
 *
 * @param {Object} navBlock           core/navigation block with ref.
 * @param {Array}  updatedInnerBlocks Serialized inner blocks.
 * @return {Promise<Object>}
 */
export const updateNavigationContent = async (navBlock, updatedInnerBlocks) => {
	try {
		const entityId = await getNavigationEntityId(navBlock);

		if (!entityId) {
			throw new Error("Could not resolve navigation entity ID");
		}

		const updatedContent = serializeNavigationMenuBlocks(updatedInnerBlocks);
		const coreDispatch = dispatch("core");
		const coreResolve = resolveSelect("core");

		// Prime the entity in core-data so edits register as dirty and save correctly.
		const existing =
			select("core").getEditedEntityRecord?.("postType", "wp_navigation", entityId) ||
			(await coreResolve.getEntityRecord("postType", "wp_navigation", entityId));

		const contentPayload =
			existing?.content && typeof existing.content === "object" && !Array.isArray(existing.content)
				? { ...existing.content, raw: updatedContent }
				: updatedContent;

		await coreDispatch.editEntityRecord("postType", "wp_navigation", entityId, {
			content: contentPayload,
		});

		markNavigationEntityTouched(normalizeNavigationEntityId(entityId) || entityId);

		return {
			success: true,
			message: "Navigation menu updated successfully",
			entityId,
		};
	} catch (error) {
		// eslint-disable-next-line no-console
		console.error("Error updating navigation menu:", error);
		return {
			success: false,
			message: `Failed to update navigation menu: ${error.message}`,
			error,
		};
	}
};

/**
 * Walk up the block tree and return the closest ancestor linked navigation block.
 *
 * @param {string} clientId Target block clientId.
 * @return {Object|null}
 */
export function findAncestorRefNavigation(clientId) {
	const { getBlockRootClientId, getBlock } = select("core/block-editor");
	let currentId = getBlockRootClientId(clientId);
	while (currentId) {
		const block = getBlock(currentId);
		if (block && isRefNavigation(block)) {
			return block;
		}
		currentId = getBlockRootClientId(currentId);
	}
	return null;
}

/**
 * Index path from a navigation block to a nested block inside it.
 *
 * @param {string} navigationClientId Navigation block clientId.
 * @param {string} targetClientId     Nested block clientId.
 * @return {Array<number>|null}
 */
export function getBlockPathInNavigation(navigationClientId, targetClientId) {
	const { getBlockRootClientId, getBlockIndex } = select("core/block-editor");
	const path = [];
	let currentId = targetClientId;

	while (currentId && currentId !== navigationClientId) {
		path.unshift(getBlockIndex(currentId));
		currentId = getBlockRootClientId(currentId);
	}

	return currentId === navigationClientId ? path : null;
}

/**
 * Modify a linked navigation menu entity and sync the editor.
 *
 * @param {Object}   navBlock  core/navigation block with ref.
 * @param {Function} modifyFn Takes parsed menu blocks, returns modified blocks.
 * @return {Promise<Object>}
 */
export async function modifyNavigationEntity(navBlock, modifyFn) {
	const parsedBlocks = await getNavigationParsedBlocksForEdit(navBlock);
	const modifiedBlocks = normalizeParsedNavigationLinks(modifyFn(parsedBlocks));

	const result = await updateNavigationContentFromParsed(navBlock, modifiedBlocks);

	if (!result.success) {
		throw new Error(result.message || "Failed to update navigation menu");
	}

	await syncNavigationInnerBlocksFromEntity(navBlock, { force: true });

	return result;
}

/**
 * Ensure linked navigation inner blocks are loaded in the block editor.
 *
 * Ref-based menus may render as self-closing until inner blocks are hydrated.
 *
 * @param {Object} navBlock core/navigation block with ref.
 * @return {Promise<Array>} Inner blocks now present in the editor.
 */
export async function ensureNavigationInnerBlocksLoaded(navBlock, options = {}) {
	const { force = false } = options;

	if (!isRefNavigation(navBlock)) {
		return select("core/block-editor").getBlocks(navBlock.clientId);
	}

	const blockEditor = select("core/block-editor");
	const inner = blockEditor.getBlocks(navBlock.clientId);
	const linksLookValid =
		inner.length === 0 ||
		getNavigationMenuLinks(navBlock).every((link) => {
			const attrs = link.attributes || {};
			return (attrs.id != null && attrs.id !== "") || Boolean(attrs.url);
		});

	if (!force && inner.length > 0 && linksLookValid) {
		return inner;
	}

	const parsed = await getNavigationParsedBlocksForEdit(navBlock);
	if (!parsed.length) {
		return inner;
	}

	const hydrated = createNavigationEditorBlocks(parsed);
	const { replaceInnerBlocks } = dispatch("core/block-editor");
	replaceInnerBlocks(navBlock.clientId, hydrated);
	return blockEditor.getBlocks(navBlock.clientId);
}

/**
 * Resolve a linked navigation block and ensure its menu items are editable.
 *
 * @param {string} clientId Any block inside a linked navigation menu.
 * @return {Promise<Object|null>} Ancestor navigation block with hydrated children.
 */
export async function resolveRefNavigationForEdit(clientId) {
	const ancestor = findAncestorRefNavigation(clientId);
	if (!ancestor) {
		return null;
	}
	await ensureNavigationInnerBlocksLoaded(ancestor);
	return ancestor;
}

/**
 * Find every linked navigation block in a block tree.
 *
 * @param {Array} blocks Block tree from the editor.
 * @return {Array<Object>} core/navigation blocks with a ref attribute.
 */
export function findRefNavigationBlocks(blocks) {
	const found = [];
	const walk = (blockList) => {
		for (const block of blockList || []) {
			if (isRefNavigation(block)) {
				found.push(block);
			}
			if (block.innerBlocks?.length) {
				walk(block.innerBlocks);
			}
		}
	};
	walk(blocks);
	return found;
}

/**
 * Walk the full editor tree and return the first linked header navigation block.
 *
 * @return {Object|null} core/navigation block with ref, if any.
 */
export function findHeaderRefNavigationBlock() {
	const blockEditor = select("core/block-editor");

	const findNavInTree = (parentClientId) => {
		const blocks = parentClientId ? blockEditor.getBlocks(parentClientId) : blockEditor.getBlocks();
		for (const block of blocks) {
			if (isRefNavigation(block)) {
				return block;
			}
			const nested = findNavInTree(block.clientId);
			if (nested) {
				return nested;
			}
		}
		return null;
	};

	const walk = (parentClientId) => {
		const blocks = parentClientId ? blockEditor.getBlocks(parentClientId) : blockEditor.getBlocks();
		for (const block of blocks) {
			if (block.name === "core/template-part") {
				const slug = block.attributes?.slug || "";
				const area = block.attributes?.area || block.attributes?.tagName || "";
				if (slug === "header" || area === "header") {
					const nav = findNavInTree(block.clientId);
					if (nav) {
						return nav;
					}
				}
			}
			const nested = walk(block.clientId);
			if (nested) {
				return nested;
			}
		}
		return null;
	};

	return walk(null) || findNavInTree(null);
}

/**
 * Load every linked navigation menu in the editor (for menu-item tool targeting).
 *
 * @return {Promise<Array<Object>>}
 */
export async function hydrateAllRefNavigationBlocks() {
	const blockEditor = select("core/block-editor");
	const found = [];
	const walk = (parentClientId) => {
		const blocks = parentClientId ? blockEditor.getBlocks(parentClientId) : blockEditor.getBlocks();
		for (const block of blocks) {
			if (isRefNavigation(block)) {
				found.push(block);
			}
			walk(block.clientId);
		}
	};
	walk(null);

	for (const nav of found) {
		await ensureNavigationInnerBlocksLoaded(nav);
	}

	return found;
}

/**
 * Resolve a navigation-link block, hydrating linked menus first when needed.
 *
 * @param {string} clientId
 * @return {Promise<Object|null>}
 */
export async function ensureMenuBlockAccessible(clientId) {
	const blockEditor = select("core/block-editor");
	let block = blockEditor.getBlock(clientId);
	if (block) {
		return block;
	}
	await hydrateAllRefNavigationBlocks();
	return blockEditor.getBlock(clientId);
}

/**
 * List navigation-link blocks inside a navigation container.
 *
 * @param {Object} navBlock core/navigation block.
 * @return {Array<Object>} Editor block objects.
 */
export function getNavigationMenuLinks(navBlock) {
	const blockEditor = select("core/block-editor");
	return blockEditor.getBlocks(navBlock.clientId).filter(
		(b) => b.name === "core/navigation-link" || b.name === "core/navigation-submenu"
	);
}

/**
 * Summarize menu items after a mutation (fresh clientIds for the model).
 *
 * @param {Object} navBlock core/navigation block.
 * @return {Array<{client_id: string, label: string}>}
 */
export function summarizeNavigationMenuItems(navBlock) {
	return getNavigationMenuLinks(navBlock).map((link) => ({
		client_id: link.clientId,
		label: link.attributes?.label || "",
		type: link.attributes?.type || null,
		page_id: link.attributes?.id ?? null,
	}));
}

/**
 * Summarize menu items from the navigation entity (reliable for tool results).
 *
 * @param {Object} navBlock core/navigation block with ref.
 * @return {Promise<Array<{label: string, page_id: number|null, type: string|null}>>}
 */
export async function summarizeNavigationMenuItemsFromEntity(navBlock) {
	const parsed = await getNavigationParsedBlocksForEdit(navBlock);
	return parsed
		.filter((block) => (block.name || block.blockName) === "core/navigation-link")
		.map((block) => {
			const attrs = navigationLinkAttrsFromBlock(block);
			return {
				label: attrs.label || "",
				type: attrs.type || null,
				page_id: attrs.id ?? null,
			};
		});
}

/**
 * Parse navigation-link attrs from block markup (for post-insert verification).
 *
 * @param {string} markup
 * @return {Object|null}
 */
export function parseNavigationLinkAttrsFromMarkup(markup) {
	if (!markup || !markup.includes("navigation-link")) {
		return null;
	}
	const match = markup.match(/wp:navigation-link\s+(\{[\s\S]*?\})\s*\/?-->/);
	if (!match) {
		return null;
	}
	try {
		return normalizeNavigationLinkAttrs(JSON.parse(match[1]));
	} catch {
		return null;
	}
}

/**
 * Remove navigation-link items matching a label.
 *
 * @param {string} label Menu item label (case-insensitive).
 * @param {Object} [options]
 * @param {boolean} [options.once=false] Stop after the first matching link removed.
 * @param {boolean} [options.headerOnly=false] Only touch the header linked-menu.
 * @return {Promise<{ removed: number, menu_items: Array }>}
 */
export async function deleteNavigationMenuItemsByLabel(label, options = {}) {
	const { once = false, headerOnly = false } = options;
	const needle = String(label || "").trim().toLowerCase();
	if (!needle) {
		return { removed: 0, menu_items: [] };
	}

	let removed = 0;
	let navBlocks = await hydrateAllRefNavigationBlocks();
	if (headerOnly) {
		const header = findHeaderRefNavigationBlock();
		navBlocks = header ? [header] : [];
	}
	const menuItems = [];

	for (const nav of navBlocks) {
		let removedFromNav = 0;
		await modifyNavigationEntity(nav, (blocks) => {
			const next = [];
			for (const block of blocks) {
				const name = block.name || block.blockName;
				if (name !== "core/navigation-link" && name !== "core/navigation-submenu") {
					next.push(block);
					continue;
				}
				const linkLabel = (block.attributes?.label || block.attrs?.label || "")
					.trim()
					.toLowerCase();
				if (linkLabel === needle && (!once || removed === 0)) {
					removedFromNav++;
					removed++;
					continue;
				}
				next.push(block);
			}
			return next;
		});
		menuItems.push(...(await summarizeNavigationMenuItemsFromEntity(nav)));
		if (once && removed > 0) {
			break;
		}
	}

	return { removed, menu_items: menuItems };
}

/**
 * Resolve a navigation-link by clientId and/or label (after hydrating menus).
 *
 * @param {Object} params
 * @param {string} [params.client_id]
 * @param {string} [params.label]
 * @return {Promise<{ client_id: string, navBlock: Object, block: Object }|null>}
 */
export async function resolveNavigationMenuLinkTarget({ client_id, label } = {}) {
	const navBlocks = await hydrateAllRefNavigationBlocks();
	const blockEditor = select("core/block-editor");

	if (client_id) {
		for (const nav of navBlocks) {
			const path = getBlockPathInNavigation(nav.clientId, client_id);
			if (!path) {
				continue;
			}
			const block = blockEditor.getBlock(client_id);
			if (block) {
				return { client_id, navBlock: nav, block };
			}
		}
	}

	if (label) {
		const needle = String(label).trim().toLowerCase();
		for (const nav of navBlocks) {
			for (const link of getNavigationMenuLinks(nav)) {
				const linkLabel = (link.attributes?.label || "").trim().toLowerCase();
				if (linkLabel === needle) {
					return { client_id: link.clientId, navBlock: nav, block: link };
				}
			}
		}
	}

	return null;
}

/**
 * Patch attributes on a navigation-link inside a linked menu (entity-first).
 *
 * @param {Object} navBlock       Ancestor core/navigation block.
 * @param {string} targetClientId navigation-link clientId.
 * @param {Object} mergedAttrs    Attributes to merge.
 * @return {Promise<Array<{client_id: string, label: string}>>} Updated menu summary.
 */
export async function updateNavigationLinkAttributes(navBlock, targetClientId, mergedAttrs) {
	const path = getBlockPathInNavigation(navBlock.clientId, targetClientId);
	if (!path) {
		throw new Error(`Could not compute path for block ${targetClientId} in navigation menu`);
	}

	await modifyNavigationEntity(navBlock, (blocks) => {
		const parsed = findBlockInParsedTree(blocks, path);
		if (!parsed) {
			return blocks;
		}
		const current = parsed.attributes || parsed.attrs || {};
		const next = normalizeNavigationLinkAttrs({ ...current, ...mergedAttrs });
		if (parsed.attributes) {
			parsed.attributes = next;
		} else {
			parsed.attrs = next;
		}
		if (parsed.attributes && parsed.attrs) {
			parsed.attrs = next;
		}
		return blocks;
	});

	return summarizeNavigationMenuItems(navBlock);
}

/**
 * Build human-readable menu item lines for AI context.
 *
 * @param {Object} navBlock    core/navigation block.
 * @param {Object} blockEditor core/block-editor selector.
 * @return {string[]} Context lines (may be empty).
 */
export function buildNavigationMenuContextLines(navBlock, blockEditor) {
	const inner = blockEditor.getBlocks(navBlock.clientId);
	const lines = [];

	if (inner.length > 0) {
		inner.forEach((link, index) => {
			if (
				link.name !== "core/navigation-link" &&
				link.name !== "core/navigation-submenu"
			) {
				return;
			}
			const label = link.attributes?.label || "(untitled)";
			const pageId = link.attributes?.id;
			const pageHint = pageId != null && pageId !== "" ? ` page:${pageId}` : "";
			lines.push(
				`  [${index}] "${label}"${pageHint} (id:${link.clientId}) — delete by label with blu-delete-block`
			);
		});
		return lines;
	}

	const coreStore = select("core");
	const entity = coreStore.getEntityRecord(
		"postType",
		"wp_navigation",
		navBlock.attributes.ref
	);
	const raw =
		entity?.content?.raw || entity?.content?.rendered || entity?.content || "";
	if (!raw) {
		lines.push(
			`  (linked menu — call blu-get-block-markup on navigation id:${navBlock.clientId} to load items)`
		);
		return lines;
	}

	const parsed = parse(raw);
	parsed.forEach((link, index) => {
		const name = link.name || link.blockName;
		if (name !== "core/navigation-link" && name !== "core/navigation-submenu") {
			return;
		}
		const label = link.attributes?.label || link.attrs?.label || "(untitled)";
		lines.push(`  [${index}] "${label}" (entity item — hydrate via navigation id:${navBlock.clientId})`);
	});

	return lines;
}

/**
 * Sync wp_navigation entity from the current editor inner blocks.
 *
 * Used after attribute updates that go through updateBlockAttributes.
 *
 * @param {Object} navBlock core/navigation block with ref.
 * @return {Promise<Object>}
 */
export async function syncNavigationEntityFromEditor(navBlock) {
	const blockEditor = select("core/block-editor");
	const innerBlocks = blockEditor.getBlocks(navBlock.clientId);
	const result = await updateNavigationContent(navBlock, innerBlocks);
	if (!result.success) {
		throw new Error(result.message || "Failed to sync navigation menu");
	}
	return result;
}

function cloneParsedBlock(block) {
	return JSON.parse(JSON.stringify(block));
}

/**
 * Find a block in a parsed tree by index path.
 *
 * @param {Array}         blocks Parsed block tree.
 * @param {Array<number>} path   Index path.
 * @return {Object|null}
 */
function findBlockInParsedTree(blocks, path) {
	if (!path || path.length === 0) {
		return null;
	}
	let current = blocks;
	let block = null;
	for (let i = 0; i < path.length; i++) {
		block = current[path[i]];
		if (!block) {
			return null;
		}
		if (i < path.length - 1) {
			current = block.innerBlocks || [];
		}
	}
	return block;
}

/**
 * Insert inner blocks into a linked navigation menu at the given path.
 *
 * @param {Object}        navBlock       Ancestor navigation block.
 * @param {Array<number>} parentPath     Path to parent container in menu (empty = root).
 * @param {Array}         parsedToInsert Parsed blocks to insert.
 * @param {number|null}   index          Insert index; null = append.
 * @return {Promise<void>}
 */
export async function insertBlocksInNavigation(navBlock, parentPath, parsedToInsert, index = null) {
	await modifyNavigationEntity(navBlock, (blocks) => {
		if (!parentPath || parentPath.length === 0) {
			const insertAt =
				typeof index === "number" && index >= 0 ? Math.min(index, blocks.length) : blocks.length;
			return [...blocks.slice(0, insertAt), ...parsedToInsert, ...blocks.slice(insertAt)];
		}

		const parentBlock = findBlockInParsedTree(blocks, parentPath);
		if (!parentBlock) {
			return blocks;
		}

		const inner = parentBlock.innerBlocks || [];
		const insertAt =
			typeof index === "number" && index >= 0 ? Math.min(index, inner.length) : inner.length;
		const updatedInner = [
			...inner.slice(0, insertAt),
			...parsedToInsert,
			...inner.slice(insertAt),
		];

		return replaceBlockAtPath(blocks, parentPath, [{ ...parentBlock, innerBlocks: updatedInner }]);
	});
}

/**
 * Duplicate a navigation-link inside a linked menu (entity-first).
 *
 * @param {Object} navBlock       Ancestor core/navigation block.
 * @param {string} targetClientId navigation-link to clone.
 * @return {Promise<{newClientId: string|null, menu_items: Array}>}
 */
export async function duplicateEditorBlockInNavigation(navBlock, targetClientId) {
	const path = getBlockPathInNavigation(navBlock.clientId, targetClientId);
	if (!path) {
		throw new Error(`Could not compute path for block ${targetClientId} in navigation menu`);
	}

	await modifyNavigationEntity(navBlock, (blocks) => {
		const source = findBlockInParsedTree(blocks, path);
		if (!source) {
			return blocks;
		}
		return insertBlocksAtPath(blocks, path, [cloneParsedBlock(source)]);
	});

	const insertIndex = path[path.length - 1] + 1;
	const siblings = getNavigationMenuLinks(navBlock);
	const newBlock = siblings[insertIndex] || siblings[siblings.length - 1];

	return {
		newClientId: newBlock?.clientId || null,
		menu_items: summarizeNavigationMenuItems(navBlock),
	};
}
