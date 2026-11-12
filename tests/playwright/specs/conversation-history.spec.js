import { createRequire } from 'module';
import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { mkdir } from 'fs/promises';
import { join, dirname } from 'path';

const pluginDir = process.env.PLUGIN_DIR || process.cwd();
const requireFromPlugin = createRequire( join( pluginDir, 'package.json' ) );
const { test, expect } = requireFromPlugin( '@playwright/test' );

/** Separate from editor-chat.spec.js so both specs can run in parallel workers. */
const AUTH_FILE = join( pluginDir, 'tests/playwright/.auth/conversation-history-admin.json' );

mkdirSync( dirname( AUTH_FILE ), { recursive: true } );
if ( ! existsSync( AUTH_FILE ) ) {
	writeFileSync( AUTH_FILE, JSON.stringify( { cookies: [], origins: [] } ) );
}
import {
	auth,
	clearEditorChatStorage,
	clearInstallerQueues,
	clearStoredConversations,
	conversationsRequest,
	createHeadingTestPage,
	createMockWorkerState,
	deleteTestPage,
	getFirstHeadingClientId,
	installEditorChatWorkerMocks,
	navigateToEditorChat,
	openChatHistory,
	prepareEditorChatTestEnvironment,
	resetHeadingTestPageContent,
	saveFromEditorChatHeader,
	SELECTORS,
	sendChatMessage,
	trashPage,
	waitForChatTurnIdle,
	waitForSavedConversation,
} from '../helpers/index.js';

const MESSAGE = 'Change the heading for the history test';

test.describe( 'Editor chat conversation history', { tag: '@env-local' }, () => {
	test.describe.configure( { mode: 'serial', timeout: 180 * 1000 } );
	test.use( { storageState: AUTH_FILE } );

	let pageA = 0;
	let pageB = 0;
	const mockState = createMockWorkerState();

	/**
	 * Send one message on the open editor, wait for the turn, save the page
	 * (the mocked edit leaves it dirty) and wait until the chat is stored.
	 *
	 * @param {import('@playwright/test').Page} page
	 * @return {Promise<number>} Conversation id.
	 */
	async function chatAndWaitForSave( page ) {
		mockState.headingClientId = await getFirstHeadingClientId( page );
		await sendChatMessage( page, MESSAGE );
		await waitForChatTurnIdle( page );
		await saveFromEditorChatHeader( page );
		return waitForSavedConversation( page, MESSAGE );
	}

	test.beforeAll( async ( { browser } ) => {
		await prepareEditorChatTestEnvironment();
		pageA = ( await createHeadingTestPage( 'Playwright History A' ) ).postId;
		pageB = ( await createHeadingTestPage( 'Playwright History B' ) ).postId;

		await mkdir( dirname( AUTH_FILE ), { recursive: true } );
		const context = await browser.newContext();
		const page = await context.newPage();
		await auth.loginToWordPress( page );
		await auth.saveAuthState( page, AUTH_FILE );
		await context.close();
	} );

	test.afterAll( async () => {
		await clearStoredConversations();
		await deleteTestPage( pageA );
		await deleteTestPage( pageB );
		await clearInstallerQueues();
	} );

	test.beforeEach( async ( { page } ) => {
		mockState.scenario = 'edit';
		mockState.headingClientId = null;
		mockState.newHeadingText = 'Updated by AI chat';
		mockState.requestedToolNames = [];

		await clearStoredConversations();
		await resetHeadingTestPageContent( pageA );
		await resetHeadingTestPageContent( pageB );

		await page.unrouteAll();
		await installEditorChatWorkerMocks( page, mockState );
		await navigateToEditorChat( page, pageA );
		if ( page.url().includes( '/wp-login.php' ) ) {
			await auth.loginToWordPress( page, { force: true } );
			await navigateToEditorChat( page, pageA );
		}
		await clearEditorChatStorage( page );
	} );

	test( 'saves the chat to the server bound to the open page', async ( { page } ) => {
		const id = await chatAndWaitForSave( page );

		const full = await conversationsRequest( page, `/${ id }` );
		expect( full.status ).toBe( 200 );
		expect( full.body.post_id ).toBe( pageA );
		expect( full.body.post_type ).toBe( 'page' );
		expect( full.body.title ).toBe( MESSAGE );
		expect( full.body.post_exists ).toBe( true );
	} );

	test( 'resumes a chat from the history on the same page', async ( { page } ) => {
		await chatAndWaitForSave( page );

		await page.locator( SELECTORS.newChatButton ).click();
		await expect( page.locator( SELECTORS.userMessage ) ).toHaveCount( 0 );

		await openChatHistory( page );
		const row = page.locator( SELECTORS.historyRow ).filter( { hasText: MESSAGE } );
		await expect( row ).toHaveCount( 1 );
		await row.locator( SELECTORS.historySelect ).click();

		await expect( page.locator( SELECTORS.userMessage ).filter( { hasText: MESSAGE } ) ).toBeVisible();
		await expect( page.locator( SELECTORS.resumeNotice ).filter( { hasText: /different page/ } ) ).toHaveCount( 0 );
		await expect( page.locator( SELECTORS.chatTextarea ) ).toBeEnabled();
	} );

	test( 'deletes a chat from the history', async ( { page } ) => {
		const id = await chatAndWaitForSave( page );

		await openChatHistory( page );
		const row = page.locator( SELECTORS.historyRow ).filter( { hasText: MESSAGE } );
		await row.hover();
		await row.locator( SELECTORS.historyDelete ).click();

		await expect( page.locator( SELECTORS.historyRow ) ).toHaveCount( 0 );
		await expect( page.getByText( 'No previous chats yet.' ) ).toBeVisible();

		// Soft deleted: the API no longer returns it, and it stays gone after a reload.
		await expect
			.poll( async () => ( await conversationsRequest( page, `/${ id }` ) ).status )
			.toBe( 404 );
		await page.reload( { waitUntil: 'domcontentloaded' } );
		await navigateToEditorChat( page, pageA );
		await openChatHistory( page );
		await expect( page.locator( SELECTORS.historyRow ) ).toHaveCount( 0 );
	} );

	test( 'prompts when a chat belongs to a different page', async ( { page } ) => {
		await chatAndWaitForSave( page );

		await clearEditorChatStorage( page );
		await navigateToEditorChat( page, pageB );

		// Continue here: the chat opens read-only and the input is locked.
		await openChatHistory( page );
		await page
			.locator( SELECTORS.historyRow )
			.filter( { hasText: MESSAGE } )
			.locator( SELECTORS.historySelect )
			.click();
		const prompt = page.locator( SELECTORS.resumeNotice ).filter( { hasText: /different page/ } );
		await expect( prompt ).toBeVisible();
		await prompt.getByRole( 'button', { name: 'Continue here (read-only)' } ).click();

		await expect( page.locator( SELECTORS.userMessage ).filter( { hasText: MESSAGE } ) ).toBeVisible();
		await expect(
			page.locator( SELECTORS.resumeNotice ).filter( { hasText: /read-only on this page/ } )
		).toBeVisible();
		await expect( page.locator( SELECTORS.chatTextarea ) ).toBeDisabled();

		// Open that page: navigates to the page the chat was about.
		await openChatHistory( page );
		await page
			.locator( SELECTORS.historyRow )
			.filter( { hasText: MESSAGE } )
			.locator( SELECTORS.historySelect )
			.click();
		await page
			.locator( SELECTORS.resumeNotice )
			.getByRole( 'button', { name: 'Open that page' } )
			.click();
		await page.waitForURL( new RegExp( `post=${ pageA }(&|$)` ), { timeout: 60_000 } );
	} );

	test( 'opens a chat whose page was trashed as read-only and lets the user delete it', async ( { page } ) => {
		const trashed = await createHeadingTestPage( 'Playwright History Trashed' );
		try {
			await navigateToEditorChat( page, trashed.postId );
			await clearEditorChatStorage( page );
			const id = await chatAndWaitForSave( page );

			await trashPage( trashed.postId );

			await clearEditorChatStorage( page );
			await navigateToEditorChat( page, pageA );
			await openChatHistory( page );
			await page
				.locator( SELECTORS.historyRow )
				.filter( { hasText: MESSAGE } )
				.locator( SELECTORS.historySelect )
				.click();

			const note = page.locator( SELECTORS.resumeNotice ).filter( { hasText: /no longer exists/ } );
			await expect( note ).toBeVisible();
			await expect( page.locator( SELECTORS.chatTextarea ) ).toBeDisabled();

			await note.getByRole( 'button', { name: 'Delete chat' } ).click();
			await expect( note ).toHaveCount( 0 );
			await expect
				.poll( async () => ( await conversationsRequest( page, `/${ id }` ) ).status )
				.toBe( 404 );
		} finally {
			await deleteTestPage( trashed.postId );
		}
	} );
} );
