/**
 * WordPress dependencies.
 */
import { Button } from "@wordpress/components";
import { __, sprintf } from "@wordpress/i18n";

/**
 * Internal dependencies
 */
import {
	ArrowLeftCircleIcon,
	ArrowRightCircleIcon,
	ArrowTopRightOnSquareIcon,
	BrandIcon,
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

type EditorChatBrand = {
	name?: string;
	accountUrl?: string;
	emailUrl?: string;
	billingUrl?: string;
	adminUrl?: string;
};

const getBrand = (): EditorChatBrand => {
	const brand = ( window as { nfdEditorChat?: { brand?: EditorChatBrand } } )
		.nfdEditorChat?.brand;
	return brand ?? {};
};

export default function BrandDropdownMenu() {
	const [ shareOpen, setShareOpen ] = useState( false );
	const [ regenerateOpen, setRegenerateOpen ] = useState( false );

	const { name, accountUrl, emailUrl, billingUrl, adminUrl } = getBrand();
	const brandName = name || __( "Host", "wp-module-editor-chat" );
	const wpDashboardUrl =
		adminUrl ||
		( window as { NewfoldRuntime?: { adminUrl?: string } } ).NewfoldRuntime?.adminUrl ||
		"/wp-admin";

	const closeShareModal = () => setShareOpen( false );
	const closeRegenerateModal = () => setRegenerateOpen( false );
	const openRegenerateModal = () => setRegenerateOpen( true );
	const openShareModal = () => setShareOpen( true );

	const portalLabel = sprintf(
		/* translators: %s: brand display name */
		__( "Go to %s Portal", "wp-module-editor-chat" ),
		brandName
	);

	return (
		<>
			<ShareSiteModal open={ shareOpen } onClose={ closeShareModal } />
			<RegenerateSiteModal open={ regenerateOpen } onClose={ closeRegenerateModal } />
			<DropdownMenu
				className="nfd-editor-chat__brand-menu"
				contentClassName="nfd-editor-chat__brand-menu__dropdown"
				popoverProps={ { style: { width: 300 } } }
				renderToggle={ ( { isOpen, onToggle } ) => (
					<Button onClick={ onToggle } aria-expanded={ isOpen }>
						<BrandIcon className="nfd-editor-chat__brand-menu__icon" />
						<span className="nfd-editor-chat__brand-menu__label">{ brandName }</span>
						<ChevronDownIcon className="nfd-editor-chat__brand-menu__chevron" />
					</Button>
				) }
				renderContent={ ( { onClose } ) => (
					<>
						<DropdownMenuSection>
							<DropdownMenuItem
								startDecoration={ <SparklesIcon /> }
								endDecoration={ <ArrowLeftCircleIcon /> }
								onClick={ () => {
									openRegenerateModal();
									onClose();
								} }
							>
								{ __( "Regenerate", "wp-module-editor-chat" ) }
							</DropdownMenuItem>

							<DropdownMenuItem
								startDecoration={ <ShareIcon /> }
								onClick={ () => {
									openShareModal();
									onClose();
								} }
							>
								{ __( "Share site", "wp-module-editor-chat" ) }
							</DropdownMenuItem>
						</DropdownMenuSection>

						{ accountUrl && (
							<DropdownMenuSection>
								<DropdownMenuItem
									startDecoration={ <HomeIcon /> }
									endDecoration={ <ArrowTopRightOnSquareIcon /> }
									href={ accountUrl }
									isExternalLink
								>
									{ portalLabel }
								</DropdownMenuItem>
								{ emailUrl && (
									<DropdownMenuItem
										startDecoration={ <EnvelopeIcon /> }
										endDecoration={ <ArrowTopRightOnSquareIcon /> }
										href={ emailUrl }
										isExternalLink
									>
										{ __( "Professional Email", "wp-module-editor-chat" ) }
									</DropdownMenuItem>
								) }
								{ billingUrl && (
									<DropdownMenuItem
										startDecoration={ <CreditCardIcon /> }
										endDecoration={ <ArrowTopRightOnSquareIcon /> }
										href={ billingUrl }
										isExternalLink
									>
										{ __( "Manage Billing", "wp-module-editor-chat" ) }
									</DropdownMenuItem>
								) }
							</DropdownMenuSection>
						) }

						<DropdownMenuSection>
							<DropdownMenuItem
								startDecoration={ <WordPressIcon /> }
								endDecoration={ <ArrowRightCircleIcon /> }
								href={ wpDashboardUrl }
							>
								{ __( "Exit to WordPress", "wp-module-editor-chat" ) }
							</DropdownMenuItem>
						</DropdownMenuSection>
					</>
				) }
			/>
		</>
	);
}
