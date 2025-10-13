<?php

use NewfoldLabs\WP\ModuleLoader\Container;
use NewfoldLabs\WP\Module\EditorChat\Application;

if ( function_exists( 'add_action' ) ) {
	add_action(
		'newfold_container_set',
		function ( Container $container ) {
			new Application( $container );
		}
	);
}