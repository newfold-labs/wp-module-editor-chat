/**
 * External dependencies.
 */
import classNames from "classnames";

type HeaderSectionProps = React.ComponentProps<"div"> & {
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
