/**
 * Visual feedback for blocks being processed by the AI.
 *
 * Blocks render inside the editor-canvas <iframe> in the Site Editor,
 * so both the style injection and the DOM lookup must target that
 * document (falling back to the main document for non-iframed editors).
 *
 * Blocks → spinning gradient border
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
	if (doc.getElementById(STYLE_ID)) {
		return;
	}
	const style = doc.createElement("style");
	style.id = STYLE_ID;
	style.textContent = PROCESSING_CSS;
	(doc.head || doc.documentElement).appendChild(style);
}

function getBlockSnapshot(clientId) {
	const block = select("core/block-editor").getBlock(clientId);
	return JSON.stringify({
		attrs: block?.attributes ?? {},
		inner: (block?.innerBlocks ?? []).map((b) => ({
			id: b.clientId,
			attrs: b.attributes,
		})),
	});
}

const PROCESSING_TIMEOUT_MS = 90_000;

function watchUntilDone(clientId, onDone) {
	const initialSnapshot = getBlockSnapshot(clientId);
	let done = false;

	const finish = () => {
		if (done) {
			return;
		}
		done = true;
		clearTimeout(timer);
		unsubscribe();
		onDone();
	};

	// Safety timeout: clean up even if the AI never responds or errors out
	const timer = setTimeout(finish, PROCESSING_TIMEOUT_MS);

	const unsubscribe = subscribe(() => {
		const selectedId = select("core/block-editor").getSelectedBlockClientId();
		const currentSnapshot = getBlockSnapshot(clientId);

		if (selectedId !== clientId || currentSnapshot !== initialSnapshot) {
			finish();
		}
	});

	return finish;
}

/**
 * Spinning gradient border — for all non-image blocks.
 * Suppresses the native editor selection outline while active, then restores it.
 * Removed automatically when the block is deselected or its content changes.
 * @param {string} clientId
 */
export function startBlockProcessing(clientId) {
	if (!clientId) {
		return;
	}
	const doc = getEditorDocument();
	ensureStyle(doc);
	const node = doc.querySelector(`[data-block="${clientId}"]`);
	if (!node) {
		return;
	}

	const prevOutline = node.style.getPropertyValue("outline");
	const prevOutlinePriority = node.style.getPropertyPriority("outline");
	const prevBoxShadow = node.style.getPropertyValue("box-shadow");
	const prevBoxShadowPriority = node.style.getPropertyPriority("box-shadow");

	node.classList.add(PROCESSING_CLASS, "remove-outline");
	node.style.setProperty("outline", "transparent", "important");
	node.style.setProperty("box-shadow", "none", "important");

	watchUntilDone(clientId, () => {
		node.classList.remove(PROCESSING_CLASS, "remove-outline");
		node.style.setProperty("outline", prevOutline, prevOutlinePriority);
		node.style.setProperty("box-shadow", prevBoxShadow, prevBoxShadowPriority);
	});
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
 * @param {string} clientId
 */
export function startImageProcessing(clientId) {
	if (!clientId) {
		return;
	}
	const doc = getEditorDocument();
	ensureStyle(doc);
	const node = doc.querySelector(`[data-block="${clientId}"]`);
	if (!node) {
		return;
	}

	const img = node.querySelector("img");
	const oldSrc = img?.currentSrc || img?.src || null;
	if (!oldSrc) {
		return;
	}

	const win = doc.defaultView || window;
	const nodeRect = node.getBoundingClientRect();
	const imgRect = img.getBoundingClientRect();
	const imgStyle = win.getComputedStyle(img);

	// Remember where the block sits so we can find its replacement
	const store = select("core/block-editor");
	const rootClientId = store.getBlockRootClientId(clientId) || "";
	const blockIndex = store.getBlockIndex(clientId);

	// The block the overlay is currently shadowing. Updated when the block is
	// replaced (rewrite path) so repositioning keeps following the live node.
	let targetClientId = clientId;

	const FREEZE_ID = `nfd-freeze-${clientId}`;
	const removeFreeze = () => doc.getElementById(FREEZE_ID)?.remove();

	const applyFreeze = (blockClientId) => {
		removeFreeze();
		const freezeStyle = doc.createElement("style");
		freezeStyle.id = FREEZE_ID;
		freezeStyle.textContent = `
			[data-block="${blockClientId}"] {
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

	// Keep the overlay glued to the live image. Layout can shift after submit —
	// most notably the chat sidebar sliding open narrows the canvas and reflows
	// the image — so a position captured once would leave the ghost stranded
	// next to the real image (a visible "double"). Re-read the rect every frame
	// until cleanup. When the block is mid-replacement the node is briefly gone;
	// we just keep the last known position.
	let rafId = null;
	const reposition = () => {
		const liveNode = doc.querySelector(`[data-block="${targetClientId}"]`);
		const liveImg = liveNode?.querySelector("img");
		if (liveImg) {
			const rect = liveImg.getBoundingClientRect();
			if (rect.width && rect.height) {
				overlay.style.top = `${rect.top + win.scrollY}px`;
				overlay.style.left = `${rect.left + win.scrollX}px`;
				overlay.style.width = `${rect.width}px`;
				overlay.style.height = `${rect.height}px`;
			}
		}
		rafId = win.requestAnimationFrame(reposition);
	};
	rafId = win.requestAnimationFrame(reposition);

	const removeAll = () => {
		if (rafId !== null) {
			win.cancelAnimationFrame(rafId);
			rafId = null;
		}
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
	const whenImageReady = (blockClientId) => {
		let tries = 0;
		const tick = () => {
			const targetNode = doc.querySelector(`[data-block="${blockClientId}"]`);
			const newImg = targetNode?.querySelector("img");
			if (newImg) {
				if (newImg.complete && newImg.naturalWidth > 0) {
					fadeOut();
					return;
				}
				let done = false;
				const onLoad = () => {
					if (done) {
						return;
					}
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
				win.requestAnimationFrame(tick);
			} else {
				fadeOut();
			}
		};
		tick();
	};

	const initialAttributes = JSON.stringify(store.getBlock(clientId)?.attributes ?? {});
	let subscribed = true;

	// Safety timeout: remove the overlay even if the AI never responds or errors out
	const safetyTimer = setTimeout(() => {
		if (!subscribed) {
			return;
		}
		subscribed = false;
		unsubscribe();
		removeAll();
	}, PROCESSING_TIMEOUT_MS);

	const unsubscribe = subscribe(() => {
		const block = store.getBlock(clientId);

		if (!block) {
			// Block was REPLACED (rewrite path) — find the new block at the
			// same position; the overlay keeps covering the area meanwhile.
			subscribed = false;
			clearTimeout(safetyTimer);
			unsubscribe();
			const newClientId = store.getBlockOrder(rootClientId)[blockIndex];
			if (!newClientId) {
				removeAll();
				return;
			}
			targetClientId = newClientId;
			applyFreeze(newClientId);
			whenImageReady(newClientId);
			return;
		}

		const currentAttributes = JSON.stringify(block.attributes ?? {});
		if (currentAttributes !== initialAttributes) {
			// Same block, attributes updated in place
			subscribed = false;
			clearTimeout(safetyTimer);
			unsubscribe();
			whenImageReady(clientId);
			return;
		}

		const selectedId = store.getSelectedBlockClientId();
		if (selectedId !== clientId) {
			subscribed = false;
			clearTimeout(safetyTimer);
			unsubscribe();
			removeAll();
		}
	});
}

/** Remove all AI processing effects (safety cleanup). */
export function clearAllBlockProcessing() {
	const doc = getEditorDocument();
	doc.querySelectorAll(`.${PROCESSING_CLASS}`).forEach((node) => {
		node.classList.remove(PROCESSING_CLASS, "remove-outline");
		node.style.removeProperty("outline");
		node.style.removeProperty("box-shadow");
	});
	doc.querySelectorAll(`.${SHIMMER_CLASS}`).forEach((node) => node.classList.remove(SHIMMER_CLASS));
	doc.querySelectorAll(".nfd-ghost-overlay").forEach((n) => n.remove());
}
