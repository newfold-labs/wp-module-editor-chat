/**
 * Editor-chat module Playwright helpers (re-export plugin helpers + module flows).
 */
import { createRequire } from 'module';
import { existsSync } from 'fs';
import { join } from 'path';

const pluginDir = process.env.PLUGIN_DIR || process.cwd();
const requireFromPlugin = createRequire( join( pluginDir, 'package.json' ) );
const helpersEntry = existsSync( join( pluginDir, 'tests/playwright/helpers/index.mjs' ) )
	? './tests/playwright/helpers/index.mjs'
	: './tests/playwright/helpers/index.js';
const pluginHelpers = requireFromPlugin( helpersEntry );

export const { auth, wordpress, newfold, a11y, utils } = pluginHelpers;
export const clearInstallerQueues = newfold.clearInstallerQueues;

export * from './editor-chat-flow.js';
export {
	createMockWorkerState,
	installEditorChatWorkerMocks,
} from './mock-editor-chat-worker.js';
