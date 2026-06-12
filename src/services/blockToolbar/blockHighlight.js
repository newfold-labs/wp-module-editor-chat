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
 * Shimmer scan overlay — for image/logo blocks.
 * Removed automatically when the block is deselected or its attributes change.
 */
export function startImageProcessing(clientId) {
	if (!clientId) return;
	const doc = getEditorDocument();
	ensureStyle(doc);
	const node = doc.querySelector(`[data-block="${clientId}"]`);
	if (!node) return;
	node.classList.add(SHIMMER_CLASS);
	watchUntilDone(clientId, SHIMMER_CLASS);
}

/** Remove all AI processing effects (safety cleanup). */
export function clearAllBlockProcessing() {
	const doc = getEditorDocument();
	[PROCESSING_CLASS, SHIMMER_CLASS].forEach((cls) => {
		doc.querySelectorAll(`.${cls}`).forEach((node) => node.classList.remove(cls));
	});
}
