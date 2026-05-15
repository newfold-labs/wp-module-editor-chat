/**
 * WordPress dependencies.
 */
import { __ } from "@wordpress/i18n";
import { Button, Spinner } from "@wordpress/components";
import { useState } from "@wordpress/element";
import apiFetch from "@wordpress/api-fetch";

/**
 * Internal dependencies.
 */
import Modal from "./Modal";
import { ArrowRightCircleIcon } from "../icons";

const ADMIN_URL = (window as any)?.NewfoldRuntime?.adminUrl ?? "/wp-admin/";
const ONBOARDING_URL = ADMIN_URL + "index.php?page=nfd-onboarding";

type RegenerateSiteModal = {
	open: boolean;
	onClose?: () => void;
};

export default function RegenerateSiteModal({ open, onClose }: RegenerateSiteModal) {
	const [generating, setGenerating] = useState(false);
	const handleClose = () => {
		if (generating) {
			return;
		}
		onClose?.();
	};

	const handleGeneration = () => {
		if (generating) {
			return;
		}
		setGenerating(true);

		apiFetch({ path: "/newfold-onboarding/v1/app/restart", method: "POST" })
			.then(() => {
				window.location.href = ONBOARDING_URL;
			})
			.catch((error) => {
				console.log(error);
				setGenerating(false);
			});
	};

	return (
		<Modal
			open={open}
			title={__("Regenerate Site", "wp-module-editor-chat")}
			className="nfd-editor-chat__regenerate-site-modal"
			onClose={handleClose}
			subtitle={
				<>
					{__(
						"Regenerating will permanently delete content from your current site.",
						"wp-module-editor-chat"
					)}
				</>
			}
			actions={
				<>
					<Button variant="secondary" onClick={handleClose} disabled={generating}>
						{__("Close", "wp-module-editor-chat")}
					</Button>
					<Button variant="primary" onClick={handleGeneration} disabled={generating}>
						{!!generating ? (
							<>
								<Spinner />
								{__("Regenerating...", "wp-module-editor-chat")}
							</>
						) : (
							<>
								{__("Start regeneration", "wp-module-editor-chat")}
								<ArrowRightCircleIcon />
							</>
						)}
					</Button>
				</>
			}
		>
			<p>{__("The following content will be deleted:", "wp-module-editor-chat")}</p>
			<ul>
				<li>{__("All pages and posts", "wp-module-editor-chat")}</li>
				<li>{__("Site settings and customizations", "wp-module-editor-chat")}</li>
				<li>{__("Any uploaded media tied to the generated site", "wp-module-editor-chat")}</li>
			</ul>
		</Modal>
	);
}
