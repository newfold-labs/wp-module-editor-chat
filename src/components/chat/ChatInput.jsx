/**
 * WordPress dependencies
 */
import { Button } from "@wordpress/components";
import { useDispatch } from "@wordpress/data";
import { useEffect, useRef, useState } from "@wordpress/element";
import { __ } from "@wordpress/i18n";

/**
 * External dependencies
 */
import { ArrowUp, CircleStop, FileText, Plus, X } from "lucide-react";
import { uploadFile } from "../../services/fileUpload";

/**
 * Internal dependencies
 */
import { buildMessageWithAttachments } from "../../hooks/chat/conversationUtils";
import useSelectedBlock from "../../hooks/useSelectedBlock";
import ContextTag from "../ui/ContextTag";
import { validateFiles } from "../../utils/editorUtils";

/**
 * The default accepted file types.
 * @type {Object}
 */
const DEFAULT_ACCPETED_FILE_TYPES = {
	images : [ "image/png", "image/jpeg", "image/gif", "image/webp" ],
	documents : [ "application/pdf", "text/plain", "text/markdown", "text/csv"],
}

const getFileTypeLabel = (mimeType) => {
	const labels = {
		"application/pdf": __("PDF Document", "wp-module-editor-chat"),
		"text/plain": __("Text Document", "wp-module-editor-chat"),
		"text/csv": __("CSV Spreadsheet", "wp-module-editor-chat"),
		"text/markdown": __("Markdown Document", "wp-module-editor-chat"),
		"image/png": __("PNG Image", "wp-module-editor-chat"),
		"image/jpeg": __("JPEG Image", "wp-module-editor-chat"),
		"image/webp": __("WebP Image", "wp-module-editor-chat"),
		"image/gif": __("GIF Image", "wp-module-editor-chat"),
	};
	return labels[mimeType] || mimeType;
};

/**
 * ChatInput Component
 *
 * @param {Object}   props               - The component props.
 * @param {Function} props.onSendMessage - The function to call when the message is sent.
 * @param {Function} props.onStopRequest - The function to call when the stop button is clicked.
 * @param {boolean}  props.disabled      - Whether the input is disabled.
 * @param {number}   props.maxFiles      - The maximum number of files that can be selected.
 * @param {Object}   props.acceptedTypes - The accepted file types.
 * @return {Element} The ChatInput component.
 */
const ChatInput = ({ onSendMessage, onStopRequest, disabled = false, maxFiles = 3, acceptedTypes = DEFAULT_ACCPETED_FILE_TYPES }) => {
	const [message, setMessage] = useState("");
	const [attachments, setAttachments] = useState([]);
	const [isDragging, setIsDragging] = useState(false);
	const textareaRef = useRef(null);
	const fileInputRef = useRef(null);
	const selectedBlocks = useSelectedBlock();
	const { clearSelectedBlock, selectBlock, multiSelect } = useDispatch("core/block-editor");

	const isUploading = attachments.some((att) => att.status === "uploading");
	const canSend = (Boolean(message.trim()) || attachments.length > 0) && !isUploading;

	// Auto-resize textarea as user types
	useEffect(() => {
		if (textareaRef.current) {
			textareaRef.current.style.height = "auto";
			const newHeight = Math.min(textareaRef.current.scrollHeight, 200);
			textareaRef.current.style.height = `${newHeight}px`;
		}
	}, [message]);

	// Focus textarea when it becomes enabled again (after AI response)
	useEffect(() => {
		if (!disabled && textareaRef.current) {
			setTimeout(() => {
				textareaRef.current.focus();
			}, 100);
		}
	}, [disabled]);

	// Revoke any object URLs we created when the component unmounts,
	// so previewed images don't leak memory. A ref always holds the latest
	// list so the cleanup (which runs once) sees the current attachments.
	const attachmentsRef = useRef(attachments);
	attachmentsRef.current = attachments;
	useEffect(() => {
		return () => {
			attachmentsRef.current.forEach((att) => {
				if (att.previewUrl) {
					URL.revokeObjectURL(att.previewUrl);
				}
			});
		};
	}, []);

	const handleAttachClick = () => {
		fileInputRef.current?.click();
	};

	const handleFilesSelected = async (files) => {
		const { valid, rejected } = validateFiles(files, acceptedTypes, maxFiles - attachments.length);

		if (rejected.length > 0) {
			const reasons = rejected.map(({ file, reason }) => {
				if (reason === "type") return `${file.name}: ${__("unsupported file type", "wp-module-editor-chat")}`;
				if (reason === "size") return `${file.name}: ${__("file too large", "wp-module-editor-chat")}`;
				if (reason === "limit") return `${file.name}: ${__("attachment limit reached", "wp-module-editor-chat")}`;
				return file.name;
			});
			// eslint-disable-next-line no-console
			console.warn("[ChatInput] Files rejected:", reasons);
		}
	
		if (valid.length === 0) return;
	
		// Add chips immediately in "uploading" state
		const pending = valid.map((file) => ({
			id: crypto.randomUUID(),
			file,
			name: file.name,
			type: file.type,
			size: file.size,
			previewUrl: file.type.startsWith("image/") ? URL.createObjectURL(file) : null,
			url: null,
			filename: null,
			status: "uploading",
		}));
	
		setAttachments((prev) => [...prev, ...pending]);
	
		if (fileInputRef.current) {
			fileInputRef.current.value = "";
		}
	
		// Upload each file and update its chip with the server URL
		for (const item of pending) {
			try {
				const result = await uploadFile(item.file);
				setAttachments((prev) =>
					prev.map((att) =>
						att.id === item.id
							? { ...att, url: result.url, filename: result.filename, status: "ready" }
							: att
					)
				);
			} catch {
				setAttachments((prev) =>
					prev.map((att) =>
						att.id === item.id ? { ...att, status: "error" } : att
					)
				);
			}
		}
	};

	const handleSubmit = () => {
		if (canSend && !disabled) {
			const enrichedMessage = buildMessageWithAttachments(message, attachments);
			onSendMessage(enrichedMessage, message);
			setMessage("");
			setAttachments([]);
			// Reset textarea height and maintain focus
			if (textareaRef.current) {
				textareaRef.current.style.height = "auto";
				textareaRef.current.focus();
			}
		}
	};

	const handleKeyDown = (e) => {
		if (e.key === "Enter" && !e.shiftKey) {
			e.preventDefault();
			handleSubmit();
		}
	};

	const removeAttachment = (id) => {
		setAttachments((prev) => {
			const target = prev.find((att) => att.id === id);
			if (target?.previewUrl) {
				URL.revokeObjectURL(target.previewUrl);
			}
			return prev.filter((att) => att.id !== id);
		});
	}

	// Only react to drags that actually carry files (ignore block/text drags).
	const isFileDrag = (e) => Array.from(e.dataTransfer?.types || []).includes("Files");

	const handleDragOver = (e) => {
		if (!isFileDrag(e) || disabled) {
			return;
		}
		e.preventDefault();
		setIsDragging(true);
	};

	const handleDragLeave = (e) => {
		if (!e.currentTarget.contains(e.relatedTarget)) {
			setIsDragging(false);
		}
	};

	const handleDrop = (e) => {
		if (!isFileDrag(e) || disabled) {
			return;
		}
		e.preventDefault();
		setIsDragging(false);
		handleFilesSelected(Array.from(e.dataTransfer.files));
	};

	return (
		<div 			
		className={`nfd-editor-chat-input${isDragging ? " nfd-editor-chat-input--dragging" : ""}`}
		onDragOver={handleDragOver}
		onDragLeave={handleDragLeave}
		onDrop={handleDrop}
		>
			<div className="nfd-editor-chat-input__container">
				{attachments.length > 0 && (
				<div className="nfd-editor-chat-input__top">
				{attachments.map((att) => {
					const ext = att.name.split(".").pop().toLowerCase();
					return (
						<div key={att.id} className="nfd-editor-chat-attachment-wrapper">
							<div className="nfd-editor-chat-attachment-tooltip">
								<span className="nfd-editor-chat-attachment-tooltip__name">{att.name}</span>
								<span className="nfd-editor-chat-attachment-tooltip__type">
									{getFileTypeLabel(att.type)}
								</span>
							</div>
							<div className={`nfd-editor-chat-attachment nfd-editor-chat-attachment--${att.status}`}>
								{att.type.startsWith("image/") ? (
									<div
										className="nfd-editor-chat-attachment__thumb"
										style={{ backgroundImage: `url(${att.previewUrl})` }}
										role="img"
										aria-label={att.name}
									/>
								) : (
									<span className="nfd-editor-chat-attachment__ext">{ext}</span>
								)}
								<button
									type="button"
									onClick={() => removeAttachment(att.id)}
									aria-label={__("Remove attachment", "wp-module-editor-chat")}
								>
									<X size={10} />
								</button>
							</div>
						</div>
					);
				})}
				</div>
				)}	
				<textarea
					name="nfd-editor-chat-input"
					ref={textareaRef}
					value={message}
					onChange={(e) => setMessage(e.target.value)}
					onKeyDown={handleKeyDown}
					placeholder={__("How can I help you today?", "wp-module-editor-chat")}
					className="nfd-editor-chat-input__textarea"
					rows={1}
					disabled={disabled}
				/>
				<div className="nfd-editor-chat-input__actions">
					<Button
						icon={<Plus width={16} height={16} />}
						label={__("Attach files", "wp-module-editor-chat")}
						onClick={handleAttachClick}
						className="nfd-editor-chat-input__attach"
						disabled={disabled || attachments.length >= maxFiles}
					/>
					{selectedBlocks.length > 0 &&
						selectedBlocks.map((block) => (
							<ContextTag
								key={block.clientId}
								block={block}
								onRemove={() => {
									const remaining = selectedBlocks.filter((b) => b.clientId !== block.clientId);
									if (remaining.length === 0) {
										clearSelectedBlock();
									} else if (remaining.length === 1) {
										selectBlock(remaining[0].clientId);
									} else {
										multiSelect(remaining[0].clientId, remaining[remaining.length - 1].clientId);
									}
								}}
							/>
						))}
					{disabled ? (
						<Button
							icon={<CircleStop width={16} height={16} />}
							label={__("Stop generating", "wp-module-editor-chat")}
							onClick={onStopRequest}
							className="nfd-editor-chat-input__stop"
						/>
					) : (
						<Button
							icon={<ArrowUp width={16} height={16} />}
							label={__("Send message", "wp-module-editor-chat")}
							onClick={handleSubmit}
							className="nfd-editor-chat-input__submit"
							disabled={!message.trim()}
						/>
					)}
					<input
						type="file"
						ref={fileInputRef}
						onChange={(e) => handleFilesSelected(Array.from(e.target.files))}
						accept={Object.values(acceptedTypes).flat().join(",")}
						multiple
						hidden
					/>
				</div>
			</div>
			<div className="nfd-editor-chat-input__disclaimer">
				{__("AI-generated content is not guaranteed for accuracy.", "wp-module-editor-chat")}
			</div>
		</div>
	);
};

export default ChatInput;
