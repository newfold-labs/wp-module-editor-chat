/**
 * External dependencies.
 */
import classNames from "classnames";
import type { ComponentProps } from "react";

type DropdownMenuSectionProps = ComponentProps<"div">;

export default function DropdownMenuSection({ className, ...props }: DropdownMenuSectionProps) {
	const classes = classNames(className, "nfd-editor-chat__dropdown-menu__section");

	return <div className={classes} {...props} />;
}
