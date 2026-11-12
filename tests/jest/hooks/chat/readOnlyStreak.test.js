/* global describe, expect, test */

import { MAX_READ_ONLY_PASSES } from "../../../../src/hooks/chat/constants";
import { nextReadOnlyStreak } from "../../../../src/hooks/chat/conversationUtils";

const calls = (...names) => names.map((name) => ({ name }));

describe("nextReadOnlyStreak", () => {
	test("counts a pass made only of real read-only tools", () => {
		expect(nextReadOnlyStreak(0, calls("blu-read-document"), false)).toBe(1);
		expect(nextReadOnlyStreak(1, calls("blu-editor_find-editor-blocks"), false)).toBe(2);
	});

	test("resets when a tool changed something or a non-read tool ran", () => {
		expect(nextReadOnlyStreak(3, calls("blu-read-document"), true)).toBe(0);
		expect(nextReadOnlyStreak(3, calls("blu-add-section"), false)).toBe(0);
		expect(nextReadOnlyStreak(3, [], false)).toBe(0);
	});

	test("gateway discovery passes neither count nor reset the streak", () => {
		expect(nextReadOnlyStreak(0, calls("blu-list-abilities"), false)).toBe(0);
		expect(nextReadOnlyStreak(2, calls("blu-get-ability-schema"), false)).toBe(2);
		expect(nextReadOnlyStreak(2, calls("blu_list_abilities".replace(/_/g, "-")), false)).toBe(2);
	});

	test("the add-section-from-CSV flow stays under the limit", () => {
		let streak = 0;
		for (const name of [
			"blu-list-abilities",
			"blu-get-ability-schema",
			"blu-read-document",
			"blu-editor_find-editor-blocks",
		]) {
			streak = nextReadOnlyStreak(streak, calls(name), false);
		}
		expect(streak).toBeLessThan(MAX_READ_ONLY_PASSES);
	});
});
