/**
 * Intercepts editor-chat config REST + mocked CF Worker (classify + chat completions).
 */

import {
	buildClosingReplyPass,
	buildUpdateHeadingAttrsPass,
} from '../fixtures/mock-worker-streams.js';

/** @typedef {'edit'|'local-editor-abilities'|'disabled-editor-abilities'|'stop'|'error'} MockScenario */

/**
 * @typedef {Object} MockWorkerState
 * @property {MockScenario} scenario Active mocked execution path.
 * @property {string|null} headingClientId Heading target for existing scenarios.
 * @property {string|null} paragraphClientId Paragraph target for ability scenarios.
 * @property {string} newHeadingText Existing-handler replacement text.
 * @property {string} newParagraphText Ability-scenario replacement text.
 * @property {string[]} requestedToolNames Tools offered to the mocked worker.
 */

export function createMockWorkerState( overrides = {} ) {
	return {
		scenario: 'edit',
		headingClientId: null,
		paragraphClientId: null,
		newHeadingText: 'Updated by AI chat',
		newParagraphText: 'Updated locally by AI chat',
		requestedToolNames: [],
		...overrides,
	};
}

const MOCK_WORKER_PATH = '/playwright-mock-editor-chat-worker/v1';

/**
 * @param {string|undefined} postData
 * @return {'tool'|'summary'}
 */
function getCompletionKindFromRequest( postData ) {
	let body;
	try {
		body = JSON.parse( postData || '{}' );
	} catch {
		return 'summary';
	}

	const messages = body.messages || [];
	const lastUser = [ ...messages ].reverse().find( ( m ) => m.role === 'user' );
	const content =
		typeof lastUser?.content === 'string' ? lastUser.content : String( lastUser?.content || '' );
	const hasTools = Array.isArray( body.tools ) && body.tools.length > 0;

	if ( ! hasTools || content.includes( 'All requested changes are applied' ) ) {
		return 'summary';
	}

	if (
		content.includes( '<user_intent>' ) ||
		content.includes( 'Complete every change listed' ) ||
		content.includes( 'EXECUTE directly' )
	) {
		return 'tool';
	}

	return hasTools ? 'tool' : 'summary';
}

/**
 * Hold the mocked completion open until the browser aborts the fetch (Stop).
 *
 * @param {import('@playwright/test').Route} route
 */
async function fulfillWhenRequestCloses( route ) {
	await new Promise( ( resolve ) => {
		route.request().once( 'close', resolve );
	} );
	await route.abort( 'cancelled' ).catch( () => {} );
}

/**
 * @param {import('@playwright/test').Page} page
 * @param {MockWorkerState} state Mutable scenario state (updated from tests).
 */
export async function installEditorChatWorkerMocks( page, state ) {
	await page.route( '**/nfd-editor-chat/v1/config**', async ( route ) => {
		const requestUrl = new URL( route.request().url() );
		const workerUrl = `${ requestUrl.origin }${ MOCK_WORKER_PATH }`;
		await route.fulfill( {
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify( {
				worker_url: workerUrl,
				session_token: 'playwright-mock-session-token',
				expires_in: 3600,
			} ),
		} );
	} );

	await page.route( `**${ MOCK_WORKER_PATH }/classify-intent`, async ( route ) => {
		await route.fulfill( {
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify( {
				task: 'edit_page',
				content_type: null,
				menu_edit: null,
				steps: [ 'Update the heading text' ],
			} ),
		} );
	} );

	await page.route( `**${ MOCK_WORKER_PATH }/chat/completions`, async ( route ) => {
		try {
			const body = JSON.parse( route.request().postData() || '{}' );
			state.requestedToolNames = ( body.tools || [] )
				.map( ( tool ) => tool?.function?.name )
				.filter( Boolean );
		} catch {
			state.requestedToolNames = [];
		}

		if ( state.scenario === 'error' ) {
			await route.fulfill( {
				status: 500,
				contentType: 'application/json',
				body: JSON.stringify( {
					error: { message: 'Mock worker failure for Playwright tests' },
				} ),
			} );
			return;
		}

		if ( state.scenario === 'stop' ) {
			await fulfillWhenRequestCloses( route );
			return;
		}

		const kind = getCompletionKindFromRequest( route.request().postData() );

		if ( kind === 'tool' ) {
			const usesParagraph =
				state.scenario === 'local-editor-abilities' ||
				state.scenario === 'disabled-editor-abilities';
			const clientId = usesParagraph ? state.paragraphClientId : state.headingClientId;
			if ( ! clientId ) {
				await route.fulfill( {
					status: 500,
					contentType: 'application/json',
					body: JSON.stringify( {
						error: { message: 'clientId not set for mock tool pass' },
					} ),
				} );
				return;
			}
			await route.fulfill( {
				status: 200,
				contentType: 'text/event-stream',
				body: buildUpdateHeadingAttrsPass( {
					clientId,
					newContent: usesParagraph ? state.newParagraphText : state.newHeadingText,
					toolName:
						state.scenario === 'local-editor-abilities'
							? 'blu-editor_update-block'
							: 'blu-update-block-attrs',
				} ),
			} );
			return;
		}

		await route.fulfill( {
			status: 200,
			contentType: 'text/event-stream',
			body: buildClosingReplyPass(),
		} );
	} );
}
