import { __ } from "@wordpress/i18n";
import { Button } from "@wordpress/components";
import { useState } from "@wordpress/element";

import Modal from "./Modal";
import { CopyClipboardIcon } from "../icons";

type ShareSiteModalProps = {
	open: boolean;
	onClose?: () => void;
};

const SITE_URL = (window as any)?.NewfoldRuntime?.siteUrl ?? window.location.origin;

export default function ShareSiteModal({ open, onClose }: ShareSiteModalProps) {

	const [copied, setCopied] = useState(false)

	const copySiteToClipboard = () => {
		const storage = document.createElement("textarea");
		storage.value = SITE_URL;
		document.body.appendChild(storage);
		storage.select();
		storage.setSelectionRange(0, 99999);
		document.execCommand("copy");
		storage.remove();

		setCopied(true)
		setTimeout(() => setCopied(false), 2000);
	};

	return (
		<Modal
			open={open}
			title={__("Share Site", "wp-module-editor-chat")}
			className="nfd-editor-chat__share-site-modal"
			onClose={onClose}
			subtitle={
				<>{__("Ready to show off? Share your site with the world.", "wp-module-editor-chat")} 🌍</>
			}
			actions={
				<Button variant="secondary" onClick={onClose}>
					{__("Close", "wp-module-editor-chat")}
				</Button>
			}
		>
			<div className="nfd-editor-chat__share-site-modal__site-url-actions">
				{!!copied && (
					<div className="nfd-editor-chat__share-site-modal__site-url__copied">
						{__("Copied!", "wp-module-editor-chat")}
					</div>
				)}
				<Button onClick={copySiteToClipboard}>
					{__("Copy to clipboard", "wp-module-editor-chat")} <CopyClipboardIcon />
				</Button>
			</div>
			<input
				className="nfd-editor-chat__share-site-modal__site-url"
				type="text"
				disabled
				value={SITE_URL}
			/>
		</Modal>
	);
}
