/**
 * Internal dependencies
 */
import "./styles/styles.scss";
import { Header } from "./header";
import { PlanUpgradeBanner } from "./plan-upgrade-banner";

/**
 * Enhance editor functionalities.
 */
export default function EditorEnhancer() {
	return (
		<>
			<Header />
			<PlanUpgradeBanner />
		</>
	);
}
