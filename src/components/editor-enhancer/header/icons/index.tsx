type SvgProps = React.ComponentProps<"svg">;

export function UndoIcon(props: SvgProps) {
	return (
		<svg
			fill="none"
			strokeWidth={1.5}
			stroke="currentColor"
			viewBox="0 0 24 24"
			xmlns="http://www.w3.org/2000/svg"
			aria-hidden="true"
			width="1em"
			{...props}
		>
			<path
				strokeLinecap="round"
				strokeLinejoin="round"
				d="M9 15 3 9m0 0 6-6M3 9h12a6 6 0 0 1 0 12h-3"
			/>
		</svg>
	);
}

export function RedoIcon(props: SvgProps) {
	return (
		<svg
			fill="none"
			strokeWidth={1.5}
			stroke="currentColor"
			viewBox="0 0 24 24"
			xmlns="http://www.w3.org/2000/svg"
			aria-hidden="true"
			width="1em"
			{...props}
		>
			<path
				strokeLinecap="round"
				strokeLinejoin="round"
				d="m15 15 6-6m0 0-6-6m6 6H9a6 6 0 0 0 0 12h3"
			/>
		</svg>
	);
}

export function QueueListIcon(props: SvgProps) {
	return (
		<svg
			fill="none"
			strokeWidth={1.5}
			stroke="currentColor"
			viewBox="0 0 24 24"
			xmlns="http://www.w3.org/2000/svg"
			aria-hidden="true"
			width="1em"
			{...props}
		>
			<path
				strokeLinecap="round"
				strokeLinejoin="round"
				d="M3.75 12h16.5m-16.5 3.75h16.5M3.75 19.5h16.5M5.625 4.5h12.75a1.875 1.875 0 0 1 0 3.75H5.625a1.875 1.875 0 0 1 0-3.75Z"
			/>
		</svg>
	);
}

export function PlusIcon(props: SvgProps) {
	return (
		<svg
			fill="none"
			strokeWidth={1.5}
			stroke="currentColor"
			viewBox="0 0 24 24"
			xmlns="http://www.w3.org/2000/svg"
			aria-hidden="true"
			width="1em"
			{...props}
		>
			<path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
		</svg>
	);
}

export function ChatIcon(props: SvgProps) {
	return (
		<svg
			fill="none"
			strokeWidth={1.5}
			stroke="currentColor"
			viewBox="0 0 24 24"
			xmlns="http://www.w3.org/2000/svg"
			aria-hidden="true"
			width="1em"
			{...props}
		>
			<path
				strokeLinecap="round"
				strokeLinejoin="round"
				d="M20.25 8.511c.884.284 1.5 1.128 1.5 2.097v4.286c0 1.136-.847 2.1-1.98 2.193-.34.027-.68.052-1.02.072v3.091l-3-3c-1.354 0-2.694-.055-4.02-.163a2.115 2.115 0 0 1-.825-.242m9.345-8.334a2.126 2.126 0 0 0-.476-.095 48.64 48.64 0 0 0-8.048 0c-1.131.094-1.976 1.057-1.976 2.192v4.286c0 .837.46 1.58 1.155 1.951m9.345-8.334V6.637c0-1.621-1.152-3.026-2.76-3.235A48.455 48.455 0 0 0 11.25 3c-2.115 0-4.198.137-6.24.402-1.608.209-2.76 1.614-2.76 3.235v6.226c0 1.621 1.152 3.026 2.76 3.235.577.075 1.157.14 1.74.194V21l4.155-4.155"
			/>
		</svg>
	);
}
export function ZoomIcon(props: SvgProps) {
	return (
		<svg
			fill="none"
			strokeWidth={1.5}
			stroke="currentColor"
			viewBox="0 0 24 24"
			xmlns="http://www.w3.org/2000/svg"
			aria-hidden="true"
			width="1em"
			{...props}
		>
			<path
				strokeLinecap="round"
				strokeLinejoin="round"
				d="M9 9V4.5M9 9H4.5M9 9 3.75 3.75M9 15v4.5M9 15H4.5M9 15l-5.25 5.25M15 9h4.5M15 9V4.5M15 9l5.25-5.25M15 15h4.5M15 15v4.5m0-4.5 5.25 5.25"
			/>
		</svg>
	);
}

export function DesktopIcon(props: SvgProps) {
	return (
		<svg
			fill="none"
			strokeWidth={1.5}
			stroke="currentColor"
			viewBox="0 0 24 24"
			xmlns="http://www.w3.org/2000/svg"
			aria-hidden="true"
			width="1em"
			{...props}
		>
			<path
				strokeLinecap="round"
				strokeLinejoin="round"
				d="M9 17.25v1.007a3 3 0 0 1-.879 2.122L7.5 21h9l-.621-.621A3 3 0 0 1 15 18.257V17.25m6-12V15a2.25 2.25 0 0 1-2.25 2.25H5.25A2.25 2.25 0 0 1 3 15V5.25m18 0A2.25 2.25 0 0 0 18.75 3H5.25A2.25 2.25 0 0 0 3 5.25m18 0V12a2.25 2.25 0 0 1-2.25 2.25H5.25A2.25 2.25 0 0 1 3 12V5.25"
			/>
		</svg>
	);
}

export function TabletIcon(props: SvgProps) {
	return (
		<svg
			fill="none"
			strokeWidth={1.5}
			stroke="currentColor"
			viewBox="0 0 24 24"
			xmlns="http://www.w3.org/2000/svg"
			aria-hidden="true"
			width="1em"
			{...props}
		>
			<path
				strokeLinecap="round"
				strokeLinejoin="round"
				d="M10.5 19.5h3m-6.75 2.25h10.5a2.25 2.25 0 0 0 2.25-2.25v-15a2.25 2.25 0 0 0-2.25-2.25H6.75A2.25 2.25 0 0 0 4.5 4.5v15a2.25 2.25 0 0 0 2.25 2.25Z"
			/>
		</svg>
	);
}

export function MobileIcon(props: SvgProps) {
	return (
		<svg
			fill="none"
			strokeWidth={1.5}
			stroke="currentColor"
			viewBox="0 0 24 24"
			xmlns="http://www.w3.org/2000/svg"
			aria-hidden="true"
			width="1em"
			{...props}
		>
			<path
				strokeLinecap="round"
				strokeLinejoin="round"
				d="M10.5 1.5H8.25A2.25 2.25 0 0 0 6 3.75v16.5a2.25 2.25 0 0 0 2.25 2.25h7.5A2.25 2.25 0 0 0 18 20.25V3.75a2.25 2.25 0 0 0-2.25-2.25H13.5m-3 0V3h3V1.5m-3 0h3m-3 18.75h3"
			/>
		</svg>
	);
}

export function ArrowTopRightOnSquareIcon(props: SvgProps) {
	return (
		<svg
			fill="none"
			strokeWidth={1.5}
			stroke="currentColor"
			viewBox="0 0 24 24"
			xmlns="http://www.w3.org/2000/svg"
			aria-hidden="true"
			width="1em"
			{...props}
		>
			<path
				strokeLinecap="round"
				strokeLinejoin="round"
				d="M13.5 6H5.25A2.25 2.25 0 0 0 3 8.25v10.5A2.25 2.25 0 0 0 5.25 21h10.5A2.25 2.25 0 0 0 18 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25"
			/>
		</svg>
	);
}

export function GlobeIcon(props: SvgProps) {
	return (
		<svg
			fill="none"
			strokeWidth={1.5}
			stroke="currentColor"
			viewBox="0 0 24 24"
			xmlns="http://www.w3.org/2000/svg"
			aria-hidden="true"
			width="1em"
			{...props}
		>
			<path
				strokeLinecap="round"
				strokeLinejoin="round"
				d="M12 21a9.004 9.004 0 0 0 8.716-6.747M12 21a9.004 9.004 0 0 1-8.716-6.747M12 21c2.485 0 4.5-4.03 4.5-9S14.485 3 12 3m0 18c-2.485 0-4.5-4.03-4.5-9S9.515 3 12 3m0 0a8.997 8.997 0 0 1 7.843 4.582M12 3a8.997 8.997 0 0 0-7.843 4.582m15.686 0A11.953 11.953 0 0 1 12 10.5c-2.998 0-5.74-1.1-7.843-2.918m15.686 0A8.959 8.959 0 0 1 21 12c0 .778-.099 1.533-.284 2.253m0 0A17.919 17.919 0 0 1 12 16.5c-3.162 0-6.133-.815-8.716-2.247m0 0A9.015 9.015 0 0 1 3 12c0-1.605.42-3.113 1.157-4.418"
			/>
		</svg>
	);
}

export function DocumentTextIcon(props: SvgProps) {
	return (
		<svg
			fill="none"
			strokeWidth={1.5}
			stroke="currentColor"
			viewBox="0 0 24 24"
			xmlns="http://www.w3.org/2000/svg"
			aria-hidden="true"
			width="1em"
			{...props}
		>
			<path
				strokeLinecap="round"
				strokeLinejoin="round"
				d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z"
			/>
		</svg>
	);
}

export function ChevronUpDownIcon(props: SvgProps) {
	return (
		<svg
			fill="none"
			strokeWidth={1.5}
			stroke="currentColor"
			viewBox="0 0 24 24"
			xmlns="http://www.w3.org/2000/svg"
			aria-hidden="true"
			width="1em"
			{...props}
		>
			<path
				strokeLinecap="round"
				strokeLinejoin="round"
				d="M8.25 15 12 18.75 15.75 15m-7.5-6L12 5.25 15.75 9"
			/>
		</svg>
	);
}

export function ChevronDownIcon(props: SvgProps) {
	return (
		<svg
			fill="none"
			strokeWidth={1.5}
			stroke="currentColor"
			viewBox="0 0 24 24"
			xmlns="http://www.w3.org/2000/svg"
			aria-hidden="true"
			width="1em"
			{...props}
		>
			<path strokeLinecap="round" strokeLinejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" />
		</svg>
	);
}

export function SparklesIcon(props: SvgProps) {
	return (
		<svg
			fill="none"
			strokeWidth={1.5}
			stroke="currentColor"
			viewBox="0 0 24 24"
			xmlns="http://www.w3.org/2000/svg"
			aria-hidden="true"
			width="1em"
			{...props}
		>
			<path
				strokeLinecap="round"
				strokeLinejoin="round"
				d="M9.813 15.904 9 18.75l-.813-2.846a4.5 4.5 0 0 0-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 0 0 3.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 0 0 3.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 0 0-3.09 3.09ZM18.259 8.715 18 9.75l-.259-1.035a3.375 3.375 0 0 0-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 0 0 2.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 0 0 2.456 2.456L21.75 6l-1.035.259a3.375 3.375 0 0 0-2.456 2.456ZM16.894 20.567 16.5 21.75l-.394-1.183a2.25 2.25 0 0 0-1.423-1.423L13.5 18.75l1.183-.394a2.25 2.25 0 0 0 1.423-1.423l.394-1.183.394 1.183a2.25 2.25 0 0 0 1.423 1.423l1.183.394-1.183.394a2.25 2.25 0 0 0-1.423 1.423Z"
			/>
		</svg>
	);
}

export function HomeIcon(props: SvgProps) {
	return (
		<svg
			fill="none"
			strokeWidth={1.5}
			stroke="currentColor"
			viewBox="0 0 24 24"
			xmlns="http://www.w3.org/2000/svg"
			aria-hidden="true"
			width="1em"
			{...props}
		>
			<path
				strokeLinecap="round"
				strokeLinejoin="round"
				d="m2.25 12 8.954-8.955c.44-.439 1.152-.439 1.591 0L21.75 12M4.5 9.75v10.125c0 .621.504 1.125 1.125 1.125H9.75v-4.875c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21h4.125c.621 0 1.125-.504 1.125-1.125V9.75M8.25 21h8.25"
			/>
		</svg>
	);
}

export function EnvelopeIcon(props: SvgProps) {
	return (
		<svg
			fill="none"
			strokeWidth={1.5}
			stroke="currentColor"
			viewBox="0 0 24 24"
			xmlns="http://www.w3.org/2000/svg"
			aria-hidden="true"
			width="1em"
			{...props}
		>
			<path
				strokeLinecap="round"
				strokeLinejoin="round"
				d="M21.75 6.75v10.5a2.25 2.25 0 0 1-2.25 2.25h-15a2.25 2.25 0 0 1-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0 0 19.5 4.5h-15a2.25 2.25 0 0 0-2.25 2.25m19.5 0v.243a2.25 2.25 0 0 1-1.07 1.916l-7.5 4.615a2.25 2.25 0 0 1-2.36 0L3.32 8.91a2.25 2.25 0 0 1-1.07-1.916V6.75"
			/>
		</svg>
	);
}

export function CreditCardIcon(props: SvgProps) {
	return (
		<svg
			fill="none"
			strokeWidth={1.5}
			stroke="currentColor"
			viewBox="0 0 24 24"
			xmlns="http://www.w3.org/2000/svg"
			aria-hidden="true"
			width="1em"
			{...props}
		>
			<path
				strokeLinecap="round"
				strokeLinejoin="round"
				d="M2.25 8.25h19.5M2.25 9h19.5m-16.5 5.25h6m-6 2.25h3m-3.75 3h15a2.25 2.25 0 0 0 2.25-2.25V6.75A2.25 2.25 0 0 0 19.5 4.5h-15a2.25 2.25 0 0 0-2.25 2.25v10.5A2.25 2.25 0 0 0 4.5 19.5Z"
			/>
		</svg>
	);
}

export function ArrowLeftCircleIcon(props: SvgProps) {
	return (
		<svg
			fill="none"
			strokeWidth={1.5}
			stroke="currentColor"
			viewBox="0 0 24 24"
			xmlns="http://www.w3.org/2000/svg"
			aria-hidden="true"
			width="1em"
			{...props}
		>
			<path
				strokeLinecap="round"
				strokeLinejoin="round"
				d="m11.25 9-3 3m0 0 3 3m-3-3h7.5M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z"
			/>
		</svg>
	);
}

export function ArrowRightCircleIcon(props: SvgProps) {
	return (
		<svg
			fill="none"
			strokeWidth={1.5}
			stroke="currentColor"
			viewBox="0 0 24 24"
			xmlns="http://www.w3.org/2000/svg"
			aria-hidden="true"
			width="1em"
			{...props}
		>
			<path
				strokeLinecap="round"
				strokeLinejoin="round"
				d="m12.75 15 3-3m0 0-3-3m3 3h-7.5M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z"
			/>
		</svg>
	);
}

export function ShareIcon(props: SvgProps) {
	return (
		<svg
			fill="none"
			strokeWidth={1.5}
			stroke="currentColor"
			viewBox="0 0 24 24"
			xmlns="http://www.w3.org/2000/svg"
			aria-hidden="true"
			width="1em"
			{...props}
		>
			<path
				strokeLinecap="round"
				strokeLinejoin="round"
				d="M7.217 10.907a2.25 2.25 0 1 0 0 2.186m0-2.186c.18.324.283.696.283 1.093s-.103.77-.283 1.093m0-2.186 9.566-5.314m-9.566 7.5 9.566 5.314m0 0a2.25 2.25 0 1 0 3.935 2.186 2.25 2.25 0 0 0-3.935-2.186Zm0-12.814a2.25 2.25 0 1 0 3.933-2.185 2.25 2.25 0 0 0-3.933 2.185Z"
			/>
		</svg>
	);
}

export function CopyClipboardIcon(props: SvgProps) {
	return (
		<svg
			fill="none"
			strokeWidth={1.5}
			stroke="currentColor"
			viewBox="0 0 14 16"
			xmlns="http://www.w3.org/2000/svg"
			width="1em"
			{...props}
		>
			<path
				d="M4.09615 4.65385V3.61877C4.09615 2.77479 4.72449 2.05872 5.56549 1.98882C5.84285 1.96651 6.12169 1.94644 6.40054 1.92933M9.67308 12.4615H11.3462C11.7899 12.4615 12.2154 12.2853 12.5292 11.9715C12.843 11.6577 13.0192 11.2322 13.0192 10.7885V3.61877C13.0192 2.77479 12.3909 2.05872 11.5499 1.98882C11.2718 1.96576 10.9934 1.94593 10.7148 1.92933M10.7148 1.92933C10.6092 1.5878 10.3963 1.28905 10.1086 1.07684C9.82094 0.86462 9.47287 0.750084 9.11538 0.75H8C7.64251 0.750084 7.29444 0.86462 7.00676 1.07684C6.71907 1.28905 6.50689 1.5878 6.40128 1.92933C6.35295 2.08549 6.32692 2.25131 6.32692 2.42308V2.98077H10.7885V2.42308C10.7885 2.25131 10.7632 2.08549 10.7148 1.92933ZM9.67308 13.0192V11.625C9.67308 10.9594 9.40867 10.3211 8.93803 9.85043C8.46738 9.37979 7.82905 9.11538 7.16346 9.11538H6.04808C5.82621 9.11538 5.61344 9.02725 5.45656 8.87037C5.29967 8.71349 5.21154 8.50071 5.21154 8.27885V7.16346C5.21154 6.49787 4.94713 5.85954 4.47649 5.3889C4.00584 4.91825 3.36751 4.65385 2.70192 4.65385H1.86538M2.98077 4.65385H1.58654C1.12477 4.65385 0.75 5.02862 0.75 5.49038V14.4135C0.75 14.8752 1.12477 15.25 1.58654 15.25H8.83654C9.29831 15.25 9.67308 14.8752 9.67308 14.4135V11.3462C9.67308 9.57124 8.968 7.86903 7.71295 6.61398C6.45789 5.35893 4.75568 4.65385 2.98077 4.65385Z"
				strokeLinecap="round"
				strokeLinejoin="round"
			/>
		</svg>
	);
}

export function CheckIcon(props: SvgProps) {
	return (
		<svg
			fill="none"
			strokeWidth={1.5}
			stroke="currentColor"
			viewBox="0 0 24 24"
			xmlns="http://www.w3.org/2000/svg"
			aria-hidden="true"
			width="1em"
			{...props}
		>
			<path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
		</svg>
	);
}

export function MagnifyingGlassIcon(props: SvgProps) {
	return (
		<svg
			fill="none"
			strokeWidth={1.5}
			stroke="currentColor"
			viewBox="0 0 24 24"
			xmlns="http://www.w3.org/2000/svg"
			aria-hidden="true"
			width="1em"
			{...props}
		>
			<path
				strokeLinecap="round"
				strokeLinejoin="round"
				d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z"
			/>
		</svg>
	);
}

export function WordPressIcon(props: SvgProps) {
	return (
		<svg viewBox="0 0 18 18" fill="none" xmlns="http://www.w3.org/2000/svg" width="1em" {...props}>
			<path
				d="M18 9C18 4.041 13.959 0 9 0C4.032 0 0 4.041 0 9C0 13.968 4.032 18 9 18C13.959 18 18 13.968 18 9ZM7.002 13.833L3.933 5.598C4.428 5.58 4.986 5.526 4.986 5.526C5.436 5.472 5.382 4.509 4.932 4.527C4.932 4.527 3.627 4.626 2.799 4.626C2.637 4.626 2.466 4.626 2.277 4.617C3.708 2.421 6.183 0.999 9 0.999C11.097 0.999 13.005 1.782 14.445 3.105C13.833 3.006 12.96 3.456 12.96 4.527C12.96 5.193 13.365 5.751 13.77 6.417C14.085 6.966 14.265 7.641 14.265 8.631C14.265 9.972 13.005 13.131 13.005 13.131L10.278 5.598C10.764 5.58 11.016 5.445 11.016 5.445C11.466 5.4 11.412 4.32 10.962 4.347C10.962 4.347 9.666 4.455 8.82 4.455C8.037 4.455 6.723 4.347 6.723 4.347C6.273 4.32 6.219 5.427 6.669 5.445L7.497 5.517L8.631 8.586L7.002 13.833ZM15.669 9C15.885 8.424 16.335 7.317 16.056 5.175C16.686 6.336 17.001 7.614 17.001 9C17.001 11.961 15.444 14.616 13.041 16.002C13.914 13.671 14.787 11.322 15.669 9ZM5.49 16.281C2.808 14.985 0.999 12.177 0.999 9C0.999 7.83 1.206 6.768 1.647 5.769C2.925 9.27 4.203 12.78 5.49 16.281ZM9.117 10.314L11.439 16.596C10.665 16.857 9.855 17.001 9 17.001C8.289 17.001 7.587 16.902 6.939 16.704C7.668 14.562 8.397 12.438 9.117 10.314Z"
				fill="currentColor"
			/>
		</svg>
	);
}

export function BluehostIcon(props: SvgProps) {
	return (
		<svg viewBox="0 0 19 19" fill="none" xmlns="http://www.w3.org/2000/svg" width="1em" {...props}>
			<path
				d="M0 0H5.1674V5.20484H0V0ZM6.66518 0H11.8326V5.20484H6.66518V0ZM13.3303 0H18.4978V5.20484H13.3303V0ZM0 6.74007H5.1674V11.9449H0V6.74007ZM6.66518 6.74007H11.8326V11.9449H6.66518V6.74007ZM13.3303 6.74007H18.4978V11.9449H13.3303V6.74007ZM0 13.4801H5.1674V18.6849H0V13.4801ZM6.66518 13.4801H11.8326V18.6849H6.66518V13.4801ZM13.3303 13.4801H18.4978V18.6849H13.3303V13.4801Z"
				fill="#196CDF"
			/>
		</svg>
	);
}
