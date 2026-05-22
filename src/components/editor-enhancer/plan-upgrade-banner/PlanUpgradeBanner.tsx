/**
 * WordPress dependencies.
 */
import { createPortal, useState } from "@wordpress/element";
import { __ } from "@wordpress/i18n";

/**
 * Internal dependencies.
 */
import { getPlanUpgradeBannerOptions } from "./utils";

const options = getPlanUpgradeBannerOptions();
const rootElement = document?.querySelector("#wpwrap") as HTMLDivElement;

export default function PlanUpgradeBanner() {
	if (!options || !rootElement) {
		return null;
	}

	const banner = (
		<>
			<div className="nfd-editor-chat__plan-upgrade-banner">
				<div className="nfd-editor-chat__plan-upgrade-banner__content">
					<div className="nfd-editor-chat__plan-upgrade-banner__message">{options.message}</div>
					<a
						className="nfd-editor-chat__plan-upgrade-banner__cta"
						href={options.upgradeUrl}
						target="_blank"
						rel="noopener noreferrer"
					>
						{__("Upgrade now", "wp-module-editor-chat")}
					</a>
				</div>
			</div>
		</>
	);

	return createPortal(banner, rootElement);
}
