<?php

/**
 * Single User Content Part
 *
 * @package bbPress
 * @subpackage Theme
 */

?>

<h1>
	<?php if ( bbp_is_favorites()                 ) echo 'Favorite Forum Topics'; ?>
	<?php if ( bbp_is_subscriptions()             ) echo 'Forum Subscriptions'; ?>
	<?php if ( bbp_is_single_user_topics()        ) echo 'Forum Topics Started'; ?>
	<?php if ( bbp_is_single_user_replies()       ) echo 'Forum Replies Created'; ?>
	<?php if ( bbp_is_single_user_edit()          ) echo 'Edit Profile'; ?>
	<?php if ( bbp_is_single_user_profile()       ) echo bbp_displayed_user_field( 'display_name' )."'s Profile"; ?>
</h1>

<div id="bbpress-forums">

	<div id="row">

		<div class="col-sm-9 col-sm-push-3">
			<?php do_action( 'bbp_template_notices' ); ?>
			<?php if ( bbp_is_favorites()                 ) bbp_get_template_part( 'user', 'favorites'       ); ?>
			<?php if ( bbp_is_subscriptions()             ) bbp_get_template_part( 'user', 'subscriptions'   ); ?>
			<?php if ( bbp_is_single_user_topics()        ) bbp_get_template_part( 'user', 'topics-created'  ); ?>
			<?php if ( bbp_is_single_user_replies()       ) bbp_get_template_part( 'user', 'replies-created' ); ?>
			<?php if ( bbp_is_single_user_edit()          ) bbp_get_template_part( 'form', 'user-edit'       ); ?>
			<?php if ( bbp_is_single_user_profile()       ) bbp_get_template_part( 'user', 'profile'         ); ?>
		</div>
		
		<div class="col-sm-3 col-sm-pull-9">
			<?php bbp_get_template_part( 'user', 'details' ); ?>
		</div>
		
	</div>
</div>
