/**
 * Internal dependencies
 */
import { ReactComponent as SparksIcon } from "../../svg/sparks.svg";

function BluehostIcon(props = {}) {
	return (
		<svg viewBox="0 0 19 19" fill="none" xmlns="http://www.w3.org/2000/svg" width="1em" {...props}>
			<path
				d="M0 0H5.1674V5.20484H0V0ZM6.66518 0H11.8326V5.20484H6.66518V0ZM13.3303 0H18.4978V5.20484H13.3303V0ZM0 6.74007H5.1674V11.9449H0V6.74007ZM6.66518 6.74007H11.8326V11.9449H6.66518V6.74007ZM13.3303 6.74007H18.4978V11.9449H13.3303V6.74007ZM0 13.4801H5.1674V18.6849H0V13.4801ZM6.66518 13.4801H11.8326V18.6849H6.66518V13.4801ZM13.3303 13.4801H18.4978V18.6849H13.3303V13.4801Z"
				fill="#196CDF"
			/>
		</svg>
	);
}

/**
 * AILogo Component
 *
 * A reusable logo component for the AI assistant with purple gradient background
 * and white sparks icon.
 *
 * @param {Object} props        - The component props.
 * @param {number} props.width  - The width of the logo (default: 24).
 * @param {number} props.height - The height of the logo (default: 24).
 * @return {Element} The AILogo component.
 */
const AILogo = ({ width = 24, height = 24 }) => (
	<div
		className="nfd-editor-chat-ai-logo"
		style={{
			width,
			height,
		}}
	>
		<BluehostIcon width={width} height={height} />
	</div>
);

export default AILogo;
