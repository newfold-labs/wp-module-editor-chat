const path = require("path");
const { merge } = require("webpack-merge");
const wpScriptsConfig = require("@wordpress/scripts/config/webpack.config");
const version = require("./package.json").version; // never require full config!

const nfdChatEditorWebpackConfig = {
	output: {
		path: path.resolve(process.cwd(), `build/${version}`),
		library: ["newfold", "wordpress", "editor", "chat", "[name]"],
		libraryTarget: "window",
	},
	resolve: {
		alias: {
			// Ensure ai-chat module resolves to sibling vendor package
			"@newfold-labs/wp-module-ai-chat": path.resolve(__dirname, "../wp-module-ai-chat"),
		},
	},
};

module.exports = merge(wpScriptsConfig, nfdChatEditorWebpackConfig);
