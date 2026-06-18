import { dispatch, select } from "@wordpress/data";

export const disableWelcomeGuide = () => {
	if (select("core/preferences").get("core/edit-site", "welcomeGuide")) {
		dispatch("core/preferences").set("core/edit-site", "welcomeGuide", false);
	}
};
