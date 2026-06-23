import { dispatch, select } from "@wordpress/data";

export const disableWelcomeGuide = () => {
	const selector = select("core/preferences");
	const dispatcher = dispatch("core/preferences");

	const guideKeys = ["welcomeGuide", "welcomeGuidePage"];

	guideKeys.forEach((key) => {
		if (selector.get("core/edit-site", key) !== false) {
			dispatcher.set("core/edit-site", key, false);
		}
	});
};
