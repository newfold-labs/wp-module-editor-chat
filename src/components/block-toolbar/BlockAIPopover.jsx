import { Popover, Button } from "@wordpress/components";
import { useRef, useState } from "@wordpress/element";
import { __ } from "@wordpress/i18n";
import { ArrowUp } from "lucide-react";

import { TEXT_BLOCKS, IMAGE_BLOCKS, LOGO_BLOCK } from "../../services/blockToolbar/blockAI";
import { sendToChat } from "../../services/blockToolbar/chatBridge";
import { startBlockProcessing, startImageProcessing } from "../../services/blockToolbar/blockHighlight";

const BlockAIPopover = ({ block, anchorRef, onClose }) => {
	const [instruction, setInstruction] = useState("");
	const textareaRef = useRef(null);

	const submit = () => {
		const value = instruction.trim();
		if (!value) return;

		if (TEXT_BLOCKS.has(block.name)) {
			startBlockProcessing(block.clientId);
		} else if (IMAGE_BLOCKS.has(block.name) || block.name === LOGO_BLOCK) {
			startImageProcessing(block.clientId);
		}

		sendToChat(value, block.clientId);
		onClose();
	};

	const onKeyDown = (e) => {
		if (e.key === "Enter" && !e.shiftKey) {
			e.preventDefault();
			submit();
		}
		if (e.key === "Escape") {
			onClose();
		}
	};

	return (
		<Popover
			anchor={anchorRef.current}
			placement="bottom-start"
			onClose={onClose}
			focusOnMount="firstElement"
			className="nfd-block-ai-popover"
		>
			<div className="nfd-block-ai-popover__inner">
				<div className="nfd-block-ai-popover__container">
					<textarea
						ref={textareaRef}
						className="nfd-block-ai-popover__textarea"
						value={instruction}
						onChange={(e) => setInstruction(e.target.value)}
						onKeyDown={onKeyDown}
						placeholder={__("Ask for quick changes", "wp-module-editor-chat")}
						rows={1}
					/>
					<Button
						className="nfd-block-ai-popover__submit"
						icon={<ArrowUp width={16} height={16} />}
						label={__("Apply", "wp-module-editor-chat")}
						onClick={submit}
						disabled={!instruction.trim()}
					/>
				</div>
			</div>
		</Popover>
	);
};

export default BlockAIPopover;
