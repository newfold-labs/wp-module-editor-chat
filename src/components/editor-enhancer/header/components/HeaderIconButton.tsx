/**
 * WordPress dependencies.
 */
import { Button } from "@wordpress/components";

/**
 * External dependencies.
 */
import classNames from "classnames";

type HeaderIconButtonProps = React.ComponentProps<typeof Button> & { active?: boolean };

export default function HeaderIconButton({
	active = false,
	className,
	...other
}: HeaderIconButtonProps) {
	const classes = classNames([
		"nfd-editor-chat__header-icon-button",
		className,
		{
			"nfd-editor-chat__header-icon-button--active": active,
		},
	]);

	return <Button className={classes} {...other} />;
}
