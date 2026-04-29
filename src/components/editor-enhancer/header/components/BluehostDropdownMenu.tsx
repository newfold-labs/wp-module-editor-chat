/**
 * WordPress dependencies.
 */
import { Button } from "@wordpress/components";
import { __ } from "@wordpress/i18n";

/**
 * Internal dependencies
 */
import {
	ArrowLeftCircleIcon,
	ArrowRightCircleIcon,
	ArrowTopRightOnSquareIcon,
	BluehostIcon,
	ChevronDownIcon,
	CreditCardIcon,
	EnvelopeIcon,
	HomeIcon,
	ShareIcon,
	SparklesIcon,
	WordPressIcon,
} from "../icons";
import { useState } from "@wordpress/element";
import ShareSiteModal from "./ShareSiteModal";
import RegenerateSiteModal from "./RegenerateSiteModal";
import { DropdownMenu, DropdownMenuItem, DropdownMenuSection } from "./dropdown-menu";

const WP_DASHBOARD_URL = (window as any)?.NewfoldRuntime?.adminUrl ?? "/wp-admin";
const BH_ACCOUNT_URL = "https://www.bluehost.com/my-account";
const BH_ACCOUNT_EMAIL_URL = `${BH_ACCOUNT_URL}/email/email-bh`;
const BH_ACCOUNT_BILLING_URL = `${BH_ACCOUNT_URL}/billing-center-v2`;

export default function BluehostDropdownMenu() {
	const [shareOpen, setShareOpen] = useState(false)
	const [regenerateOpen, setRegenerateOpen] = useState(false)

	const closeShareModal = () => setShareOpen(false)
	const closeRegenerateModal = () => setRegenerateOpen(false);
	const openRegenerateModal = () => setRegenerateOpen(true);
	const openShareModal = () => setShareOpen(true)

	return (
		<>
			<ShareSiteModal open={shareOpen} onClose={closeShareModal} />
			<RegenerateSiteModal open={regenerateOpen} onClose={closeRegenerateModal} />
			<DropdownMenu
				className="nfd-editor-chat__bluehost-menu"
				contentClassName="nfd-editor-chat__bluehost-menu__dropdown"
				popoverProps={{ style: { width: 300 } }}
				renderToggle={({ isOpen, onToggle }) => (
					<Button onClick={onToggle} aria-expanded={isOpen}>
						<BluehostIcon className="nfd-editor-chat__bluehost-menu__icon" />
						Bluehost
						<ChevronDownIcon className="nfd-editor-chat__bluehost-menu__chevron" />
					</Button>
				)}
				renderContent={({ onClose }) => (
					<>
						<DropdownMenuSection>
							<DropdownMenuItem
								startDecoration={<SparklesIcon />}
								endDecoration={<ArrowLeftCircleIcon />}
								onClick={() => {
									openRegenerateModal();
									onClose();
								}}
							>
								{__("Regenerate", "wp-module-editor-chat")}
							</DropdownMenuItem>

							<DropdownMenuItem
								startDecoration={<ShareIcon />}
								onClick={() => {
									openShareModal();
									onClose();
								}}
							>
								{__("Share site", "wp-module-editor-chat")}
							</DropdownMenuItem>
						</DropdownMenuSection>

						<DropdownMenuSection>
							<DropdownMenuItem
								startDecoration={<HomeIcon />}
								endDecoration={<ArrowTopRightOnSquareIcon />}
								href={BH_ACCOUNT_URL}
								isExternalLink
							>
								{__("Go to Bluehost Portal", "wp-module-editor-chat")}
							</DropdownMenuItem>
							<DropdownMenuItem
								startDecoration={<EnvelopeIcon />}
								endDecoration={<ArrowTopRightOnSquareIcon />}
								href={BH_ACCOUNT_EMAIL_URL}
								isExternalLink
							>
								{__("Professional Email", "wp-module-editor-chat")}
							</DropdownMenuItem>
							<DropdownMenuItem
								startDecoration={<CreditCardIcon />}
								endDecoration={<ArrowTopRightOnSquareIcon />}
								href={BH_ACCOUNT_BILLING_URL}
								isExternalLink
							>
								{__("Manage Billing", "wp-module-editor-chat")}
							</DropdownMenuItem>
						</DropdownMenuSection>

						<DropdownMenuSection>
							<DropdownMenuItem
								startDecoration={<WordPressIcon />}
								endDecoration={<ArrowRightCircleIcon />}
								href={WP_DASHBOARD_URL}
							>
								{__("Exit to WordPress", "wp-module-editor-chat")}
							</DropdownMenuItem>
						</DropdownMenuSection>
					</>
				)}
			/>
		</>
	);
}
