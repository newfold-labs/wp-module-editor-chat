/**
 * WordPress dependencies.
 */
import { Modal as WpModal } from "@wordpress/components";

/**
 * External dependencies.
 */
import type { ReactNode } from "react";
import classNames from "classnames";

type ModalProps = {
	open: boolean;
	onClose?: () => void;
	className?: string;
	title?: string;
	subtitle?: ReactNode;
	actions?: ReactNode;
	children?: ReactNode;
};

export default function Modal({
	open,
	onClose,
	className,
	title,
	subtitle,
	actions,
	children,
}: ModalProps) {
	if (!open) {
		return null;
	}

	const mainClass = "nfd-editor-chat__modal";
	const prefixedClass = (_: string) => mainClass + "__" + _;

	const classes = {
		modal: classNames(className, mainClass),
		subtitle: prefixedClass("subtitle"),
		actions: prefixedClass("actions"),
		content: prefixedClass("content"),
	};

	return (
		<WpModal title={title} className={classes.modal} onRequestClose={onClose}>
			{!!subtitle && <div className={classes.subtitle}>{subtitle}</div>}
			{!!children && <div className={classes.content}>{children}</div>}
			{!!actions && <div className={classes.actions}>{actions}</div>}
		</WpModal>
	);
}
