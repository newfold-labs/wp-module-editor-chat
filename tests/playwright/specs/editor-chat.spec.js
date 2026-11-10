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
	expectParagraphInCanvas,
	getFirstHeadingClientId,
	getFirstParagraphClientId,
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
	wordpress,
} from '../helpers/index.js';

const DISABLE_ABILITIES_MU_PLUGIN = 'nfd-editor-chat-disable-editor-abilities.php';

async function removeDisabledAbilitiesPlugin() {
	await wordpress.wpCli(
		`eval '$path = WPMU_PLUGIN_DIR . "/${ DISABLE_ABILITIES_MU_PLUGIN }"; if ( file_exists( $path ) && ! unlink( $path ) ) { WP_CLI::error( "Could not remove editor abilities test plugin." ); }'`,
		{ failOnNonZeroExit: true }
	);
	const verification = await wordpress.wpCli(
		`eval '$path = WPMU_PLUGIN_DIR . "/${ DISABLE_ABILITIES_MU_PLUGIN }"; if ( file_exists( $path ) ) { WP_CLI::error( "Editor abilities test plugin is still installed." ); } echo "absent";'`,
		{ failOnNonZeroExit: true }
	);
	if ( String( verification ).trim() !== 'absent' ) {
		throw new Error( 'Could not verify editor abilities test plugin cleanup.' );
	}
}

async function installDisabledAbilitiesPlugin() {
	const source =
		"<?php\nadd_filter( 'nfd_editor_chat_editor_abilities_enabled', '__return_false' );\n";
	const encoded = Buffer.from( source ).toString( 'base64' );
	await wordpress.wpCli(
		`eval 'wp_mkdir_p( WPMU_PLUGIN_DIR ); file_put_contents( WPMU_PLUGIN_DIR . "/${ DISABLE_ABILITIES_MU_PLUGIN }", base64_decode( "${ encoded }" ) );'`,
		{ failOnNonZeroExit: true }
	);
}

test.describe( 'Editor chat (Site Editor)', { tag: '@env-local' }, () => {
	test.describe.configure( { mode: 'serial', timeout: 180 * 1000 } );
	test.use( { storageState: AUTH_FILE } );

	let postId = 0;
	let wordpressVersion = '';
	const mockState = createMockWorkerState();

	test.beforeAll( async ( { browser } ) => {
		await prepareEditorChatTestEnvironment();
		wordpressVersion = String(
			await wordpress.wpCli( 'core version', { failOnNonZeroExit: true } )
		).trim();
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
		await removeDisabledAbilitiesPlugin();
		await deleteTestPage( postId );
		await clearInstallerQueues();
	} );

	test.beforeEach( async ( { page }, testInfo ) => {
		await removeDisabledAbilitiesPlugin();
		const isDisabledScenario = testInfo.title.includes( 'disabled filter' );
		const isLocalScenario =
			! isDisabledScenario && testInfo.title.includes( 'local editor abilities' );
		if ( isDisabledScenario ) {
			await installDisabledAbilitiesPlugin();
		}

		mockState.scenario = 'edit';
		if ( isDisabledScenario ) {
			mockState.scenario = 'disabled-editor-abilities';
		} else if ( isLocalScenario ) {
			mockState.scenario = 'local-editor-abilities';
		}
		mockState.headingClientId = null;
		mockState.paragraphClientId = null;
		mockState.newHeadingText = 'Updated by AI chat';
		mockState.newParagraphText = 'Updated locally by AI chat';
		mockState.requestedToolNames = [];

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
			mockState.paragraphClientId = await getFirstParagraphClientId( page );
			expect( mockState.headingClientId ).toBeTruthy();
			expect( mockState.paragraphClientId ).toBeTruthy();
		}
	} );

	test.afterEach( async () => {
		await removeDisabledAbilitiesPlugin();
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

	test( 'local editor abilities update a paragraph without /blu/mcp', async ( { page } ) => {
		test.skip( Number( wordpressVersion.split( '.' )[ 0 ] ) < 7, 'Editor abilities require WordPress 7.0 or newer.' );

		const registeredNames = await page.evaluate( () => window.nfdEditorAbilities?.ready );
		expect( registeredNames ).toContain( 'blu-editor/get-editor-tree' );

		const webMcpToolNames = await page.evaluate( async () => {
			const bridgeReady = window.nfdEditorAbilities?.webmcp;
			if ( ! bridgeReady ) {
				throw new Error( 'Editor abilities WebMCP bridge did not initialize.' );
			}
			await bridgeReady;
			const tools = await document.modelContext?.getTools?.();
			return Array.isArray( tools ) ? tools.map( ( tool ) => tool.name ) : [];
		} );
		expect( webMcpToolNames ).toContain( 'blu-editor_get-editor-tree' );

		const mcpRequests = [];
		page.on( 'request', ( request ) => {
			if ( new URL( request.url() ).pathname.includes( '/blu/mcp' ) ) {
				mcpRequests.push( request.url() );
			}
		} );

		await sendChatMessage( page, 'Update the paragraph locally' );
		await expectParagraphInCanvas( page, mockState.newParagraphText );
		await waitForChatTurnIdle( page );

		expect( mockState.requestedToolNames ).toContain( 'blu-editor_update-block' );
		expect( mcpRequests ).toEqual( [] );
	} );

	test( 'local editor abilities disabled filter preserves the legacy handler path', async ( {
		page,
	} ) => {
		const registeredNames = await page.evaluate( () => window.nfdEditorAbilities?.ready ?? null );
		expect( registeredNames ).toBeNull();

		const webMcpToolNames = await page.evaluate( async () => {
			const tools = await document.modelContext?.getTools?.();
			return Array.isArray( tools ) ? tools.map( ( tool ) => tool.name ) : [];
		} );
		expect( webMcpToolNames ).not.toContain( 'blu-editor_update-block' );

		await sendChatMessage( page, 'Update the paragraph with the existing editor handler' );
		await expectParagraphInCanvas( page, mockState.newParagraphText );
		await waitForChatTurnIdle( page );

		// Which legacy tools the server MCP lists depends on the installed
		// wp-module-mcp version, so assert only that no local ability was offered.
		expect(
			mockState.requestedToolNames.filter( ( name ) => name.startsWith( 'blu-editor_' ) )
		).toEqual( [] );
	} );
} );
