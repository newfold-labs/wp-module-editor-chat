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
};

module.exports = merge(wpScriptsConfig, nfdChatEditorWebpackConfig);
