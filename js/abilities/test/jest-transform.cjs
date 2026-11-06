const { transformSync } = require("esbuild");

module.exports = {
	process(source, filename) {
		return {
			code: transformSync(source, {
				format: "cjs",
				loader: "js",
				sourcefile: filename,
				sourcemap: "inline",
				target: "node22",
			}).code,
		};
	},
};
