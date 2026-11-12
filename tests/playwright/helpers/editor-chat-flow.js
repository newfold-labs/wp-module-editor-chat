/**
 * Navigation and interactions for editor-chat Playwright specs.
 */

import { createRequire } from 'module';
import { existsSync } from 'fs';
import { join } from 'path';

const pluginDir = process.env.PLUGIN_DIR || process.cwd();
const requireFromPlugin = createRequire( join( pluginDir, 'package.json' ) );
const helpersEntry = existsSync( join( pluginDir, 'tests/playwright/helpers/index.mjs' ) )
	? './tests/playwright/helpers/index.mjs'
	: './tests/playwright/helpers/index.js';
const { wordpress } = requireFromPlugin( helpersEntry );
const { expect } = requireFromPlugin( '@playwright/test' );

export const ORIGINAL_HEADING = 'Original heading';
export const ORIGINAL_PARAGRAPH = 'Original paragraph';
export const SELECTORS = {
	chatTextarea: 'textarea.nfd-editor-chat-input__textarea',
	chatSidebar: '.nfd-editor-chat-sidebar',
	welcome: '.nfd-editor-chat-welcome',
	sendButton: 'button.nfd-editor-chat-input__submit',
	stopButton: 'button.nfd-editor-chat-input__stop',
	stoppedNotice: '.nfd-editor-chat-stopped',
	errorAlert: '.nfd-ai-chat-error-alert',
	userMessage: '.nfd-ai-chat-message--user',
	saveButton: '#nfd-editor-chat__header__save',
	newChatButton: '#nfd-editor-chat__header__new-chat',
	historyList: '.nfd-editor-chat-history',
	historyRow: '.nfd-editor-chat-history__row',
	historySelect: '.nfd-editor-chat-history__select',
	historyDelete: '.nfd-editor-chat-history__delete',
	resumeNotice: '.nfd-editor-chat-resume-notice',
};

/**
 * Block editor URL for a page (chat loads with referrer=nfd-editor-chat).
 *
 * @param {number} postId
 * @return {string}
 */
export function editorChatUrl( postId ) {
	const params = new URLSearchParams( {
		post: String( postId ),
		action: 'edit',
		referrer: 'nfd-editor-chat',
	} );
	return `wp-admin/post.php?${ params.toString() }`;
}

/**
 * Site Editor URL with chat referrer.
 *
 * @return {string}
 */
export function siteEditorChatUrl() {
	const params = new URLSearchParams( {
		canvas: 'edit',
		referrer: 'nfd-editor-chat',
	} );
	return `wp-admin/site-editor.php?${ params.toString() }`;
}

/**
 * Create a draft page with a single heading block for editor-chat tests.
 *
 * @param {string} [title] Page title.
 * @return {Promise<{postId: number, slug: string}>} Created page.
 */
export async function createHeadingTestPage( title = 'Playwright Editor Chat' ) {
	const content =
		'<!-- wp:heading {"level":2} --><h2 class="wp-block-heading">' +
		ORIGINAL_HEADING +
		'</h2><!-- /wp:heading -->' +
		'<!-- wp:paragraph --><p>' +
		ORIGINAL_PARAGRAPH +
		'</p><!-- /wp:paragraph -->';
	const id = await wordpress.wpCli(
		`post create --post_type=page --post_status=publish --post_title="${ title }" --post_content='${ content }' --porcelain`,
		{ failOnNonZeroExit: true }
	);
	const postId = Number( String( id ).trim() );
	const slug = String(
		await wordpress.wpCli( `post get ${ postId } --field=post_name`, { failOnNonZeroExit: true } )
	).trim();
	return { postId, slug };
}

/**
 * Use the test page as the static front page so Site Editor home shows its blocks.
 *
 * @param {number} postId
 */
export async function setAsFrontPage( postId ) {
	await wordpress.wpCli( 'option update show_on_front page', { failOnNonZeroExit: true } );
	await wordpress.wpCli( `option update page_on_front ${ postId }`, { failOnNonZeroExit: true } );
}

/**
 * Reset the test page blocks to the original heading (serial tests may save edits).
 *
 * @param {number} postId
 */
export async function resetHeadingTestPageContent( postId ) {
	const content =
		'<!-- wp:heading {"level":2} --><h2 class="wp-block-heading">' +
		ORIGINAL_HEADING +
		'</h2><!-- /wp:heading -->' +
		'<!-- wp:paragraph --><p>' +
		ORIGINAL_PARAGRAPH +
		'</p><!-- /wp:paragraph -->';
	await wordpress.wpCli(
		`post update ${ postId } --post_content='${ content }'`,
		{ failOnNonZeroExit: true }
	);
}

/**
 * Block theme required for the post/site block editor in wp-env.
 */
export async function prepareEditorChatTestEnvironment() {
	// Theme may already be active from a prior test run in the same wp-env instance.
	await wordpress.wpCli( 'theme activate twentytwentyfive', { failOnNonZeroExit: false } );
}

/**
 * @param {import('@playwright/test').Page} page
 */
export async function deleteTestPage( postId ) {
	if ( ! postId ) {
		return;
	}
	await wordpress.wpCli( `post delete ${ postId } --force`, { failOnNonZeroExit: false } );
}

/**
 * @param {import('@playwright/test').Page} page
 */
export function editorCanvasFrame( page ) {
	return page.frameLocator( 'iframe[name="editor-canvas"]' );
}

/**
 * @param {import('@playwright/test').Page} page
 */
/**
 * Open the chat complementary area if template mode did not auto-open it.
 *
 * @param {import('@playwright/test').Page} page
 */
export async function ensureChatSidebarOpen( page ) {
	const textarea = page.locator( SELECTORS.chatTextarea );
	if ( await textarea.isVisible().catch( () => false ) ) {
		return;
	}
	const toggle = page.locator( '#nfd-editor-chat__header__chat-toggle' );
	if ( await toggle.isVisible().catch( () => false ) ) {
		await toggle.click();
	}
	await expect( textarea ).toBeVisible( { timeout: 60_000 } );
}

/**
 * @param {import('@playwright/test').Page} page
 * @param {number} postId
 */
/**
 * @param {import('@playwright/test').Page} page
 */
/**
 * @param {import('@playwright/test').Page} page
 * @param {{ expectedHeading?: string }} [options]
 */
export async function navigateToSiteEditorChat( page, options = {} ) {
	const { expectedHeading = ORIGINAL_HEADING } = options;
	await page.goto( siteEditorChatUrl(), { waitUntil: 'domcontentloaded' } );
	await page.waitForFunction(
		() => typeof window.nfdEditorChat !== 'undefined' && window.wp?.data,
		{ timeout: 120_000 }
	);
	await expectHeadingInCanvas( page, expectedHeading );
	await ensureChatSidebarOpen( page );
}

/**
 * @param {import('@playwright/test').Page} page
 * @param {number} postId
 */
export async function navigateToEditorChat( page, postId ) {
	await page.goto( editorChatUrl( postId ), { waitUntil: 'domcontentloaded' } );
	await page.waitForFunction(
		() => typeof window.nfdEditorChat !== 'undefined' && window.wp?.data,
		{ timeout: 120_000 }
	);
	await expectHeadingInCanvas( page, ORIGINAL_HEADING );
	await ensureChatSidebarOpen( page );
}

/**
 * @param {import('@playwright/test').Page} page
 * @return {Promise<string|null>}
 */
/**
 * @param {import('@playwright/test').Page} page
 * @return {Promise<string|null>}
 */
export async function getFirstHeadingClientId( page ) {
	const canvas = editorCanvasFrame( page );
	const heading = canvas.locator( 'h2.wp-block-heading' ).first();
	await heading.waitFor( { state: 'visible', timeout: 30_000 } );
	const fromDom = await heading.evaluate( ( el ) => {
		const node = el.closest( '[data-block]' );
		return node?.getAttribute( 'data-block' ) || null;
	} );
	if ( fromDom ) {
		return fromDom;
	}
	return page.evaluate( () => {
		const findHeading = ( blocks ) => {
			for ( const block of blocks ) {
				if ( block.name === 'core/heading' ) {
					return block.clientId;
				}
				const inner = findHeading( block.innerBlocks || [] );
				if ( inner ) {
					return inner;
				}
			}
			return null;
		};
		const blocks = window.wp?.data?.select( 'core/block-editor' )?.getBlocks?.() || [];
		return findHeading( blocks );
	} );
}

/**
 * @param {import('@playwright/test').Page} page
 * @return {Promise<string|null>} First paragraph client ID.
 */
export async function getFirstParagraphClientId( page ) {
	const paragraph = editorCanvasFrame( page ).locator( 'p' ).filter( {
		hasText: ORIGINAL_PARAGRAPH,
	} ).first();
	await paragraph.waitFor( { state: 'visible', timeout: 30_000 } );
	const fromDom = await paragraph.evaluate( ( el ) => {
		const node = el.closest( '[data-block]' );
		return node?.getAttribute( 'data-block' ) || null;
	} );
	if ( fromDom ) {
		return fromDom;
	}
	return page.evaluate( () => {
		const findParagraph = ( blocks ) => {
			for ( const block of blocks ) {
				if ( block.name === 'core/paragraph' ) {
					return block.clientId;
				}
				const inner = findParagraph( block.innerBlocks || [] );
				if ( inner ) {
					return inner;
				}
			}
			return null;
		};
		const blocks = window.wp?.data?.select( 'core/block-editor' )?.getBlocks?.() || [];
		return findParagraph( blocks );
	} );
}

/**
 * @param {import('@playwright/test').Page} page
 * @param {string} text
 */
export async function sendChatMessage( page, text ) {
	const textarea = page.locator( SELECTORS.chatTextarea );
	await textarea.fill( text );
	await page.locator( SELECTORS.sendButton ).click();
}

/**
 * Wait until the chat is not mid-request (stop hidden, input enabled).
 *
 * @param {import('@playwright/test').Page} page
 */
export async function waitForChatTurnIdle( page ) {
	await expect( page.locator( SELECTORS.stopButton ) ).toBeHidden( { timeout: 90_000 } );
	await expect( page.locator( SELECTORS.chatTextarea ) ).toBeEnabled( { timeout: 90_000 } );
}

/**
 * @param {import('@playwright/test').Page} page
 * @param {string} headingText
 */
export async function expectHeadingInCanvas( page, headingText ) {
	const canvas = editorCanvasFrame( page );
	const match = canvas
		.getByRole( 'heading', { name: headingText } )
		.or( canvas.getByText( headingText, { exact: true } ) );
	await expect( match.first() ).toBeVisible( { timeout: 45_000 } );
}

/**
 * @param {import('@playwright/test').Page} page
 * @param {string} text Expected paragraph text.
 */
export async function expectParagraphInCanvas( page, text ) {
	await expect( editorCanvasFrame( page ).getByText( text, { exact: true } ).first() ).toBeVisible( {
		timeout: 45_000,
	} );
}

/**
 * @param {import('@playwright/test').Page} page
 */
export async function clearEditorChatStorage( page ) {
	await page.evaluate( () => {
		const prefix = 'nfd-editor-chat-active-';
		for ( const key of Object.keys( localStorage ) ) {
			if ( key.startsWith( prefix ) ) {
				localStorage.removeItem( key );
			}
		}
	} );
}

/**
 * @param {import('@playwright/test').Page} page
 */
export async function saveFromEditorChatHeader( page ) {
	const customSave = page.locator( SELECTORS.saveButton );
	if ( await customSave.isVisible().catch( () => false ) ) {
		await expect( customSave ).toBeEnabled( { timeout: 30_000 } );
		await customSave.click();
	} else {
		const publish = page.getByRole( 'button', { name: /^Publish$/i } ).first();
		await expect( publish ).toBeEnabled( { timeout: 30_000 } );
		await publish.click();
		const confirm = page.getByRole( 'button', { name: /^Publish$/i } ).last();
		if ( await confirm.isVisible().catch( () => false ) ) {
			await confirm.click();
		}
	}
	await page.waitForFunction(
		() => {
			const editor = window.wp?.data?.select( 'core/editor' );
			if ( ! editor ) {
				return true;
			}
			const saving = editor.isSavingPost?.();
			const dirty = editor.isEditedPostDirty?.();
			return ! saving && ! dirty;
		},
		{ timeout: 60_000 }
	);
}

/**
 * Remove every stored conversation so each history test starts empty.
 */
export async function clearStoredConversations() {
	await wordpress.wpCli(
		`eval 'global $wpdb; $wpdb->query( "DELETE FROM {$wpdb->prefix}nfd_editor_chats" );'`,
		{ failOnNonZeroExit: true }
	);
}

/**
 * Move a page to the trash (not a force delete), as "Move to trash" does.
 *
 * @param {number} postId
 */
export async function trashPage( postId ) {
	await wordpress.wpCli( `post delete ${ postId }`, { failOnNonZeroExit: true } );
}

/**
 * Call the conversations REST API as the logged-in editor.
 *
 * @param {import('@playwright/test').Page} page
 * @param {string} path Path after `/conversations`, e.g. `` or `/12`.
 * @return {Promise<{status: number, body: any}>}
 */
export async function conversationsRequest( page, path = '' ) {
	return page.evaluate( async ( subPath ) => {
		const { nfdRestURL, nonce } = window.nfdEditorChat;
		// nfdRestURL already carries `?rest_route=`, so only plain sub-paths are supported.
		const response = await fetch( `${ nfdRestURL }/conversations${ subPath }`, {
			headers: { 'X-WP-Nonce': nonce },
			credentials: 'same-origin',
		} );
		let body = null;
		try {
			body = await response.json();
		} catch {
			// Non-JSON body.
		}
		return { status: response.status, body };
	}, path );
}

/**
 * Wait until a chat starting with `titleText` is stored with its messages
 * (the save is debounced), and return its id.
 *
 * @param {import('@playwright/test').Page} page
 * @param {string} titleText First user message of the chat.
 * @return {Promise<number>} Conversation id.
 */
export async function waitForSavedConversation( page, titleText ) {
	let id = 0;
	await expect
		.poll(
			async () => {
				const list = await conversationsRequest( page );
				const item = list.body?.items?.find( ( row ) => row.title.startsWith( titleText ) );
				if ( ! item ) {
					return 0;
				}
				const full = await conversationsRequest( page, `/${ item.id }` );
				const stored = full.body?.messages?.messages || [];
				// The user message and the assistant reply are both stored.
				id = stored.length >= 2 ? item.id : 0;
				return id;
			},
			{ timeout: 30_000, message: 'chat was not saved to the server' }
		)
		.toBeGreaterThan( 0 );
	return id;
}

/**
 * Open the chat history list in the editor toolbar.
 *
 * @param {import('@playwright/test').Page} page
 */
export async function openChatHistory( page ) {
	await page.getByRole( 'button', { name: 'Chat history' } ).click();
	await expect( page.locator( SELECTORS.historyList ) ).toBeVisible();
}
