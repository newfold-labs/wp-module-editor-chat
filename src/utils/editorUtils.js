/**
 * Animation classes from the NFD design system that set opacity:0/transform
 * on the element until nfd-wb-animated-in is added.
 */
const NFD_ANIMATION_CLASSES = [
	"nfd-wb-fade-in-bottom",
	"nfd-wb-fade-in-bottom-short",
	"nfd-wb-fade-in-top-short",
	"nfd-wb-fade-in-left-short",
	"nfd-wb-fade-in-right-short",
	"nfd-wb-zoom-in",
	"nfd-wb-zoom-in-short",
	"nfd-wb-twist-in",
	"nfd-wb-reveal-right",
];

const NFD_ANIM_SELECTOR = NFD_ANIMATION_CLASSES.map(
	(c) => `.${c}:not(.nfd-wb-animated-in)`
).join(", ");

/**
 * After the AI edits blocks, elements with nfd-wb-* animation classes can
 * stay invisible (opacity:0) in the editor because the IntersectionObserver
 * that adds nfd-wb-animated-in hasn't fired yet.
 *
 * This function:
 * 1. Dispatches wonder-blocks/toolbar-button-added on the editor iframe so the
 *    patterns animation system re-scans for nfd-wb-animate elements.
 * 2. Directly adds nfd-wb-animated-in (with no transition) to any remaining
 *    invisible animated elements — covers cases where nfd-wb-animate is absent.
 */
export function restoreAnimatedBlocksInEditor() {
	// Site Editor renders inside an iframe; admin-bar scripts live in the parent.
	const iframe = document.querySelector( 'iframe[name="editor-canvas"]' );
	const doc = iframe?.contentDocument ?? document;

	// Trigger the existing wonder-blocks animation system inside the iframe.
	doc.dispatchEvent( new CustomEvent( "wonder-blocks/toolbar-button-added" ) );

	// Direct fallback: restore any element that is still invisible.
	requestAnimationFrame( () => {
		doc.querySelectorAll( NFD_ANIM_SELECTOR ).forEach( ( el ) => {
			el.style.transition = "none";
			el.classList.add( "nfd-wb-animated-in" );
			requestAnimationFrame( () => {
				el.style.transition = "";
			} );
		} );
	} );
}

/**
 * The maximum size of the files in bytes.
 * @type {Object}
 */
const MAX_SIZE = {
	image: 10 * 1024 * 1024,    // 2 MB
	document: 5 * 1024 * 1024,  // 5 MB
};

/**
 * Basic client-side validation: keep only files whose MIME type is allowed,
 * and never accept more than `maxNew` files. Real size checks + server-side
 * validation are added with the upload service (Phase B).
 *
 * @param {File[]} files         - Files chosen by the user.
 * @param {Object} acceptedTypes - The acceptedTypes config object.
 * @param {number} maxNew        - How many more files we can still accept.
 * @return {File[]} The subset of valid files.
 */
export const validateFiles = (files, acceptedTypes, maxNew) => {
	const allowed = Object.values(acceptedTypes).flat();
	const valid = [];
	const rejected = [];

	for (const file of files) {
		if (!allowed.includes(file.type)) {
			rejected.push({ file, reason: "type" });
			continue;
		}

		const isImage = file.type.startsWith("image/");
		const maxSize = isImage ? MAX_SIZE.image : MAX_SIZE.document;

		if (file.size > maxSize) {
			rejected.push({ file, reason: "size" });
			continue;
		}

		if (valid.length >= maxNew) {
			rejected.push({ file, reason: "limit" });
			continue;
		}

		valid.push(file);
	}

	return { valid, rejected };
};
