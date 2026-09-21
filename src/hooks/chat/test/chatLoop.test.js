/* global describe, expect, test */

import { getVerifiedFinalMessage } from "../finalMessageGuard";
import { countAppliedToolChanges } from "../toolProgress";

describe("verified final chat messages", () => {
	test("rejects a success claim after a failed no-op tool round", () => {
		expect(
			getVerifiedFinalMessage(
				"A new image has been generated and set as the background.",
				true,
				false
			)
		).toBe("I couldn't apply the requested change. Please review the failed action above.");
	});

	test("keeps the model response when the final tool round succeeded", () => {
		expect(getVerifiedFinalMessage("The background has been updated.", false, true)).toBe(
			"The background has been updated."
		);
	});

	test("counts every applied tool when multiple planned steps finish in one pass", () => {
		expect(
			countAppliedToolChanges([
				{ hasChanges: true },
				{ hasChanges: true },
				{ hasChanges: false },
				{ isContentCreation: true },
			])
		).toBe(3);
	});
});
