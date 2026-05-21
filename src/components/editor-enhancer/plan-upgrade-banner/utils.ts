const RAW_BANNER_OPTIONS = (window as any)?.nfdEditorChat?.planUpgradeBanner ?? undefined;

export type PlanUpgradeBannerOptions = {
	message: string;
	upgradeUrl: string;
};

export const getPlanUpgradeBannerOptions: () => PlanUpgradeBannerOptions | undefined = () => {
	if (RAW_BANNER_OPTIONS) {
		const message = RAW_BANNER_OPTIONS?.message;
		const upgradeUrl = RAW_BANNER_OPTIONS?.upgradeUrl;

		if (
			typeof message === "string" &&
			typeof upgradeUrl === "string" &&
			!!message &&
			!!upgradeUrl
		) {
			return { message, upgradeUrl };
		}
	}

	return undefined;
};
