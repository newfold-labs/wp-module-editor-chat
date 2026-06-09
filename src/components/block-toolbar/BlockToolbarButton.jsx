import { BlockControls } from "@wordpress/block-editor";
import { ToolbarButton, ToolbarGroup } from "@wordpress/components";
import { useSelect } from "@wordpress/data";
import { useRef, useState } from "@wordpress/element";
import { __ } from "@wordpress/i18n";

import BlockAIPopover from "./BlockAIPopover";
import { isSupportedBlock } from "../../services/blockAI";
import { ReactComponent as SparksIcon } from "../../svg/sparks.svg";

// clientId and name come from the editor.BlockEdit HOC (registerBlockToolbar.js).
const BlockToolbarButton = ({ clientId, name }) => {
	const [isOpen, setIsOpen] = useState(false);
	const buttonRef = useRef(null);

	// Re-read the live block object so we have fresh attributes/innerBlocks on apply.
	const block = useSelect(
		(select) => select("core/block-editor").getBlock(clientId),
		[clientId]
	);

	if (!block || !isSupportedBlock(name)) {
		return null;
	}

	return (
		<BlockControls group="other">
			<ToolbarGroup>
            <ToolbarButton
                ref={buttonRef}
                icon={<SparksIcon width={20} height={20} />}
                label={__("BLU AI", "wp-module-editor-chat")}
                isActive={isOpen}
                onClick={() => setIsOpen((v) => !v)}
            />
			</ToolbarGroup>
			{isOpen && (
				<BlockAIPopover
					block={block}
					anchorRef={buttonRef}
					onClose={() => setIsOpen(false)}
				/>
			)}
		</BlockControls>
	);
};

export default BlockToolbarButton;