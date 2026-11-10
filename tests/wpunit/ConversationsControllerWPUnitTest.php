<?php

namespace NewfoldLabs\WP\Module\EditorChat;

use NewfoldLabs\WP\Module\EditorChat\Database\EditorChatTable;
use NewfoldLabs\WP\Module\EditorChat\RestApi\ConversationsController;

/**
 * ConversationsController wpunit tests (REST contract, scoping, pagination).
 *
 * @coversDefaultClass \NewfoldLabs\WP\Module\EditorChat\RestApi\ConversationsController
 */
class ConversationsControllerWPUnitTest extends \lucatume\WPBrowser\TestCase\WPTestCase {

	const BASE = '/nfd-editor-chat/v1/conversations';

	/**
	 * Editor user id.
	 *
	 * @var int
	 */
	private $editor_id;

	/**
	 * Second editor user id.
	 *
	 * @var int
	 */
	private $other_editor_id;

	/**
	 * Set up the table, users and a fresh REST server with our routes.
	 *
	 * @return void
	 */
	public function setUp(): void {
		parent::setUp();

		EditorChatTable::maybe_upgrade();
		global $wpdb;
		$table = EditorChatTable::get_table_name();
		// phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared, WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching -- test cleanup.
		$wpdb->query( "DELETE FROM {$table}" );

		$this->editor_id       = $this->factory()->user->create( array( 'role' => 'editor' ) );
		$this->other_editor_id = $this->factory()->user->create( array( 'role' => 'editor' ) );
		\wp_set_current_user( $this->editor_id );

		global $wp_rest_server;
		$wp_rest_server = null;
		\add_action( 'rest_api_init', array( ConversationsController::class, 'register_routes' ) );
		\rest_get_server();
	}

	/**
	 * Remove the hook and reset the REST server.
	 *
	 * @return void
	 */
	public function tearDown(): void {
		\remove_action( 'rest_api_init', array( ConversationsController::class, 'register_routes' ) );
		global $wp_rest_server;
		$wp_rest_server = null;
		parent::tearDown();
	}

	/**
	 * Dispatch a REST request.
	 *
	 * @param string $method HTTP method.
	 * @param string $path   Route path.
	 * @param array  $params Request params.
	 * @return \WP_REST_Response
	 */
	private function request( $method, $path, array $params = array() ) {
		$request = new \WP_REST_Request( $method, $path );
		foreach ( $params as $key => $value ) {
			$request->set_param( $key, $value );
		}
		return \rest_do_request( $request );
	}

	/**
	 * Same algorithm the controller uses for the site hash.
	 *
	 * @return string
	 */
	private function site_hash() {
		$parsed = \wp_parse_url( (string) \get_site_url() );
		return \substr( \md5( ( $parsed['host'] ?? '' ) . ( $parsed['path'] ?? '' ) ), 0, 8 );
	}

	/**
	 * Insert a row directly.
	 *
	 * @param array $overrides Column overrides.
	 * @return int Row id.
	 */
	private function insert_row( array $overrides = array() ) {
		global $wpdb;
		$row = array_merge(
			array(
				'user_id'               => $this->editor_id,
				'site_url_hash'         => $this->site_hash(),
				'post_id'               => 7,
				'post_type'             => 'page',
				'post_modified_seen_at' => '2026-11-10 10:00:00',
				'title'                 => 'Original title',
				'messages'              => \wp_json_encode(
					array(
						'messages' => array(
							array(
								'role'    => 'user',
								'content' => 'orig',
							),
						),
						'history'  => array(
							array(
								'role'    => 'user',
								'content' => 'orig',
							),
						),
					)
				),
				'created_at'            => '2026-11-10 10:00:00',
				'updated_at'            => '2026-11-10 10:00:00',
			),
			$overrides
		);
		$wpdb->insert( EditorChatTable::get_table_name(), $row ); // phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery -- test helper.
		return (int) $wpdb->insert_id;
	}

	/**
	 * Fetch a raw row.
	 *
	 * @param int $id Row id.
	 * @return object|null
	 */
	private function raw_row( $id ) {
		global $wpdb;
		$table = EditorChatTable::get_table_name();
		// phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared, WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching -- test helper.
		return $wpdb->get_row( $wpdb->prepare( "SELECT * FROM {$table} WHERE id = %d", $id ) );
	}

	/**
	 * Valid create params.
	 *
	 * @return array
	 */
	private function create_params() {
		return array(
			'post_id'               => 7,
			'post_type'             => 'page',
			'post_modified_seen_at' => '2026-11-10 10:00:00',
		);
	}

	/**
	 * Non editor gets 403.
	 *
	 * @return void
	 */
	public function test_non_editor_gets_403() {
		\wp_set_current_user( $this->factory()->user->create( array( 'role' => 'subscriber' ) ) );
		$this->assertSame( 403, $this->request( 'POST', self::BASE, $this->create_params() )->get_status() );
		$this->assertSame( 403, $this->request( 'GET', self::BASE . '/1' )->get_status() );
	}

	/**
	 * Logged out gets 401.
	 *
	 * @return void
	 */
	public function test_logged_out_gets_401() {
		\wp_set_current_user( 0 );
		$this->assertSame( 401, $this->request( 'POST', self::BASE, $this->create_params() )->get_status() );
	}

	/**
	 * Create returns id and binds current user.
	 *
	 * @return void
	 */
	public function test_create_returns_id_and_binds_current_user() {
		$params                  = $this->create_params();
		$params['user_id']       = $this->other_editor_id;
		$params['site_url_hash'] = 'ffffffff';

		$response = $this->request( 'POST', self::BASE, $params );

		$this->assertSame( 200, $response->get_status() );
		$id  = $response->get_data()['id'];
		$row = $this->raw_row( $id );
		$this->assertSame( (string) $this->editor_id, $row->user_id );
		$this->assertSame( $this->site_hash(), $row->site_url_hash );
		$this->assertSame( '', $row->title );
		$this->assertSame(
			array(
				'messages' => array(),
				'history'  => array(),
			),
			\json_decode( $row->messages, true )
		);
	}

	/**
	 * Create without required params is 400.
	 *
	 * @return void
	 */
	public function test_create_without_required_params_is_400() {
		$response = $this->request( 'POST', self::BASE, array( 'post_type' => 'page' ) );
		$this->assertSame( 400, $response->get_status() );
		$this->assertSame( 'missing_params', $response->get_data()['code'] );
	}

	/**
	 * Get returns full row with post status.
	 *
	 * @return void
	 */
	public function test_get_returns_full_row_with_post_status() {
		$post_id = $this->factory()->post->create( array( 'post_type' => 'page' ) );
		$id      = $this->insert_row( array( 'post_id' => $post_id ) );

		$data = $this->request( 'GET', self::BASE . "/{$id}" )->get_data();

		$this->assertSame( $id, $data['id'] );
		$this->assertSame( $post_id, $data['post_id'] );
		$this->assertSame( 'page', $data['post_type'] );
		$this->assertSame( '2026-11-10 10:00:00', $data['post_modified_seen_at'] );
		$this->assertSame( 'Original title', $data['title'] );
		$this->assertSame( 'orig', $data['messages']['messages'][0]['content'] );
		$this->assertSame( 'orig', $data['messages']['history'][0]['content'] );
		$this->assertTrue( $data['post_exists'] );
		$this->assertSame( 'publish', $data['post_status'] );
	}

	/**
	 * Get reports post exists false for trashed post.
	 *
	 * @return void
	 */
	public function test_get_reports_post_exists_false_for_trashed_post() {
		$post_id = $this->factory()->post->create( array( 'post_type' => 'page' ) );
		$id      = $this->insert_row( array( 'post_id' => $post_id ) );
		\wp_trash_post( $post_id );

		$data = $this->request( 'GET', self::BASE . "/{$id}" )->get_data();

		$this->assertFalse( $data['post_exists'] );
		$this->assertSame( 'trash', $data['post_status'] );
	}

	/**
	 * Get reports post exists false for missing post.
	 *
	 * @return void
	 */
	public function test_get_reports_post_exists_false_for_missing_post() {
		$id = $this->insert_row( array( 'post_id' => 999999 ) );

		$data = $this->request( 'GET', self::BASE . "/{$id}" )->get_data();

		$this->assertFalse( $data['post_exists'] );
		$this->assertNull( $data['post_status'] );
	}

	/**
	 * Get other users row is 404.
	 *
	 * @return void
	 */
	public function test_get_other_users_row_is_404() {
		$id = $this->insert_row( array( 'user_id' => $this->other_editor_id ) );
		$this->assertSame( 404, $this->request( 'GET', self::BASE . "/{$id}" )->get_status() );
	}

	/**
	 * Get row from other site hash is 404.
	 *
	 * @return void
	 */
	public function test_get_row_from_other_site_hash_is_404() {
		$id = $this->insert_row( array( 'site_url_hash' => 'deadbeef' ) );
		$this->assertSame( 404, $this->request( 'GET', self::BASE . "/{$id}" )->get_status() );
	}

	/**
	 * Put replaces messages and sets title.
	 *
	 * @return void
	 */
	public function test_put_replaces_messages_and_sets_title() {
		$id = $this->insert_row( array( 'title' => '' ) );

		$response = $this->request(
			'PUT',
			self::BASE . "/{$id}",
			array(
				'messages'              => array(
					array(
						'role'    => 'assistant',
						'content' => 'hi',
					),
					array(
						'role'    => 'user',
						'content' => 'Make the hero section bigger',
					),
				),
				'history'               => array(
					array(
						'role'    => 'user',
						'content' => 'Make the hero section bigger',
					),
				),
				'post_modified_seen_at' => '2026-11-10 11:30:00',
			)
		);

		$this->assertSame( 200, $response->get_status() );
		$this->assertSame( $id, $response->get_data()['id'] );
		$row = $this->raw_row( $id );
		$this->assertSame( 'Make the hero section bigger', $row->title );
		$this->assertSame( '2026-11-10 11:30:00', $row->post_modified_seen_at );
		$stored = \json_decode( $row->messages, true );
		$this->assertCount( 2, $stored['messages'] );
		$this->assertCount( 1, $stored['history'] );
		$this->assertSame( $row->updated_at, $response->get_data()['updated_at'] );
	}

	/**
	 * Put truncates long title to 60 chars with ellipsis.
	 *
	 * @return void
	 */
	public function test_put_truncates_long_title_to_60_chars_with_ellipsis() {
		$id = $this->insert_row( array( 'title' => '' ) );

		$this->request(
			'PUT',
			self::BASE . "/{$id}",
			array(
				'messages' => array(
					array(
						'role'    => 'user',
						'content' => str_repeat( 'a', 80 ),
					),
				),
				'history'  => array(),
			)
		);

		$this->assertSame( str_repeat( 'a', 60 ) . '…', $this->raw_row( $id )->title );
	}

	/**
	 * Put keeps existing title.
	 *
	 * @return void
	 */
	public function test_put_keeps_existing_title() {
		$id = $this->insert_row();

		$this->request(
			'PUT',
			self::BASE . "/{$id}",
			array(
				'messages' => array(
					array(
						'role'    => 'user',
						'content' => 'something else',
					),
				),
				'history'  => array(),
			)
		);

		$this->assertSame( 'Original title', $this->raw_row( $id )->title );
	}

	/**
	 * Put without timestamp keeps existing watermark.
	 *
	 * @return void
	 */
	public function test_put_without_timestamp_keeps_existing_watermark() {
		$id = $this->insert_row();

		$this->request(
			'PUT',
			self::BASE . "/{$id}",
			array(
				'messages' => array(),
				'history'  => array(),
			)
		);

		$this->assertSame( '2026-11-10 10:00:00', $this->raw_row( $id )->post_modified_seen_at );
	}

	/**
	 * Put invalid messages is 400 and row unchanged.
	 *
	 * @return void
	 */
	public function test_put_invalid_messages_is_400_and_row_unchanged() {
		$id     = $this->insert_row();
		$before = $this->raw_row( $id );

		$response = $this->request(
			'PUT',
			self::BASE . "/{$id}",
			array(
				'messages' => 'not-an-array',
				'history'  => array(),
			)
		);

		$this->assertSame( 400, $response->get_status() );
		$this->assertSame( 'invalid_messages', $response->get_data()['code'] );
		$this->assertEquals( $before, $this->raw_row( $id ) );
	}

	/**
	 * Put invalid timestamp is 400.
	 *
	 * @return void
	 */
	public function test_put_invalid_timestamp_is_400() {
		$id = $this->insert_row();

		$response = $this->request(
			'PUT',
			self::BASE . "/{$id}",
			array(
				'messages'              => array(),
				'history'               => array(),
				'post_modified_seen_at' => 'yesterday',
			)
		);

		$this->assertSame( 400, $response->get_status() );
		$this->assertSame( 'invalid_timestamp', $response->get_data()['code'] );
	}

	/**
	 * Put other users row is 404 and unchanged.
	 *
	 * @return void
	 */
	public function test_put_other_users_row_is_404_and_unchanged() {
		$id     = $this->insert_row( array( 'user_id' => $this->other_editor_id ) );
		$before = $this->raw_row( $id );

		$response = $this->request(
			'PUT',
			self::BASE . "/{$id}",
			array(
				'messages' => array(
					array(
						'role'    => 'user',
						'content' => 'hijack',
					),
				),
				'history'  => array(),
			)
		);

		$this->assertSame( 404, $response->get_status() );
		$this->assertEquals( $before, $this->raw_row( $id ) );
	}

	/**
	 * Delete soft deletes and subsequent get is 404.
	 *
	 * @return void
	 */
	public function test_delete_soft_deletes_and_subsequent_get_is_404() {
		$id = $this->insert_row();

		$response = $this->request( 'DELETE', self::BASE . "/{$id}" );

		$this->assertSame( 200, $response->get_status() );
		$this->assertSame(
			array(
				'id'      => $id,
				'deleted' => true,
			),
			$response->get_data()
		);
		$this->assertNotNull( $this->raw_row( $id )->deleted_at );
		$this->assertSame( 404, $this->request( 'GET', self::BASE . "/{$id}" )->get_status() );
		$this->assertSame(
			404,
			$this->request(
				'PUT',
				self::BASE . "/{$id}",
				array(
					'messages' => array(),
					'history'  => array(),
				)
			)->get_status()
		);
	}

	/**
	 * Delete other users row is 404 and untouched.
	 *
	 * @return void
	 */
	public function test_delete_other_users_row_is_404_and_untouched() {
		$id = $this->insert_row( array( 'user_id' => $this->other_editor_id ) );

		$this->assertSame( 404, $this->request( 'DELETE', self::BASE . "/{$id}" )->get_status() );
		$this->assertNull( $this->raw_row( $id )->deleted_at );
	}

	/**
	 * List excludes messages, soft-deleted rows and other users' rows.
	 *
	 * @return void
	 */
	public function test_list_excludes_messages_and_soft_deleted_and_other_users() {
		$mine = $this->insert_row();
		$this->insert_row( array( 'user_id' => $this->other_editor_id ) );
		$this->insert_row( array( 'site_url_hash' => 'deadbeef' ) );
		$this->insert_row( array( 'deleted_at' => '2026-11-10 12:00:00' ) );

		$data = $this->request( 'GET', self::BASE )->get_data();

		$this->assertCount( 1, $data['items'] );
		$this->assertSame( $mine, $data['items'][0]['id'] );
		$this->assertSame(
			array( 'id', 'title', 'post_id', 'post_type', 'post_modified_seen_at', 'updated_at' ),
			array_keys( $data['items'][0] )
		);
		$this->assertNull( $data['next_cursor'] );
	}

	/**
	 * List is ordered newest first.
	 *
	 * @return void
	 */
	public function test_list_orders_newest_first() {
		$old = $this->insert_row( array( 'updated_at' => '2026-11-01 10:00:00' ) );
		$new = $this->insert_row( array( 'updated_at' => '2026-11-09 10:00:00' ) );
		$mid = $this->insert_row( array( 'updated_at' => '2026-11-05 10:00:00' ) );

		$ids = wp_list_pluck( $this->request( 'GET', self::BASE )->get_data()['items'], 'id' );

		$this->assertSame( array( $new, $mid, $old ), $ids );
	}

	/**
	 * Pages never duplicate or skip rows that share an updated_at.
	 *
	 * @return void
	 */
	public function test_list_paginates_without_gaps_or_duplicates_with_identical_updated_at() {
		$expected = array();
		for ( $i = 0; $i < 5; $i++ ) {
			$expected[] = $this->insert_row( array( 'updated_at' => '2026-11-10 10:00:00' ) );
		}

		$seen   = array();
		$cursor = null;
		for ( $guard = 0; $guard < 10; $guard++ ) {
			$params = array( 'limit' => 2 );
			if ( $cursor ) {
				$params['cursor'] = $cursor;
			}
			$data = $this->request( 'GET', self::BASE, $params )->get_data();
			$seen = array_merge( $seen, wp_list_pluck( $data['items'], 'id' ) );
			if ( ! $data['next_cursor'] ) {
				break;
			}
			$cursor = $data['next_cursor'];
		}

		sort( $expected );
		$sorted_seen = $seen;
		sort( $sorted_seen );
		$this->assertSame( $expected, $sorted_seen );
		$this->assertCount( 5, array_unique( $seen ) );
	}

	/**
	 * Limit is capped at 20.
	 *
	 * @return void
	 */
	public function test_list_limit_is_capped_at_20() {
		for ( $i = 0; $i < 22; $i++ ) {
			$this->insert_row();
		}

		$data = $this->request( 'GET', self::BASE, array( 'limit' => 500 ) )->get_data();

		$this->assertCount( 20, $data['items'] );
		$this->assertNotNull( $data['next_cursor'] );
	}

	/**
	 * Default limit is 20 when none is given.
	 *
	 * @return void
	 */
	public function test_list_default_limit_is_20() {
		for ( $i = 0; $i < 21; $i++ ) {
			$this->insert_row();
		}

		$this->assertCount( 20, $this->request( 'GET', self::BASE )->get_data()['items'] );
	}

	/**
	 * A malformed cursor behaves as no cursor.
	 *
	 * @return void
	 */
	public function test_list_malformed_cursor_returns_first_page() {
		$id = $this->insert_row();

		$data = $this->request( 'GET', self::BASE, array( 'cursor' => '%%%not-base64%%%' ) )->get_data();

		$this->assertSame( array( $id ), wp_list_pluck( $data['items'], 'id' ) );
	}

	/**
	 * Non-editors cannot list.
	 *
	 * @return void
	 */
	public function test_list_non_editor_gets_403() {
		\wp_set_current_user( $this->factory()->user->create( array( 'role' => 'subscriber' ) ) );
		$this->assertSame( 403, $this->request( 'GET', self::BASE )->get_status() );
	}
}
