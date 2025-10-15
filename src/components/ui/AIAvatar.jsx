/**
 * Internal dependencies
 */
import { ReactComponent as SparksIcon } from "../../svg/sparks.svg";

/**
 * AIAvatar Component
 *
 * A reusable avatar component for the AI assistant with purple gradient background
 * and white sparks icon.
 *
 * @param {Object} props        - The component props.
 * @param {number} props.width  - The width of the avatar (default: 24).
 * @param {number} props.height - The height of the avatar (default: 24).
 * @return {JSX.Element} The AIAvatar component.
 */
const AIAvatar = ({ width = 24, height = 24 }) => (
	<div
		className="nfd-editor-chat-ai-avatar"
		style={{
			width,
			height,
		}}
	>
		<SparksIcon width={width * 0.625} height={height * 0.625} />
	</div>
);

export default AIAvatar;
