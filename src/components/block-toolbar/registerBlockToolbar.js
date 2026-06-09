import { createHigherOrderComponent } from "@wordpress/compose";
import { Fragment } from "@wordpress/element";
import { addFilter } from "@wordpress/hooks";

import { isSupportedBlock } from "../../services/blockAI";
import BlockToolbarButton from "./BlockToolbarButton";

const withBluAIToolbar = createHigherOrderComponent(
	(BlockEdit) => (props) => {
		// Only single-selected, allowlisted blocks get the button.
		// In multi-selection no individual block has isSelected=true → button hidden.
		const showButton = props.isSelected && isSupportedBlock(props.name);
		return (
			<Fragment>
				<BlockEdit {...props} />
				{showButton && (
					<BlockToolbarButton clientId={props.clientId} name={props.name} />
				)}
			</Fragment>
		);
	},
	"withBluAIToolbar"
);

addFilter("editor.BlockEdit", "nfd-editor-chat/blu-ai-toolbar", withBluAIToolbar);
