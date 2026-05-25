/**
 * WordPress dependencies.
 */
import { Button } from "@wordpress/components";

/**
 * External dependencies.
 */
import classNames from "classnames";
import type { ComponentProps } from "react";

type HeaderIconButtonProps = ComponentProps<typeof Button> & { active?: boolean };

export default function HeaderIconButton({
	active = false,
	className,
	...other
}: HeaderIconButtonProps) {
	const classes = classNames([
		"nfd-editor-chat__icon-button",
		className,
		{
			"nfd-editor-chat--active": active,
		},
	]);

	return <Button className={classes} {...other} />;
}
