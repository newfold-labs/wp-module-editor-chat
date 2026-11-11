/**
 * Internal dependencies
 */
import { ReactComponent as AiAvatarIcon } from "../../svg/ai-avatar.svg";

/**
 * AILogo Component
 *
 * A reusable logo component for the AI assistant. Prefers a brand-provided
 * avatar URL at `window.nfdEditorChat.brand.icons.avatar` when present.
 *
 * @param {Object} props        - The component props.
 * @param {number} props.width  - The width of the logo (default: 24).
 * @param {number} props.height - The height of the logo (default: 24).
 * @return {Element} The AILogo component.
 */
const AILogo = ({ width = 24, height = 24 }) => {
	const brandAvatarUrl =
		typeof window !== "undefined"
			? window.nfdEditorChat?.brand?.icons?.avatar
			: undefined;

	return (
		<div
			className="nfd-editor-chat-ai-avatar"
			style={{
				width,
				height,
			}}
		>
			{brandAvatarUrl ? (
				<img
					src={brandAvatarUrl}
					alt=""
					width={width}
					height={height}
					decoding="async"
				/>
			) : (
				<AiAvatarIcon width={width} height={height} />
			)}
		</div>
	);
};

export default AILogo;
