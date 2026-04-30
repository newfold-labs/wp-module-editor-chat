/**
 * External dependencies.
 */
import classNames from "classnames";
import type { ComponentProps } from "react";

type HeaderSectionProps = ComponentProps<"div"> & {
	section: "left" | "center" | "right";
};

export default function HeaderSection({ className, section, ...other }: HeaderSectionProps) {
	const classes = classNames([
		"nfd-editor-chat__editor-header-section",
		`nfd-editor-chat__editor-header-section__${section}`,
		className,
	]);

	return <div className={classes} {...other} />;
}
