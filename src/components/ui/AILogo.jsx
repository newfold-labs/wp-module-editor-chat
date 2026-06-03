/**
 * Internal dependencies
 */
import { ReactComponent as AiAvatarIcon } from "../../svg/ai-avatar.svg";

/**
 * AILogo Component
 *
 * A reusable logo component for the AI assistant.
 *
 * @param {Object} props        - The component props.
 * @param {number} props.width  - The width of the logo (default: 24).
 * @param {number} props.height - The height of the logo (default: 24).
 * @return {Element} The AILogo component.
 */
const AILogo = ({ width = 24, height = 24 }) => (
	<div
		className="nfd-editor-chat-ai-avatar"
		style={{
			width,
			height,
		}}
	>
		<AiAvatarIcon width={width} height={height} />
	</div>
);

export default AILogo;
