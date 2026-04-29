/**
 * WordPress dependencies.
 */
import { Button } from "@wordpress/components";

/**
 * External dependencies.
 */
import classNames from "classnames";

type DropdownMenuItemProps = React.ComponentProps<typeof Button> & {
	startDecoration?: React.ReactNode;
	endDecoration?: React.ReactNode;
	isExternalLink?: boolean;
};

export default function DropdownMenuItem({
	startDecoration,
	endDecoration,
	isExternalLink = false,
	children,
	className,
	...other
}: DropdownMenuItemProps) {
	const mainClass = "nfd-editor-chat__dropdown-menu__item";
	const prefixedClass = (_: string) => mainClass + "__" + _;
	const attributeClass = (_: string) => mainClass + "--" + _;

	const classes = {
		main: classNames(className, mainClass, { [attributeClass("external")]: isExternalLink }),
		startDecoration: prefixedClass("start-decoration"),
		content: prefixedClass("content"),
		endDecoration: prefixedClass("end-decoration"),
	};

	return (
		<Button className={classes.main} {...other} target={isExternalLink ? "_blank" : undefined}>
			{!!startDecoration && <span className={classes.startDecoration}>{startDecoration}</span>}
			{!!children && <span className={classes.content}>{children}</span>}
			{!!endDecoration && <span className={classes.endDecoration}>{endDecoration}</span>}
		</Button>
	);
}
