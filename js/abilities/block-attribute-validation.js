function isPlainObject(value) {
	return !!value && typeof value === "object" && !Array.isArray(value);
}

function requireBlockType(blockName) {
	const type =
		window.wp?.blocks?.getBlockType?.(blockName) ??
		window.wp?.data?.select?.("core/blocks")?.getBlockType?.(blockName);
	if (!type) {
		throw new Error(`Unknown block type "${blockName ?? ""}".`);
	}
	return type;
}

function describeValue(value) {
	if (value === null) {
		return "null";
	}
	if (Array.isArray(value)) {
		return "an array";
	}
	return `a ${typeof value}`;
}

const TYPE_CHECKS = {
	string: (value) => typeof value === "string",
	"rich-text": (value) => typeof value === "string",
	number: (value) => typeof value === "number" && Number.isFinite(value),
	integer: Number.isInteger,
	boolean: (value) => typeof value === "boolean",
	array: Array.isArray,
	object: isPlainObject,
	null: (value) => value === null,
};

function matchesType(type, value) {
	return (Array.isArray(type) ? type : [type]).some((name) =>
		TYPE_CHECKS[name] ? TYPE_CHECKS[name](value) : true
	);
}

function normalizeObject(value, properties, path, fillDefaults = false) {
	if (!isPlainObject(value)) {
		throw new Error(`${path} must be an object, received ${describeValue(value)}.`);
	}
	const unknown = Object.keys(value).filter((key) => !(key in properties));
	if (unknown.length) {
		throw new Error(
			`${path} has unknown field(s): ${unknown.join(", ")}. Supported fields: ${Object.keys(
				properties
			).join(", ")}.`
		);
	}
	const result = {};
	for (const [key, definition] of Object.entries(properties)) {
		if (value[key] === undefined) {
			if (fillDefaults && definition?.default !== undefined) {
				result[key] = definition.default;
			} else if (fillDefaults && definition?.type === "object" && definition.properties) {
				const defaults = normalizeObject({}, definition.properties, `${path}.${key}`, true);
				if (Object.keys(defaults).length) {
					result[key] = defaults;
				}
			}
			continue;
		}
		result[key] = normalizeValue(value[key], definition, `${path}.${key}`, fillDefaults);
	}
	return result;
}

function normalizeValue(value, definition = {}, path, fillDefaults = false) {
	// Null is the public clearing sentinel, regardless of the stored value's type.
	if (value === null) {
		return null;
	}
	if (definition.type && !matchesType(definition.type, value)) {
		const expected = Array.isArray(definition.type)
			? definition.type.join(" or ")
			: definition.type;
		throw new Error(`${path} must be ${expected}, received ${describeValue(value)}.`);
	}
	if (definition.query && Array.isArray(value)) {
		return value.map((item, index) =>
			normalizeObject(item, definition.query, `${path}[${index}]`, true)
		);
	}
	if (definition.type === "object" && definition.properties) {
		return normalizeObject(value, definition.properties, path, fillDefaults);
	}
	return value;
}

/**
 * Validate a patch against the currently registered block schema.
 *
 * @param {string} blockName Registered block name.
 * @param {Object} patch     Attribute patch.
 * @return {Object} Normalized patch.
 */
export function normalizeAttributes(blockName, patch) {
	if (!isPlainObject(patch)) {
		throw new Error("attributes must be an object.");
	}
	const supported = requireBlockType(blockName).attributes || {};
	const unknown = Object.keys(patch).filter((key) => !(key in supported));
	if (unknown.length) {
		throw new Error(
			`Block "${blockName}" has unknown attribute(s): ${unknown.join(
				", "
			)}. Supported attributes: ${Object.keys(supported).join(", ")}.`
		);
	}
	return Object.fromEntries(
		Object.entries(patch).map(([key, value]) => [key, normalizeValue(value, supported[key], key)])
	);
}

function withColorConflictClears(current, patch) {
	const adjusted = { ...patch };
	const custom = adjusted.style?.color;
	const pairs = [
		["textColor", "text"],
		["backgroundColor", "background"],
		["gradient", "gradient"],
	];
	for (const [preset, customKey] of pairs) {
		if (
			custom &&
			Object.prototype.hasOwnProperty.call(custom, customKey) &&
			custom[customKey] !== null &&
			current[preset] !== undefined &&
			!Object.prototype.hasOwnProperty.call(adjusted, preset)
		) {
			adjusted[preset] = null;
		}
		if (
			Object.prototype.hasOwnProperty.call(adjusted, preset) &&
			adjusted[preset] !== null &&
			(current.style?.color?.[customKey] !== undefined ||
				Object.prototype.hasOwnProperty.call(adjusted.style?.color || {}, customKey))
		) {
			adjusted.style = {
				...adjusted.style,
				color: { ...adjusted.style?.color, [customKey]: null },
			};
		}
	}
	return adjusted;
}

function mergeObjects(current, patch) {
	const result = { ...current };
	for (const [key, value] of Object.entries(patch)) {
		if (value === null || value === undefined) {
			result[key] = undefined;
		} else if (isPlainObject(value)) {
			result[key] = mergeObjects(isPlainObject(result[key]) ? result[key] : {}, value);
		} else {
			result[key] = value;
		}
	}
	return result;
}

/**
 * Deep merge an attribute patch. Objects merge, arrays replace, and null
 * becomes an explicit undefined value so Gutenberg clears the stored key.
 *
 * @param {Object} current Current block attributes.
 * @param {Object} patch   Normalized patch.
 * @return {Object} Complete attributes for updateBlockAttributes.
 */
export function deepMergeAttributes(current, patch) {
	return mergeObjects(current, withColorConflictClears(current, patch));
}
