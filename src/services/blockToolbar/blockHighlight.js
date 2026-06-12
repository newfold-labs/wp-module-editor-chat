/**
 * Visual feedback for blocks being processed by the AI.
 *
 * Blocks render inside the editor-canvas <iframe> in the Site Editor,
 * so both the style injection and the DOM lookup must target that
 * document (falling back to the main document for non-iframed editors).
 *
 * Text blocks → spinning gradient border
 * Image blocks → shimmer scan overlay
 */
import { subscribe, select } from "@wordpress/data";

const STYLE_ID = "nfd-block-ai-style";
const PROCESSING_CLASS = "nfd-block-ai-processing";
const SHIMMER_CLASS = "nfd-block-ai-shimmer";

const PROCESSING_CSS = `
@property --nfd-spin-angle {
	syntax: '<angle>';
	initial-value: 0deg;
	inherits: false;
}
@keyframes nfd-border-spin {
	to { --nfd-spin-angle: 360deg; }
}
@keyframes nfd-shimmer-scan {
	0%   { background-position: 200% center; }
	100% { background-position: -100% center; }
}
.${PROCESSING_CLASS} {
	position: relative;
}
.${PROCESSING_CLASS}::before {
	content: '';
	position: absolute;
	inset: -7px;
	padding: 2px;
	border-radius: 6px;
	background: conic-gradient(
		from var(--nfd-spin-angle),
		transparent 0%,
		#196cdf 30%,
		#4a9fe8 55%,
		transparent 70%
	);
	animation: nfd-border-spin 2s linear infinite;
	pointer-events: none;
	-webkit-mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0);
	-webkit-mask-composite: xor;
	mask-composite: exclude;
	z-index: 1;
}
.${SHIMMER_CLASS} {
	position: relative;
	overflow: hidden;
}
.${SHIMMER_CLASS}.is-selected,
.${SHIMMER_CLASS}.is-selected::before {
	outline: none !important;
	box-shadow: none !important;
}
.${SHIMMER_CLASS}::after {
	content: '';
	position: absolute;
	inset: 0;
	background: linear-gradient(
		105deg,
		transparent 30%,
		rgba(255, 255, 255, 0.45) 50%,
		transparent 70%
	);
	background-size: 300% 100%;
	animation: nfd-shimmer-scan 1.6s ease-in-out infinite;
	pointer-events: none;
	z-index: 10;
}
`;

function getEditorDocument() {
	const iframe =
		document.querySelector('iframe[name="editor-canvas"]') ||
		document.querySelector(".editor-canvas__iframe");
	return iframe?.contentDocument || document;
}

function ensureStyle(doc) {
	if (doc.getElementById(STYLE_ID)) return;
	const style = doc.createElement("style");
	style.id = STYLE_ID;
	style.textContent = PROCESSING_CSS;
	(doc.head || doc.documentElement).appendChild(style);
}

function watchUntilDone(clientId, cssClass) {
	const initialAttributes = JSON.stringify(
		select("core/block-editor").getBlock(clientId)?.attributes ?? {}
	);

	const unsubscribe = subscribe(() => {
		const selectedId = select("core/block-editor").getSelectedBlockClientId();
		const currentAttributes = JSON.stringify(
			select("core/block-editor").getBlock(clientId)?.attributes ?? {}
		);

		if (selectedId !== clientId || currentAttributes !== initialAttributes) {
			unsubscribe();
			const doc = getEditorDocument();
			doc.querySelector(`[data-block="${clientId}"]`)?.classList.remove(cssClass);
		}
	});
}

/**
 * Spinning gradient border — for text blocks.
 * Removed automatically when the block is deselected or its content changes.
 */
export function startBlockProcessing(clientId) {
	if (!clientId) return;
	const doc = getEditorDocument();
	ensureStyle(doc);
	const node = doc.querySelector(`[data-block="${clientId}"]`);
	if (!node) return;
	node.classList.add(PROCESSING_CLASS);
	watchUntilDone(clientId, PROCESSING_CLASS);
}

/**
 * Image/logo blocks: shimmer while processing, then fade old→new image.
 *
 * The AI rewrite path replaces the block entirely (replaceBlocks → NEW
 * clientId, old DOM node unmounted), so any ghost attached inside the block
 * dies with it — causing a visible flash of the old image at swap time.
 *
 * Instead, the ghost overlay is created UP FRONT (at prompt submit) and lives
 * in the iframe <body>, outside the React tree, absolutely positioned over
 * the image. It shows an identical copy of the current image (already decoded,
 * zero flash) and carries the shimmer. Whatever React unmounts/mounts beneath
 * it is invisible. When the new image finishes loading, the overlay fades out.
 *
 * Container dimensions are frozen via an injected <style> rule with
 * !important so the layout never collapses under the overlay.
 */
export function startImageProcessing(clientId) {
	if (!clientId) return;
	const doc = getEditorDocument();
	ensureStyle(doc);
	const node = doc.querySelector(`[data-block="${clientId}"]`);
	if (!node) return;

	const img = node.querySelector("img");
	const oldSrc = img?.currentSrc || img?.src || null;
	if (!oldSrc) return;

	const win = doc.defaultView || window;
	const nodeRect = node.getBoundingClientRect();
	const imgRect = img.getBoundingClientRect();
	const imgStyle = win.getComputedStyle(img);

	// Remember where the block sits so we can find its replacement
	const store = select("core/block-editor");
	const rootClientId = store.getBlockRootClientId(clientId) || "";
	const blockIndex = store.getBlockIndex(clientId);

	const FREEZE_ID = `nfd-freeze-${clientId}`;
	const removeFreeze = () => doc.getElementById(FREEZE_ID)?.remove();

	const applyFreeze = (targetClientId) => {
		removeFreeze();
		const freezeStyle = doc.createElement("style");
		freezeStyle.id = FREEZE_ID;
		freezeStyle.textContent = `
			[data-block="${targetClientId}"] {
				min-height: ${nodeRect.height}px !important;
			}
		`;
		(doc.head || doc.documentElement).appendChild(freezeStyle);
	};
	applyFreeze(clientId);

	// Body-level ghost overlay: identical copy of the current image, already
	// decoded, covering the real one for the whole processing window.
	const overlay = doc.createElement("div");
	overlay.className = `nfd-ghost-overlay ${SHIMMER_CLASS}`;
	overlay.style.cssText = `
		position: absolute;
		top: ${imgRect.top + win.scrollY}px;
		left: ${imgRect.left + win.scrollX}px;
		width: ${imgRect.width}px;
		height: ${imgRect.height}px;
		z-index: 30;
		pointer-events: none;
		overflow: hidden;
		border-radius: ${imgStyle.borderRadius};
		transition: opacity 0.6s ease;
	`;
	const ghostImg = doc.createElement("img");
	ghostImg.src = oldSrc;
	ghostImg.style.cssText = `
		width: 100%; height: 100%;
		object-fit: ${imgStyle.objectFit || "cover"};
		object-position: ${imgStyle.objectPosition || "center"};
		display: block;
	`;
	overlay.appendChild(ghostImg);
	doc.body.appendChild(overlay);

	const removeAll = () => {
		overlay.remove();
		removeFreeze();
	};

	// Fade the overlay out over the (loaded) new image, then clean up.
	const fadeOut = () => {
		overlay.classList.remove(SHIMMER_CLASS);
		overlay.style.opacity = "0";
		setTimeout(removeAll, 650);
	};

	// Wait for the (re)mounted node and its loaded image, then fade.
	const whenImageReady = (targetClientId) => {
		let tries = 0;
		const tick = () => {
			const targetNode = doc.querySelector(`[data-block="${targetClientId}"]`);
			const newImg = targetNode?.querySelector("img");
			if (newImg) {
				if (newImg.complete && newImg.naturalWidth > 0) {
					fadeOut();
					return;
				}
				let done = false;
				const onLoad = () => {
					if (done) return;
					done = true;
					newImg.removeEventListener("load", onLoad);
					newImg.removeEventListener("error", onLoad);
					fadeOut();
				};
				newImg.addEventListener("load", onLoad);
				newImg.addEventListener("error", onLoad);
				setTimeout(onLoad, 8000);
				return;
			}
			if (++tries < 60) {
				requestAnimationFrame(tick);
			} else {
				fadeOut();
			}
		};
		tick();
	};

	const initialAttributes = JSON.stringify(store.getBlock(clientId)?.attributes ?? {});

	const unsubscribe = subscribe(() => {
		const block = store.getBlock(clientId);

		if (!block) {
			// Block was REPLACED (rewrite path) — find the new block at the
			// same position; the overlay keeps covering the area meanwhile.
			unsubscribe();
			const newClientId = store.getBlockOrder(rootClientId)[blockIndex];
			if (!newClientId) {
				removeAll();
				return;
			}
			applyFreeze(newClientId);
			whenImageReady(newClientId);
			return;
		}

		const currentAttributes = JSON.stringify(block.attributes ?? {});
		if (currentAttributes !== initialAttributes) {
			// Same block, attributes updated in place
			unsubscribe();
			whenImageReady(clientId);
			return;
		}

		const selectedId = store.getSelectedBlockClientId();
		if (selectedId !== clientId) {
			unsubscribe();
			removeAll();
		}
	});
}

/** Remove all AI processing effects (safety cleanup). */
export function clearAllBlockProcessing() {
	const doc = getEditorDocument();
	[PROCESSING_CLASS, SHIMMER_CLASS].forEach((cls) => {
		doc.querySelectorAll(`.${cls}`).forEach((node) => node.classList.remove(cls));
	});
	doc.querySelectorAll(".nfd-ghost-overlay").forEach((n) => n.remove());
}
