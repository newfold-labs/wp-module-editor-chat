/**
 * OpenAI-compatible SSE chunks for mocked editor-chat worker responses.
 */

/**
 * @param {Array<object>} chunks Chat completion chunk objects (without `data:` prefix).
 * @return {string} SSE body
 */
export function buildChatCompletionSse( chunks ) {
	const lines = chunks.map( ( chunk ) => `data: ${ JSON.stringify( chunk ) }\n\n` );
	lines.push( 'data: [DONE]\n\n' );
	return lines.join( '' );
}

/**
 * Stream that applies a block attribute patch via blu-update-block-attrs, then a closing reply.
 *
 * @param {{ clientId: string, newContent: string }} params
 * @return {string} SSE body for the tool-call pass
 */
export function buildUpdateHeadingAttrsPass( { clientId, newContent } ) {
	const toolArgs = JSON.stringify( {
		client_id: clientId,
		attributes: { content: newContent },
	} );
	return buildChatCompletionSse( [
		{
			id: 'chatcmpl-mock-plan',
			object: 'chat.completion.chunk',
			choices: [
				{
					index: 0,
					delta: { content: '{"message":"Updating the heading text."}' },
					finish_reason: null,
				},
			],
		},
		{
			id: 'chatcmpl-mock-tool',
			object: 'chat.completion.chunk',
			choices: [
				{
					index: 0,
					delta: {
						tool_calls: [
							{
								index: 0,
								id: 'call_mock_update_attrs',
								type: 'function',
								function: {
									name: 'blu-update-block-attrs',
									arguments: '',
								},
							},
						],
					},
					finish_reason: null,
				},
			],
		},
		{
			id: 'chatcmpl-mock-tool-args',
			object: 'chat.completion.chunk',
			choices: [
				{
					index: 0,
					delta: {
						tool_calls: [
							{
								index: 0,
								function: { arguments: toolArgs },
							},
						],
					},
					finish_reason: 'tool_calls',
				},
			],
		},
	] );
}

/**
 * @return {string} SSE body for a summarize / no-tools pass
 */
export function buildClosingReplyPass() {
	return buildChatCompletionSse( [
		{
			id: 'chatcmpl-mock-close',
			object: 'chat.completion.chunk',
			choices: [
				{
					index: 0,
					delta: { content: '{"message":"The heading has been updated."}' },
					finish_reason: null,
				},
			],
		},
		{
			id: 'chatcmpl-mock-close-end',
			object: 'chat.completion.chunk',
			choices: [ { index: 0, delta: {}, finish_reason: 'stop' } ],
		},
	] );
}
