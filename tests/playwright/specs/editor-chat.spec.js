import { createRequire } from 'module';
import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { mkdir } from 'fs/promises';
import { join, dirname } from 'path';

const pluginDir = process.env.PLUGIN_DIR || process.cwd();
const requireFromPlugin = createRequire( join( pluginDir, 'package.json' ) );
const { test, expect } = requireFromPlugin( '@playwright/test' );

/** Stored under the brand plugin so Playwright can load it without import.meta. */
const AUTH_FILE = join( pluginDir, 'tests/playwright/.auth/editor-chat-admin.json' );

mkdirSync( dirname( AUTH_FILE ), { recursive: true } );
if ( ! existsSync( AUTH_FILE ) ) {
	writeFileSync( AUTH_FILE, JSON.stringify( { cookies: [], origins: [] } ) );
}
import {
	auth,
	clearInstallerQueues,
	clearEditorChatStorage,
	createHeadingTestPage,
	createMockWorkerState,
	deleteTestPage,
	expectHeadingInCanvas,
	getFirstHeadingClientId,
	installEditorChatWorkerMocks,
	navigateToSiteEditorChat,
	prepareEditorChatTestEnvironment,
	resetHeadingTestPageContent,
	setAsFrontPage,
	ORIGINAL_HEADING,
	saveFromEditorChatHeader,
	SELECTORS,
	sendChatMessage,
	waitForChatTurnIdle,
} from '../helpers/index.js';

test.describe( 'Editor chat (Site Editor)', { tag: '@env-local' }, () => {
	test.describe.configure( { mode: 'serial', timeout: 180 * 1000 } );
	test.use( { storageState: AUTH_FILE } );

	let postId = 0;
	const mockState = createMockWorkerState();

	test.beforeAll( async ( { browser } ) => {
		await prepareEditorChatTestEnvironment();
		const created = await createHeadingTestPage();
		postId = created.postId;
		await setAsFrontPage( postId );

		await mkdir( dirname( AUTH_FILE ), { recursive: true } );
		const context = await browser.newContext();
		const page = await context.newPage();
		await auth.loginToWordPress( page );
		await auth.saveAuthState( page, AUTH_FILE );
		await context.close();
	} );

	test.afterAll( async () => {
		await deleteTestPage( postId );
		await clearInstallerQueues();
	} );

	test.beforeEach( async ( { page } ) => {
		mockState.scenario = 'edit';
		mockState.headingClientId = null;
		mockState.newHeadingText = 'Updated by AI chat';

		await page.unrouteAll();
		await installEditorChatWorkerMocks( page, mockState );
		if ( postId ) {
			await resetHeadingTestPageContent( postId );
		}
		await navigateToSiteEditorChat( page );
		if ( page.url().includes( '/wp-login.php' ) ) {
			await auth.loginToWordPress( page, { force: true } );
			await navigateToSiteEditorChat( page );
		}
		await clearEditorChatStorage( page );

		if ( mockState.scenario !== 'error' ) {
			mockState.headingClientId = await getFirstHeadingClientId( page );
			expect( mockState.headingClientId ).toBeTruthy();
		}
	} );

	test( 'opens in the Site Editor and accepts a message', async ( { page } ) => {
		const message = 'Please update the heading text';
		await sendChatMessage( page, message );

		await expect( page.locator( SELECTORS.userMessage ).filter( { hasText: message } ) ).toBeVisible( {
			timeout: 15_000,
		} );
		await waitForChatTurnIdle( page );
	} );

	test( 'applies a mocked block edit visible in the canvas', async ( { page } ) => {
		await sendChatMessage( page, 'Change the heading' );

		await expectHeadingInCanvas( page, mockState.newHeadingText );
		await waitForChatTurnIdle( page );
		await expect( page.locator( SELECTORS.userMessage ) ).toHaveCount( 1 );
	} );

	test( 'persists the edit after save and reload', async ( { page } ) => {
		await sendChatMessage( page, 'Change the heading' );
		await expectHeadingInCanvas( page, mockState.newHeadingText );

		await waitForChatTurnIdle( page );
		await saveFromEditorChatHeader( page );
		await page.reload( { waitUntil: 'domcontentloaded' } );
		await navigateToSiteEditorChat( page, { expectedHeading: mockState.newHeadingText } );
	} );

	test( 'stop prevents a late edit from landing', async ( { page } ) => {
		mockState.scenario = 'stop';

		await sendChatMessage( page, 'Start a long edit' );
		await expect( page.locator( SELECTORS.stopButton ) ).toBeVisible( { timeout: 15_000 } );
		await page.locator( SELECTORS.stopButton ).click();

		await expect( page.locator( SELECTORS.stoppedNotice ) ).toContainText( 'Request stopped' );
		await expectHeadingInCanvas( page, ORIGINAL_HEADING );
	} );

	test( 'shows a worker error and leaves the page unchanged', async ( { page } ) => {
		mockState.scenario = 'error';

		await sendChatMessage( page, 'Trigger an error' );

		await expect( page.locator( SELECTORS.errorAlert ) ).toContainText(
			/Mock worker failure|500|error/i,
			{ timeout: 30_000 }
		);
		await expectHeadingInCanvas( page, ORIGINAL_HEADING );
	} );
} );
