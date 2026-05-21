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
	const [dismissed, setDismissed] = useState(false);

	if (!options || dismissed || !rootElement) {
		return null;
	}

	const dismiss = () => {
		document.body.classList.remove("nfd-editor-chat--has-plan-upgrade-banner");
		setDismissed(true);
	};

	const banner = (
		<>
			<div className="nfd-editor-chat__plan-upgrade-banner">
				<div className="nfd-editor-chat__plan-upgrade-banner__content">
					<div className="nfd-editor-chat__plan-upgrade-banner__message">{options.message}</div>

					<div className="nfd-editor-chat__plan-upgrade-banner__actions">
						<a className="nfd-editor-chat__plan-upgrade-banner__cta" href={options.upgradeUrl}>
							{__("Upgrade now", "wp-module-editor-chat")}
						</a>
						<div className="nfd-editor-chat__plan-upgrade-banner__dismiss" onClick={dismiss}>
							{__("Dismiss", "wp-module-editor-chat")}
						</div>
					</div>
				</div>
			</div>
		</>
	);

	return createPortal(banner, rootElement);
}
