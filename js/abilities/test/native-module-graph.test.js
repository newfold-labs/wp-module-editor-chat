/* global describe, expect, test */

const fs = require("fs");
const path = require("path");

const runtimeRoot = path.resolve(__dirname, "..");

function runtimeFiles(directory) {
	return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
		const resolved = path.join(directory, entry.name);
		if (entry.isDirectory()) {
			return entry.name === "test" ? [] : runtimeFiles(resolved);
		}
		return entry.name.endsWith(".js") ? [resolved] : [];
	});
}

describe("native browser module graph", () => {
	test("uses explicit extensions for every resolvable relative module URL", () => {
		const failures = [];
		const specifierPattern = /(?:import|export)\s+(?:[\s\S]*?\s+from\s+)?["'](\.[^"']+)["']/g;

		for (const file of runtimeFiles(runtimeRoot)) {
			const source = fs.readFileSync(file, "utf8");
			for (const match of source.matchAll(specifierPattern)) {
				const specifier = match[1];
				const resolved = path.resolve(path.dirname(file), specifier);
				if (!path.extname(specifier)) {
					failures.push(`${path.relative(runtimeRoot, file)}: ${specifier} has no extension`);
				} else if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) {
					failures.push(`${path.relative(runtimeRoot, file)}: ${specifier} does not resolve`);
				}
			}
		}

		expect(failures).toEqual([]);
	});
});
