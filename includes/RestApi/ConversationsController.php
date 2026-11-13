<?php

namespace NewfoldLabs\WP\Module\EditorChat\RestApi;

use NewfoldLabs\WP\Module\EditorChat\Database\EditorChatTable;
use NewfoldLabs\WP\Module\EditorChat\Permissions;

/**
 * REST controller for server-side editor chat conversations.
 *
 * Every query is scoped to the current user AND the current site (a
 * server-computed hash) — client-supplied identity is never trusted. Rows
 * that do not match return 404, never 403, so the existence of another
 * user's conversation is never revealed.
 */
final class ConversationsController {

	const REST_NAMESPACE = 'nfd-editor-chat/v1';

	/**
	 * Accepted format for page-modified timestamps.
	 */
	const TIMESTAMP_PATTERN = '/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/';

	/**
	 * Default and maximum page size for the list endpoint.
	 */
	const LIST_MAX_LIMIT = 20;

	/**
	 * Maximum title length before truncation.
	 */
	const TITLE_MAX_LENGTH = 60;

	/**
	 * Register the conversation routes.
	 *
	 * @return void
	 */
	public static function register_routes() {
		$permission = function () {
			return Permissions::is_editor();
		};

		\register_rest_route(
			self::REST_NAMESPACE,
			'/conversations',
			array(
				array(
					'methods'             => \WP_REST_Server::READABLE,
					'callback'            => array( __CLASS__, 'list_conversations' ),
					'permission_callback' => $permission,
				),
				array(
					'methods'             => \WP_REST_Server::CREATABLE,
					'callback'            => array( __CLASS__, 'create_conversation' ),
					'permission_callback' => $permission,
				),
			)
		);

		\register_rest_route(
			self::REST_NAMESPACE,
			'/conversations/(?P<id>\d+)',
			array(
				array(
					'methods'             => \WP_REST_Server::READABLE,
					'callback'            => array( __CLASS__, 'get_conversation' ),
					'permission_callback' => $permission,
				),
				array(
					'methods'             => \WP_REST_Server::EDITABLE,
					'callback'            => array( __CLASS__, 'update_conversation' ),
					'permission_callback' => $permission,
				),
				array(
					'methods'             => \WP_REST_Server::DELETABLE,
					'callback'            => array( __CLASS__, 'delete_conversation' ),
					'permission_callback' => $permission,
				),
			)
		);
	}

	/**
	 * Site hash for the current site: md5 of host + path (scheme excluded so
	 * http/https requests to the same site agree), first 8 characters.
	 *
	 * @return string
	 */
	private static function get_site_hash() {
		$parsed     = \wp_parse_url( (string) \get_site_url() );
		$normalized = ( $parsed['host'] ?? '' ) . ( $parsed['path'] ?? '' );
		return \substr( \md5( $normalized ), 0, 8 );
	}

	/**
	 * Find a conversation row scoped to the current user and site, excluding
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
	 * Standard 404 error for a missing (or not-yours) conversation.
	 *
	 * @return \WP_Error
	 */
	private static function not_found() {
		return new \WP_Error(
			'not_found',
			\__( 'Conversation not found.', 'nfd-editor-chat' ),
			array( 'status' => 404 )
		);
	}

	/**
	 * Derive a title from the first user message with content.
	 *
	 * @param array $messages UI messages (each has role/type + content).
	 * @return string Empty when no user message has content.
	 */
	private static function derive_title( array $messages ) {
		foreach ( $messages as $message ) {
			if ( ! \is_array( $message ) ) {
				continue;
			}
			$role = $message['role'] ?? ( $message['type'] ?? '' );
			if ( 'user' !== $role || empty( $message['content'] ) || ! \is_string( $message['content'] ) ) {
				continue;
			}
			$content = \trim( $message['content'] );
			if ( '' === $content ) {
				continue;
			}
			return \mb_strlen( $content ) > self::TITLE_MAX_LENGTH
				? \mb_substr( $content, 0, self::TITLE_MAX_LENGTH ) . '…'
				: $content;
		}
		return '';
	}

	/**
	 * Encode an opaque pagination cursor from an (updated_at, id) pair.
	 *
	 * @param string $updated_at Row updated_at.
	 * @param int    $id         Row id.
	 * @return string
	 */
	private static function encode_cursor( $updated_at, $id ) {
		// phpcs:ignore WordPress.PHP.DiscouragedPHPFunctions.obfuscation_base64_encode -- opaque pagination cursor, not obfuscation.
		return \base64_encode( $updated_at . '|' . (int) $id );
	}

	/**
	 * Decode and validate a pagination cursor.
	 *
	 * @param string $cursor Raw cursor param.
	 * @return array|null array( 'updated_at' => string, 'id' => int ), or null when absent or malformed.
	 */
	private static function decode_cursor( $cursor ) {
		if ( '' === $cursor ) {
			return null;
		}
		// phpcs:ignore WordPress.PHP.DiscouragedPHPFunctions.obfuscation_base64_decode -- opaque pagination cursor, not obfuscation.
		$decoded = \base64_decode( $cursor, true );
		if ( false === $decoded ) {
			return null;
		}
		$parts = \explode( '|', $decoded );
		if ( 2 !== \count( $parts ) || ! \preg_match( self::TIMESTAMP_PATTERN, $parts[0] ) || ! \ctype_digit( $parts[1] ) ) {
			return null;
		}
		return array(
			'updated_at' => $parts[0],
			'id'         => (int) $parts[1],
		);
	}

	/**
	 * GET /conversations — cursor-paginated metadata list (no messages).
	 *
	 * @param \WP_REST_Request $request The REST request.
	 * @return \WP_REST_Response
	 */
	public static function list_conversations( \WP_REST_Request $request ) {
		global $wpdb;
		$table = EditorChatTable::get_table_name();

		$limit = (int) $request->get_param( 'limit' );
		if ( $limit <= 0 || $limit > self::LIST_MAX_LIMIT ) {
			$limit = self::LIST_MAX_LIMIT;
		}

		$cursor = self::decode_cursor( (string) $request->get_param( 'cursor' ) );
		$select = 'SELECT id, title, post_id, post_type, post_modified_seen_at, updated_at FROM ' . $table;
		$scope  = 'WHERE user_id = %d AND site_url_hash = %s AND deleted_at IS NULL';
		$args   = array( \get_current_user_id(), self::get_site_hash() );

		if ( $cursor ) {
			$scope .= ' AND (updated_at < %s OR (updated_at = %s AND id < %d))';
			$args[] = $cursor['updated_at'];
			$args[] = $cursor['updated_at'];
			$args[] = $cursor['id'];
		}
		$args[] = $limit;

		$rows = $wpdb->get_results(
			// phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared, WordPress.DB.PreparedSQL.InterpolatedNotPrepared -- $select/$scope are fixed strings built above; values go through placeholders.
			$wpdb->prepare( "{$select} {$scope} ORDER BY updated_at DESC, id DESC LIMIT %d", $args ),
			ARRAY_A
		);

		$items = \array_map(
			function ( $row ) {
				return array(
					'id'                    => (int) $row['id'],
					'title'                 => $row['title'],
					'post_id'               => (int) $row['post_id'],
					'post_type'             => $row['post_type'],
					'post_modified_seen_at' => $row['post_modified_seen_at'],
					'updated_at'            => $row['updated_at'],
				);
			},
			(array) $rows
		);

		$next_cursor = null;
		if ( \count( $items ) === $limit ) {
			$last        = $items[ $limit - 1 ];
			$next_cursor = self::encode_cursor( $last['updated_at'], $last['id'] );
		}

		return \rest_ensure_response(
			array(
				'items'       => $items,
				'next_cursor' => $next_cursor,
			)
		);
	}

	/**
	 * POST /conversations — create an empty conversation row.
	 *
	 * @param \WP_REST_Request $request The REST request.
	 * @return \WP_REST_Response|\WP_Error
	 */
	public static function create_conversation( \WP_REST_Request $request ) {
		$post_id   = (int) $request->get_param( 'post_id' );
		$post_type = \sanitize_key( (string) $request->get_param( 'post_type' ) );
		$seen_at   = (string) $request->get_param( 'post_modified_seen_at' );

		if ( $post_id <= 0 || '' === $post_type || ! \preg_match( self::TIMESTAMP_PATTERN, $seen_at ) ) {
			return new \WP_Error(
				'missing_params',
				\__( 'post_id, post_type and post_modified_seen_at are required.', 'nfd-editor-chat' ),
				array( 'status' => 400 )
			);
		}

		global $wpdb;
		$now = \current_time( 'mysql', true );

		$inserted = $wpdb->insert(
			EditorChatTable::get_table_name(),
			array(
				'user_id'               => \get_current_user_id(),
				'site_url_hash'         => self::get_site_hash(),
				'post_id'               => $post_id,
				'post_type'             => $post_type,
				'post_modified_seen_at' => $seen_at,
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

		if ( ! $inserted ) {
			return new \WP_Error(
				'create_failed',
				\__( 'Could not create the conversation.', 'nfd-editor-chat' ),
				array( 'status' => 500 )
			);
		}

		return \rest_ensure_response( array( 'id' => (int) $wpdb->insert_id ) );
	}

	/**
	 * GET /conversations/{id} — full conversation including messages.
	 *
	 * @param \WP_REST_Request $request The REST request.
	 * @return \WP_REST_Response|\WP_Error
	 */
	public static function get_conversation( \WP_REST_Request $request ) {
		$row = self::find_row( (int) $request['id'] );
		if ( ! $row ) {
			return self::not_found();
		}

		$post        = \get_post( (int) $row->post_id );
		$post_status = $post ? $post->post_status : null;

		return \rest_ensure_response(
			array(
				'id'                    => (int) $row->id,
				'post_id'               => (int) $row->post_id,
				'post_type'             => $row->post_type,
				'post_modified_seen_at' => $row->post_modified_seen_at,
				'title'                 => $row->title,
				'messages'              => \json_decode( $row->messages, true ),
				'created_at'            => $row->created_at,
				'updated_at'            => $row->updated_at,
				'post_exists'           => null !== $post_status && 'trash' !== $post_status,
				'post_status'           => $post_status,
			)
		);
	}

	/**
	 * PUT /conversations/{id} — replace messages/history, bump updated_at.
	 *
	 * @param \WP_REST_Request $request The REST request.
	 * @return \WP_REST_Response|\WP_Error
	 */
	public static function update_conversation( \WP_REST_Request $request ) {
		$row = self::find_row( (int) $request['id'] );
		if ( ! $row ) {
			return self::not_found();
		}

		$messages = $request->get_param( 'messages' );
		$history  = $request->get_param( 'history' );
		if ( ! \is_array( $messages ) || ! \is_array( $history ) ) {
			return new \WP_Error(
				'invalid_messages',
				\__( 'messages and history must be arrays.', 'nfd-editor-chat' ),
				array( 'status' => 400 )
			);
		}

		$payload = \wp_json_encode(
			array(
				'messages' => $messages,
				'history'  => $history,
			)
		);
		if ( false === $payload ) {
			return new \WP_Error(
				'invalid_messages',
				\__( 'messages could not be encoded.', 'nfd-editor-chat' ),
				array( 'status' => 400 )
			);
		}

		$data    = array(
			'messages'   => $payload,
			'updated_at' => \current_time( 'mysql', true ),
		);
		$formats = array( '%s', '%s' );

		$seen_at = $request->get_param( 'post_modified_seen_at' );
		if ( null !== $seen_at ) {
			if ( ! \is_string( $seen_at ) || ! \preg_match( self::TIMESTAMP_PATTERN, $seen_at ) ) {
				return new \WP_Error(
					'invalid_timestamp',
					\__( 'post_modified_seen_at must be formatted as YYYY-MM-DD HH:MM:SS.', 'nfd-editor-chat' ),
					array( 'status' => 400 )
				);
			}
			$data['post_modified_seen_at'] = $seen_at;
			$formats[]                     = '%s';
		}

		if ( '' === $row->title ) {
			$title = self::derive_title( $messages );
			if ( '' !== $title ) {
				$data['title'] = $title;
				$formats[]     = '%s';
			}
		}

		global $wpdb;
		$updated = $wpdb->update(
			EditorChatTable::get_table_name(),
			$data,
			array( 'id' => (int) $row->id ),
			$formats,
			array( '%d' )
		);

		if ( false === $updated ) {
			return new \WP_Error(
				'update_failed',
				\__( 'Could not save the conversation.', 'nfd-editor-chat' ),
				array( 'status' => 500 )
			);
		}

		return \rest_ensure_response(
			array(
				'id'         => (int) $row->id,
				'updated_at' => $data['updated_at'],
			)
		);
	}

	/**
	 * DELETE /conversations/{id} — soft-delete.
	 *
	 * @param \WP_REST_Request $request The REST request.
	 * @return \WP_REST_Response|\WP_Error
	 */
	public static function delete_conversation( \WP_REST_Request $request ) {
		$row = self::find_row( (int) $request['id'] );
		if ( ! $row ) {
			return self::not_found();
		}

		global $wpdb;
		$updated = $wpdb->update(
			EditorChatTable::get_table_name(),
			array( 'deleted_at' => \current_time( 'mysql', true ) ),
			array( 'id' => (int) $row->id ),
			array( '%s' ),
			array( '%d' )
		);

		if ( false === $updated ) {
			return new \WP_Error(
				'delete_failed',
				\__( 'Could not delete the conversation.', 'nfd-editor-chat' ),
				array( 'status' => 500 )
			);
		}

		return \rest_ensure_response(
			array(
				'id'      => (int) $row->id,
				'deleted' => true,
			)
		);
	}
}
