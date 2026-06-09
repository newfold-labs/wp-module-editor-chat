import {
	Popover,
	TextareaControl,
	Button,
	Spinner,
	__experimentalToggleGroupControl as ToggleGroupControl,
	__experimentalToggleGroupControlOption as ToggleGroupControlOption,
} from "@wordpress/components";
import { useState } from "@wordpress/element";
import { __ } from "@wordpress/i18n";

import { applyBlockAI, DUAL_BLOCK, IMAGE_BLOCKS, LOGO_BLOCK } from "../../services/blockAI";

const placeholderFor = (block, mode) => {
	if (block.name === LOGO_BLOCK) return __("e.g. a minimalist blue coffee-cup logo", "wp-module-editor-chat");
	if (IMAGE_BLOCKS.has(block.name) || mode === "image") return __("e.g. a vintage coffee photo", "wp-module-editor-chat");
	return __("e.g. make this more concise", "wp-module-editor-chat");
};

const BlockAIPopover = ({ block, anchorRef, onClose }) => {
	const [instruction, setInstruction] = useState("");
	const [mediaTextMode, setMediaTextMode] = useState("text");
	const [isApplying, setIsApplying] = useState(false);
	const [error, setError] = useState(null);

	const isDual = block.name === DUAL_BLOCK;

	const submit = async () => {
		const value = instruction.trim();
		if (!value || isApplying) return;
		setIsApplying(true);
		setError(null);
		try {
			await applyBlockAI({ block, instruction: value, mediaTextMode });
			onClose();
		} catch (err) {
			setError(err.message || __("Something went wrong.", "wp-module-editor-chat"));
		} finally {
			setIsApplying(false);
		}
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
				{isDual && (
					<ToggleGroupControl
						__nextHasNoMarginBottom
						isBlock
						value={mediaTextMode}
						onChange={setMediaTextMode}
						label={__("Edit", "wp-module-editor-chat")}
						hideLabelFromVision
					>
						<ToggleGroupControlOption value="text" label={__("Text", "wp-module-editor-chat")} />
						<ToggleGroupControlOption value="image" label={__("Image", "wp-module-editor-chat")} />
					</ToggleGroupControl>
				)}

				<TextareaControl
					__nextHasNoMarginBottom
					value={instruction}
					onChange={setInstruction}
					onKeyDown={onKeyDown}
					placeholder={placeholderFor(block, mediaTextMode)}
					rows={3}
					disabled={isApplying}
				/>

				{error && <p className="nfd-block-ai-popover__error">{error}</p>}

				<div className="nfd-block-ai-popover__actions">
					<Button variant="primary" onClick={submit} disabled={!instruction.trim() || isApplying}>
						{isApplying ? <Spinner /> : __("Apply", "wp-module-editor-chat")}
					</Button>
				</div>
			</div>
		</Popover>
	);
};

export default BlockAIPopover;