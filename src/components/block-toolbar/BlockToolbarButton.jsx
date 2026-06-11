import { BlockControls } from "@wordpress/block-editor";
import { ToolbarButton, ToolbarGroup } from "@wordpress/components";
import { useSelect } from "@wordpress/data";
import { useRef, useState } from "@wordpress/element";
import { __ } from "@wordpress/i18n";

import BlockAIPopover from "./BlockAIPopover";
import { isSupportedBlock } from "../../services/blockAI";
import { Sparkles } from "lucide-react";

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
			<ToolbarGroup className="nfd-block-ai-toolbar-group">
            <ToolbarButton
                ref={buttonRef}
				className="nfd-block-ai-toolbar-button"
                icon={<Sparkles size={28} />}
                label={__("Blu AI", "wp-module-editor-chat")}
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