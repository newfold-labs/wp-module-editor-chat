const IMAGE_TARGETS = new Set(["core/image", "core/cover"]);

/**
 * Find every image-bearing block in a subtree.
 *
 * @param {Object|null} block Editor block.
 * @return {Object[]} Matching blocks.
 */
function collectImageTargets(block) {
	if (!block) {
		return [];
	}
	const own = IMAGE_TARGETS.has(block.name) ? [block] : [];
	return [
		...own,
		...(block.innerBlocks || []).flatMap((innerBlock) => collectImageTargets(innerBlock)),
	];
}

/**
 * Recover a simple image replacement when generated markup is malformed.
 * This is safe only when the target subtree contains exactly one image.
 *
 * @param {Object|null} block           Original target subtree.
 * @param {Object}      imageResolution Result from resolveMarkupImages().
 * @param {Object[]}    generatedImages Images cached during this turn.
 * @return {Object|null} update-block-attrs arguments, or null.
 */
export function getImageReplacementRecovery(block, imageResolution, generatedImages) {
	if (!imageResolution?.generated || !generatedImages?.length) {
		return null;
	}

	const targets = collectImageTargets(block);
	if (targets.length !== 1 || !targets[0].clientId) {
		return null;
	}

	const image = generatedImages[generatedImages.length - 1];
	return {
		client_id: targets[0].clientId,
		attributes: {
			url: image.url,
			...(image.alt ? { alt: image.alt } : {}),
		},
	};
}
