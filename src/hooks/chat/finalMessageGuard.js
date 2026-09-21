const FAILED_NO_OP_MESSAGE =
	"I couldn't apply the requested change. Please review the failed action above.";

/**
 * Prevent an unverified model success claim after a failed, no-op tool round.
 *
 * @param {string}  message             Proposed assistant message.
 * @param {boolean} lastPassHadErrors   Whether the latest tools had errors.
 * @param {boolean} anyMutationThisTurn Whether any editor mutation succeeded.
 * @return {string} Message safe to show to the user.
 */
export function getVerifiedFinalMessage(message, lastPassHadErrors, anyMutationThisTurn) {
	return lastPassHadErrors && !anyMutationThisTurn ? FAILED_NO_OP_MESSAGE : message;
}
