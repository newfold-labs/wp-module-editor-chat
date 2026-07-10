/**
 * Internal dependencies.
 */
import { HeaderSection, PageSelector } from "../components";
import { isSiteEditor } from "../../../../utils/editorEnvironment";
import { useMemo } from "@wordpress/element";

export default function HeaderCenter() {
	const siteEditor = useMemo(() => isSiteEditor(), []);

	return <HeaderSection section="center">{siteEditor && <PageSelector />}</HeaderSection>;
}
