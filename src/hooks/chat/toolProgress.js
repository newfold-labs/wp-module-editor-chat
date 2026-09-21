/**
 * Count successful page-changing tools in one model pass.
 *
 * @param {Array<Object>} results Tool execution results.
 * @return {number} Number of applied changes.
 */
export function countAppliedToolChanges(results) {
	return (results || []).filter(
		(result) => result?.hasChanges === true || result?.isContentCreation === true
	).length;
}
