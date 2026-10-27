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
 * @return {Promise<number>} Post ID
 */
export async function createHeadingTestPage() {
	const content =
		'<!-- wp:heading {"level":2} --><h2 class="wp-block-heading">' +
		ORIGINAL_HEADING +
		'</h2><!-- /wp:heading -->';
	const id = await wordpress.wpCli(
		`post create --post_type=page --post_status=publish --post_title="Playwright Editor Chat" --post_content='${ content }' --porcelain`,
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
		'</h2><!-- /wp:heading -->';
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
