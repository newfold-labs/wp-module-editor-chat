/**
 * External dependencies.
 */
import classNames from "classnames";

type DropdownMenuSectionProps = React.ComponentProps<"div">;

export default function DropdownMenuSection({ className, ...props }: DropdownMenuSectionProps) {
	const classes = classNames(className, "nfd-editor-chat__dropdown-menu__section");

	return <div className={classes} {...props} />;
}
