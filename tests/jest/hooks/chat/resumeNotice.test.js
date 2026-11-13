/* global describe, expect, it */

const { RESUME_NOTICE, consumeResumeNotice } = require("../../../../src/hooks/chat/resumeNotice");

describe("consumeResumeNotice", () => {
	it("returns the system note once and resets the flag", () => {
		const ref = { current: true };

		expect(consumeResumeNotice(ref)).toEqual({ role: "system", content: RESUME_NOTICE });
		expect(ref.current).toBe(false);
		expect(consumeResumeNotice(ref)).toBeNull();
	});

	it("returns null when no resume happened", () => {
		expect(consumeResumeNotice({ current: false })).toBeNull();
	});

	it("tolerates a missing ref", () => {
		expect(consumeResumeNotice(undefined)).toBeNull();
	});

	it("tells the model to re-read the current block tree", () => {
		expect(RESUME_NOTICE).toBe(
			"Prior tool results in this conversation may reference block clientIds that no longer exist on the current page. Always re-read the current block tree before acting."
		);
	});
});
