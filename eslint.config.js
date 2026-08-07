const wordpress = require( '@wordpress/eslint-plugin' );

module.exports = [
	...wordpress.configs.recommended,
	{
		rules: {
			'import/no-unresolved': 'off',
			'import/no-extraneous-dependencies': 'off',
			// Allow `== null` / `!= null` for nullish checks; keep === elsewhere.
			eqeqeq: [ 'error', 'always', { null: 'ignore' } ],
			'no-console': [ 'warn', { allow: [ 'warn', 'error' ] } ],
			'no-unused-vars': [
				'error',
				{ argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
			],
		},
	},
];
