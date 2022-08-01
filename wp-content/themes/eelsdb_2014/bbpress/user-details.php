<?php

/**
 * User Details
 *
 * @package bbPress
 * @subpackage Theme
 */

?>

	<?php do_action( 'bbp_template_before_user_details' ); ?>

	<div class="bbpress-user-sidenav">

		<ul class="nav nav-pills nav-stacked">
			<li class="<?php if ( bbp_is_single_user_profile() ) :?>active<?php endif; ?>">
				<a class="url fn n" href="<?php bbp_user_profile_url(); ?>" title="<?php printf( esc_attr__( "%s's Profile", 'bbpress' ), bbp_get_displayed_user_field( 'display_name' ) ); ?>" rel="me"><?php _e( 'View Profile', 'bbpress' ); ?></a>
			</li>
			
			<?php if ( bbp_is_user_home() || current_user_can( 'edit_users' ) ) : ?>
				<li class="<?php if ( bbp_is_single_user_edit() ) :?>active<?php endif; ?>">
					<a href="<?php bbp_user_profile_edit_url(); ?>" title="<?php printf( esc_attr__( "Edit %s's Profile", 'bbpress' ), bbp_get_displayed_user_field( 'display_name' ) ); ?>"><?php _e( 'Edit Profile', 'bbpress' ); ?></a>
				</li>
			<?php endif; ?>
			
			<li class="nav-divider"></li>
			
			<li>
				<a href="<?php echo get_author_posts_url( bbp_get_displayed_user_id() ); ?>" title="<?php echo bbp_get_displayed_user_field( 'display_name' ); ?>'s Uploaded Spectra">Uploaded Spectra</a>
			</li>

			<?php if ( bbp_is_user_home() ) : ?>
				<li>
					<a href="<?php echo get_author_posts_url( bbp_get_displayed_user_id() ); ?>?favourites" title="<?php echo bbp_get_displayed_user_field( 'display_name' ); ?>'s Favourite Spectra">Favourite Spectra</a>
				</li>
			<?php endif; ?>
			
			<li class="nav-divider"></li>
			
			<li class="<?php if ( bbp_is_single_user_topics() ) :?>active<?php endif; ?>">
				<a href="<?php bbp_user_topics_created_url(); ?>" title="<?php printf( esc_attr__( "%s's Topics Started", 'bbpress' ), bbp_get_displayed_user_field( 'display_name' ) ); ?>"><?php _e( 'Topics Started', 'bbpress' ); ?></a>
			</li>

			<li class="<?php if ( bbp_is_single_user_replies() ) :?>active<?php endif; ?>">
				<a href="<?php bbp_user_replies_created_url(); ?>" title="<?php printf( esc_attr__( "%s's Replies Created", 'bbpress' ), bbp_get_displayed_user_field( 'display_name' ) ); ?>"><?php _e( 'Replies Created', 'bbpress' ); ?></a>
			</li>

			<?php if ( bbp_is_favorites_active() ) : ?>
				<li class="<?php if ( bbp_is_favorites() ) :?>active<?php endif; ?>">
					<a href="<?php bbp_favorites_permalink(); ?>" title="<?php printf( esc_attr__( "%s's Favorite Forum Topics", 'bbpress' ), bbp_get_displayed_user_field( 'display_name' ) ); ?>"><?php _e( 'Favorite Topics', 'bbpress' ); ?></a>
				</li>
			<?php endif; ?>

			<?php if ( ( bbp_is_user_home() || current_user_can( 'edit_users' ) ) && bbp_is_subscriptions_active() ) : ?>
					<li class="<?php if ( bbp_is_subscriptions() ) :?>active<?php endif; ?>">
						<a href="<?php bbp_subscriptions_permalink(); ?>" title="<?php printf( esc_attr__( "%s's Subscriptions", 'bbpress' ), bbp_get_displayed_user_field( 'display_name' ) ); ?>"><?php _e( 'Subscriptions', 'bbpress' ); ?></a>
					</li>
			<?php endif; ?>
			
			<li class="nav-divider"></li>

		</ul>
		
		<div class="bbpress-avatar text-center hidden-xs">
			<a href="<?php bbp_user_profile_url(); ?>" title="<?php bbp_displayed_user_field( 'display_name' ); ?>" rel="me">
				<?php $avatar = get_avatar( bbp_get_displayed_user_field( 'user_email', 'raw' ), apply_filters( 'bbp_single_user_details_avatar_size', 150 ) );
				$avatar = str_replace("class='avatar avatar-150 photo", "class='img-thumbnail ", $avatar);
				echo $avatar;
				?>
			</a>
		</div><!-- #author-avatar -->
		
	</div><!-- #bbp-single-user-details -->

	<?php do_action( 'bbp_template_after_user_details' ); ?>
