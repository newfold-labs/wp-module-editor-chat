/* eslint-disable no-console */

/**
 * Pattern Library service — pre-fetched index with in-memory search.
 *
 * Provider abstraction allows swapping the pattern source (e.g. WonderBlocks)
 * by adding a new class to the PROVIDERS map and setting
 * window.nfdEditorChat.patternProvider to its key.
 */

/**
 * WonderBlocks pattern provider.
 *
 * Fetches an index (without markup) from the REST API on init,
 * performs client-side scoring for search, and fetches full markup on demand.
 */
class WonderBlocksProvider {
	constructor() {
		this.index = null;
	}

	/**
	 * Fetch the lightweight pattern index (no content field).
	 *
	 * @return {Promise<Array>} Array of pattern objects without content.
	 */
	async fetchIndex() {
		const response = await wp.apiFetch({
			path: "/nfd-wonder-blocks/v1/pattern-index",
		});
		this.index = response;
		return response;
	}

	/**
	 * Search the in-memory index using keyword scoring.
	 *
	 * @param {string} query         Search query (space-separated words).
	 * @param {Object} opts          Options.
	 * @param {string} opts.category Optional category filter.
	 * @param {number} opts.limit    Max results (default 15).
	 * @return {{ results: Array, totalMatches: number }} Matching patterns and total count.
	 */
	search(query, { category, limit = 15 } = {}) {
		if (!this.index) {
			return { results: [], totalMatches: 0 };
		}

		const queryWords = query
			.toLowerCase()
			.split(/\s+/)
			.filter(Boolean);
		const fullQuery = queryWords.join(" ");

		const scored = this.index
			.filter((p) => !category || p.categories?.includes(category))
			.map((p) => {
				let score = 0;
				const title = (p.title || "").toLowerCase();
				const desc = (p.description || "").toLowerCase();
				const tags = (p.tags || []).map((t) => t.toLowerCase());
				const cats = (p.categories || []).map((c) => c.toLowerCase());

				for (const w of queryWords) {
					// Category: exact match only
					if (cats.some((c) => c === w)) {
						score += 10;
					}

					// Tag: exact match bonus vs partial
					if (tags.some((t) => t === w)) {
						score += 6;
					} else if (tags.some((t) => t.includes(w))) {
						score += 3;
					}

					// Title: word boundary match
					const titleWordRe = new RegExp(`\\b${w}`);
					if (titleWordRe.test(title)) {
						score += 5;
					}

					// Description: boosted for rich descriptions
					if (desc.includes(w)) {
						score += 2;
					}
				}

				// Multi-word phrase bonus
				if (queryWords.length > 1) {
					if (title.includes(fullQuery)) {
						score += 8;
					}
					if (desc.includes(fullQuery)) {
						score += 4;
					}
				}

				return { ...p, _score: score };
			})
			.filter((p) => p._score > 0)
			.sort((a, b) => b._score - a._score || Math.random() - 0.5);

		const totalMatches = scored.length;

		return {
			results: scored.slice(0, limit).map(({ _score, ...rest }) => rest),
			totalMatches,
		};
	}

	/**
	 * Fetch full markup for a single pattern by slug.
	 *
	 * @param {string} slug Pattern slug.
	 * @return {Promise<Object>} Pattern object with content.
	 */
	async getMarkup(slug) {
		const response = await wp.apiFetch({
			path: `/nfd-wonder-blocks/v1/pattern-by-slug?slug=${encodeURIComponent(slug)}`,
		});
		return response;
	}
}

/**
 * Registry of available pattern providers.
 * Add new providers here and reference them via window.nfdEditorChat.patternProvider.
 */
const PROVIDERS = {
	wonderblocks: WonderBlocksProvider,
};

/**
 * Singleton Pattern Library manager.
 *
 * Initializes the configured provider, pre-fetches the index, and exposes
 * search() and getMarkup() for client-side use in the editor chat hook.
 */
class PatternLibrary {
	constructor() {
		this.provider = null;
	}

	/**
	 * Initialize the pattern library with the given provider.
	 *
	 * @param {string} providerName Key in the PROVIDERS map (default: 'wonderblocks').
	 */
	async initialize(providerName = "wonderblocks") {
		const Provider = PROVIDERS[providerName];
		if (!Provider) {
			console.warn(`[PatternLibrary] Unknown provider: ${providerName}`);
			return;
		}
		this.provider = new Provider();
		await this.provider.fetchIndex();
	}

	/**
	 * Whether the index has been loaded and is ready for search.
	 *
	 * @return {boolean} True if the index is loaded and ready for search.
	 */
	isReady() {
		return this.provider?.index !== null;
	}

	/**
	 * Search the pattern index.
	 *
	 * @param {string} query Search query.
	 * @param {Object} opts  Search options (category, limit).
	 * @return {Array} Matching patterns.
	 */
	search(query, opts) {
		return this.provider?.search(query, opts) || [];
	}

	/**
	 * Fetch full markup for a pattern by slug.
	 *
	 * @param {string} slug Pattern slug.
	 * @return {Promise<Object>} Pattern with content.
	 */
	async getMarkup(slug) {
		return this.provider?.getMarkup(slug);
	}
}

export default new PatternLibrary();
