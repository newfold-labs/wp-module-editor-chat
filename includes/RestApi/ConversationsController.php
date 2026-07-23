<?php

namespace NewfoldLabs\WP\Module\EditorChat\RestApi;

use NewfoldLabs\WP\Module\EditorChat\Database\EditorChatTable;

/**
 * REST controller for server-side editor chat conversations.
 *
 * Every query is scoped to the current user AND the current site (via a
 * server-computed hash) — client-supplied identity is never trusted. Rows
 * that don't match return 404, never 403, so existence of another user's
 * conversation is never revealed.
 */
final class ConversationsController {

	/**
	 * Compute the site hash for the current site. Same algorithm as
	 * wp-module-ai-chat's SiteHashHelper::short_hash() (md5, first 8 chars),
	 * kept as a local implementation to avoid a cross-module PHP dependency.
	 *
	 * Hashes host + path only, never the scheme: get_site_url() resolves its
	 * scheme via is_ssl() on the *current* request (WordPress core behavior),
	 * so the same site hashes differently on an http vs. https request unless
	 * the scheme is stripped first — which would silently split one site's
	 * history in two depending on how each request happened to arrive.
	 *
	 * @return string
	 */
	private static function get_site_hash() {
		$parsed     = \wp_parse_url( (string) \get_site_url() );
		$normalized = ( $parsed['host'] ?? '' ) . ( $parsed['path'] ?? '' );
		return \substr( \md5( $normalized ), 0, 8 );
	}

	/**
	 * Find a conversation row scoped to the current user + site, excluding
	 * soft-deleted rows.
	 *
	 * @param int $id Conversation id.
	 * @return object|null
	 */
	private static function find_row( $id ) {
		global $wpdb;
		$table = EditorChatTable::get_table_name();

		return $wpdb->get_row(
			$wpdb->prepare(
				// phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared -- $table is EditorChatTable::get_table_name(), not user input.
				"SELECT * FROM {$table} WHERE id = %d AND user_id = %d AND site_url_hash = %s AND deleted_at IS NULL",
				$id,
				\get_current_user_id(),
				self::get_site_hash()
			)
		);
	}

	/**
	 * Derive a title from the first user message, truncated to 60 chars.
	 *
	 * @param array $messages UI message array (each item has role/type + content).
	 * @return string Empty string if no user message with content is found.
	 */
	private static function derive_title( array $messages ) {
		foreach ( $messages as $message ) {
			$role = $message['role'] ?? ( $message['type'] ?? '' );
			if ( 'user' !== $role || empty( $message['content'] ) ) {
				continue;
			}
			$content = \trim( (string) $message['content'] );
			if ( '' === $content ) {
				continue;
			}
			return \mb_strlen( $content ) > 60 ? \mb_substr( $content, 0, 60 ) . '…' : $content;
		}
		return '';
	}

	/**
	 * Format a full DB row (incl. messages) for a single-conversation response.
	 *
	 * No edit_url here: this site edits "page" posts through a custom Site
	 * Editor URL scheme (?p=/page/{id}&referrer=...), not the classic
	 * get_edit_post_link() editor — building that URL is a client-side
	 * concern (see services/contentNavigation.js's getEditUrl()), which
	 * already knows the right scheme per post type.
	 *
	 * @param object $row Row from find_row().
	 * @return array
	 */
	private static function format_full_row( $row ) {
		$post        = \get_post( (int) $row->post_id );
		$post_status = $post ? $post->post_status : null;
		$post_exists = $post_status && 'trash' !== $post_status;

		return array(
			'id'                    => (int) $row->id,
			'post_id'               => (int) $row->post_id,
			'post_type'             => $row->post_type,
			'post_modified_seen_at' => $row->post_modified_seen_at,
			'title'                 => $row->title,
			'messages'              => \json_decode( $row->messages, true ),
			'created_at'            => $row->created_at,
			'updated_at'            => $row->updated_at,
			'post_exists'           => $post_exists,
			'post_status'           => $post_status,
		);
	}

	/**
	 * POST /conversations — create an empty conversation row.
	 *
	 * @param \WP_REST_Request $request The REST request.
	 * @return \WP_REST_Response|\WP_Error
	 */
	public static function create_conversation( \WP_REST_Request $request ) {
		$post_id               = (int) $request->get_param( 'post_id' );
		$post_type             = \sanitize_key( (string) $request->get_param( 'post_type' ) );
		$post_modified_seen_at = \sanitize_text_field( (string) $request->get_param( 'post_modified_seen_at' ) );

		if ( ! $post_id || '' === $post_type || '' === $post_modified_seen_at ) {
			return new \WP_Error(
				'missing_params',
				__( 'post_id, post_type and post_modified_seen_at are required.', 'nfd-editor-chat' ),
				array( 'status' => 400 )
			);
		}

		global $wpdb;
		$table = EditorChatTable::get_table_name();
		$now   = \current_time( 'mysql', true );

		$wpdb->insert(
			$table,
			array(
				'user_id'               => \get_current_user_id(),
				'site_url_hash'         => self::get_site_hash(),
				'post_id'               => $post_id,
				'post_type'             => $post_type,
				'post_modified_seen_at' => $post_modified_seen_at,
				'title'                 => '',
				'messages'              => \wp_json_encode(
					array(
						'messages' => array(),
						'history'  => array(),
					)
				),
				'created_at'            => $now,
				'updated_at'            => $now,
			),
			array( '%d', '%s', '%d', '%s', '%s', '%s', '%s', '%s', '%s' )
		);

		return new \WP_REST_Response( array( 'id' => (int) $wpdb->insert_id ), 201 );
	}

	/**
	 * GET /conversations/{id} — full conversation incl. messages and page status.
	 *
	 * @param \WP_REST_Request $request The REST request.
	 * @return \WP_REST_Response|\WP_Error
	 */
	public static function get_conversation( \WP_REST_Request $request ) {
		$row = self::find_row( (int) $request->get_param( 'id' ) );

		if ( ! $row ) {
			return new \WP_Error( 'not_found', __( 'Conversation not found.', 'nfd-editor-chat' ), array( 'status' => 404 ) );
		}

		return new \WP_REST_Response( self::format_full_row( $row ) );
	}

	/**
	 * PUT /conversations/{id} — replace messages, bump updated_at, optionally
	 * advance the post_modified_seen_at drift watermark.
	 *
	 * @param \WP_REST_Request $request The REST request.
	 * @return \WP_REST_Response|\WP_Error
	 */
	public static function update_conversation( \WP_REST_Request $request ) {
		$row = self::find_row( (int) $request->get_param( 'id' ) );
		if ( ! $row ) {
			return new \WP_Error( 'not_found', __( 'Conversation not found.', 'nfd-editor-chat' ), array( 'status' => 404 ) );
		}

		$messages_param = $request->get_param( 'messages' );
		if ( ! \is_array( $messages_param ) || ! isset( $messages_param['messages'] ) || ! \is_array( $messages_param['messages'] ) ) {
			return new \WP_Error(
				'invalid_messages',
				__( 'messages must be an object with a "messages" array.', 'nfd-editor-chat' ),
				array( 'status' => 400 )
			);
		}

		$history = ( isset( $messages_param['history'] ) && \is_array( $messages_param['history'] ) )
			? $messages_param['history']
			: array();

		global $wpdb;
		$table = EditorChatTable::get_table_name();

		$data    = array(
			'messages'   => \wp_json_encode(
				array(
					'messages' => $messages_param['messages'],
					'history'  => $history,
				)
			),
			'updated_at' => \current_time( 'mysql', true ),
		);
		$formats = array( '%s', '%s' );

		if ( '' === $row->title ) {
			$title = self::derive_title( $messages_param['messages'] );
			if ( '' !== $title ) {
				$data['title'] = $title;
				$formats[]     = '%s';
			}
		}

		$post_modified_seen_at = $request->get_param( 'post_modified_seen_at' );
		if ( $post_modified_seen_at ) {
			$data['post_modified_seen_at'] = \sanitize_text_field( (string) $post_modified_seen_at );
			$formats[]                     = '%s';
		}

		$wpdb->update( $table, $data, array( 'id' => (int) $row->id ), $formats, array( '%d' ) );

		return new \WP_REST_Response( array( 'success' => true ) );
	}

	/**
	 * DELETE /conversations/{id} — soft-delete via deleted_at.
	 *
	 * @param \WP_REST_Request $request The REST request.
	 * @return \WP_REST_Response|\WP_Error
	 */
	public static function delete_conversation( \WP_REST_Request $request ) {
		$row = self::find_row( (int) $request->get_param( 'id' ) );
		if ( ! $row ) {
			return new \WP_Error( 'not_found', __( 'Conversation not found.', 'nfd-editor-chat' ), array( 'status' => 404 ) );
		}

		global $wpdb;
		$table = EditorChatTable::get_table_name();
		$now   = \current_time( 'mysql', true );

		$wpdb->update(
			$table,
			array(
				'deleted_at' => $now,
				'updated_at' => $now,
			),
			array( 'id' => (int) $row->id ),
			array( '%s', '%s' ),
			array( '%d' )
		);

		return new \WP_REST_Response( null, 204 );
	}

	/**
	 * GET /conversations — cursor-paginated metadata list (no messages blob).
	 *
	 * @param \WP_REST_Request $request The REST request.
	 * @return \WP_REST_Response
	 */
	public static function list_conversations( \WP_REST_Request $request ) {
		global $wpdb;
		$table = EditorChatTable::get_table_name();

		$limit = (int) $request->get_param( 'limit' );
		if ( $limit <= 0 || $limit > 20 ) {
			$limit = 20;
		}

		$user_id   = \get_current_user_id();
		$site_hash = self::get_site_hash();
		$cursor    = self::decode_cursor( (string) $request->get_param( 'cursor' ) );

		$select = "SELECT id, title, post_id, post_type, post_modified_seen_at, created_at, updated_at FROM {$table}";

		if ( $cursor ) {
			$rows = $wpdb->get_results(
				$wpdb->prepare(
					// phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared -- $select embeds $table (EditorChatTable::get_table_name()), not user input.
					"{$select} WHERE user_id = %d AND site_url_hash = %s AND deleted_at IS NULL AND (updated_at, id) < (%s, %d) ORDER BY updated_at DESC, id DESC LIMIT %d",
					$user_id,
					$site_hash,
					$cursor['updated_at'],
					$cursor['id'],
					$limit
				)
			);
		} else {
			$rows = $wpdb->get_results(
				$wpdb->prepare(
					// phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared -- $select embeds $table (EditorChatTable::get_table_name()), not user input.
					"{$select} WHERE user_id = %d AND site_url_hash = %s AND deleted_at IS NULL ORDER BY updated_at DESC, id DESC LIMIT %d",
					$user_id,
					$site_hash,
					$limit
				)
			);
		}

		$items = \array_map(
			function ( $row ) {
				return array(
					'id'                    => (int) $row->id,
					'title'                 => $row->title,
					'post_id'               => (int) $row->post_id,
					'post_type'             => $row->post_type,
					'post_modified_seen_at' => $row->post_modified_seen_at,
					'created_at'            => $row->created_at,
					'updated_at'            => $row->updated_at,
				);
			},
			$rows
		);

		$next_cursor = null;
		if ( \count( $items ) === $limit ) {
			$last        = \end( $items );
			$next_cursor = self::encode_cursor( $last['updated_at'], $last['id'] );
		}

		return new \WP_REST_Response(
			array(
				'items'       => $items,
				'next_cursor' => $next_cursor,
			)
		);
	}

	/**
	 * Encode an opaque pagination cursor from an (updated_at, id) pair.
	 *
	 * @param string $updated_at MySQL datetime string.
	 * @param int    $id         Row id.
	 * @return string
	 */
	private static function encode_cursor( $updated_at, $id ) {
		// phpcs:ignore WordPress.PHP.DiscouragedPHPFunctions.obfuscation_base64_encode -- opaque pagination cursor, not obfuscation.
		return \base64_encode( $updated_at . '|' . $id );
	}

	/**
	 * Decode and validate an opaque pagination cursor.
	 *
	 * @param string $cursor Raw cursor param.
	 * @return array{updated_at: string, id: int}|null
	 */
	private static function decode_cursor( $cursor ) {
		if ( '' === $cursor ) {
			return null;
		}
		// phpcs:ignore WordPress.PHP.DiscouragedPHPFunctions.obfuscation_base64_decode -- opaque pagination cursor, not obfuscation.
		$decoded = \base64_decode( $cursor, true );
		if ( false === $decoded || false === \strpos( $decoded, '|' ) ) {
			return null;
		}
		list( $updated_at, $id ) = \explode( '|', $decoded, 2 );
		if ( ! \preg_match( '/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/', $updated_at ) || ! \ctype_digit( $id ) ) {
			return null;
		}
		return array(
			'updated_at' => $updated_at,
			'id'         => (int) $id,
		);
	}

	/**
	 * Register all conversation REST routes.
	 *
	 * @return void
	 */
	public static function register_routes() {
		\register_rest_route(
			'nfd-editor-chat/v1',
			'/conversations',
			array(
				array(
					'methods'             => \WP_REST_Server::READABLE,
					'callback'            => array( __CLASS__, 'list_conversations' ),
					'permission_callback' => function () {
						return \NewfoldLabs\WP\Module\EditorChat\Permissions::is_editor();
					},
				),
				array(
					'methods'             => \WP_REST_Server::CREATABLE,
					'callback'            => array( __CLASS__, 'create_conversation' ),
					'permission_callback' => function () {
						return \NewfoldLabs\WP\Module\EditorChat\Permissions::is_editor();
					},
				),
			)
		);

		\register_rest_route(
			'nfd-editor-chat/v1',
			'/conversations/(?P<id>\d+)',
			array(
				array(
					'methods'             => \WP_REST_Server::READABLE,
					'callback'            => array( __CLASS__, 'get_conversation' ),
					'permission_callback' => function () {
						return \NewfoldLabs\WP\Module\EditorChat\Permissions::is_editor();
					},
				),
				array(
					'methods'             => 'PUT',
					'callback'            => array( __CLASS__, 'update_conversation' ),
					'permission_callback' => function () {
						return \NewfoldLabs\WP\Module\EditorChat\Permissions::is_editor();
					},
				),
				array(
					'methods'             => \WP_REST_Server::DELETABLE,
					'callback'            => array( __CLASS__, 'delete_conversation' ),
					'permission_callback' => function () {
						return \NewfoldLabs\WP\Module\EditorChat\Permissions::is_editor();
					},
				),
			)
		);
	}
}
