/**
 * WordPress dependencies.
 */
import { store as editorStore } from "@wordpress/editor";
import { useDispatch, useSelect } from "@wordpress/data";
import { Button } from "@wordpress/components";

/**
 * External dependencies.
 */
import classNames from "classnames";

/**
 * Internal dependencies.
 */
import { DesktopIcon, MobileIcon, TabletIcon } from "../icons";
import useZoomToggle from "../hooks/useZoomToggle";

type DeviceSwitcherButtonProps = React.ComponentProps<typeof Button> & { active?: boolean };

function DeviceSwitcherButton({
	active = false,
	className,
	...buttonProps
}: DeviceSwitcherButtonProps) {
	const classes = classNames([
		"nfd-editor-chat__header-device-switcher__button",
		className,
		{
			"nfd-editor-chat__header-device-switcher__button--active": active,
		},
	]);

	const props: React.ComponentProps<typeof Button> = {
		className: classes,
		...buttonProps,
	};

	return <Button {...props} />;
}

export default function DeviceSwitcher() {
	const { resetZoomLevel } = useZoomToggle();
	const { setDeviceType } = useDispatch(editorStore);

	const { deviceType } = useSelect((select) => {
		const { getDeviceType } = select(editorStore);
		return { deviceType: getDeviceType() };
	}, []);

	const handleDevicePreviewChange = (newDeviceType: string) => {
		setDeviceType(newDeviceType);
		resetZoomLevel();
	};

	const choices = [
		{
			value: "Desktop",
			icon: <DesktopIcon />,
		},
		{
			value: "Tablet",
			icon: <TabletIcon />,
		},
		{
			value: "Mobile",
			icon: <MobileIcon />,
		},
	];

	return (
		<div className="nfd-editor-chat__header-device-switcher">
			{choices.map((choice) => (
				<DeviceSwitcherButton
					key={choice.value}
					onClick={() => handleDevicePreviewChange(choice.value)}
					active={choice.value === deviceType}
				>
					{choice.icon}
				</DeviceSwitcherButton>
			))}
		</div>
	);
}
