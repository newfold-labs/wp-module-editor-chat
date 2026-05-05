/**
 * WordPress dependencies
 */
import { Dropdown } from "@wordpress/components";

/**
 * External dependencies.
 */
import classNames from "classnames";
import type { ComponentProps } from "react";

type DropdownMenuProps = Omit<ComponentProps<typeof Dropdown>, "width"> & {
	width?: number;
};

export default function DropdownMenu({
	className,
	contentClassName,
	popoverProps,
	width = 300,
	...props
}: DropdownMenuProps) {
	const mainClass = "nfd-editor-chat__dropdown-menu";
	const prefixedClass = (_: string) => mainClass + "__" + _;

	const classes = {
		main: classNames(className, mainClass),
		dropdown: classNames(contentClassName, prefixedClass("dropdown")),
	};

	return (
		<Dropdown
			className={classes.main}
			contentClassName={classes.dropdown}
			popoverProps={{ style: { width: width }, ...popoverProps }}
			{...props}
		/>
	);
}
