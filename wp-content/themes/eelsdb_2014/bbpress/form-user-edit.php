<?php

/**
 * bbPress User Profile Edit Part
 *
 * @package bbPress
 * @subpackage Theme
 */

// Use a custom namespace so that we can override bbpress functions
// namespace CustomBBPressNamespace {

function eelsdb_bbp_edit_user_display_name() {
	ob_start();
	bbp_edit_user_display_name();
	$select = ob_get_contents();
	ob_end_clean();
	$select = str_replace('name="display_name"', 'class="form-control" name="display_name"', $select);
	echo $select;
}

$web_links = ['skype', 'twitter', 'linkedin', 'academia_edu', 'researchgate', 'google_scholar', 'orcid', 'researcherid', 'facebook', 'gplus'];

?>

<div class"row">
	<div class="col-sm-12 col-md-10 col-lg-8">
		<div class="alert alert-info">
			Please note that all fields will be visible on your profile page.
			Remember to press <strong>Update Profile</strong> at the bottom when you're finished.
		</div>
	</div>
</div>
<div class="clearfix"></div>

<form id="eels_bbpress_user_profile_form" action="<?php bbp_user_profile_edit_url( bbp_get_displayed_user_id() ); ?>" method="post" enctype="multipart/form-data" class="form-horizontal" role="form">

	<?php do_action( 'bbp_user_edit_before' ); ?>

	<!-- Nav tabs -->
	<ul class="nav nav-tabs" role="tablist">
	  <li class="active"><a href="#your_details" role="tab" data-toggle="tab"><?php _e( 'Your Details', 'bbpress' ) ?></a></li>
	  <li><a href="#contact_info" role="tab" data-toggle="tab"><?php _e( 'Contact Info', 'bbpress' ) ?></a></li>
	  <li><a href="#web_links" role="tab" data-toggle="tab"><?php _e( 'Web Links', 'bbpress' ) ?></a></li>
	  <li><a href="#about_yourself" role="tab" data-toggle="tab"><?php bbp_is_user_home_edit() ? _e( 'About Yourself', 'bbpress' ) : _e( 'About the user', 'bbpress' ); ?></a></li>
	  <li><a href="#password" role="tab" data-toggle="tab"><?php _e( 'Password', 'bbpress' ) ?></a></li>
	  <?php if ( current_user_can( 'edit_users' ) && ! bbp_is_user_home_edit() ) { ?>
	  	<li><a href="#user_role" role="tab" data-toggle="tab"><?php _e( 'User Role', 'bbpress' ); ?></a></li>
	  <?php } ?>
	</ul>

	<!-- Tab panes -->
	<div class="tab-content">
		<div class="tab-pane active" id="your_details">
			<fieldset>
				<legend><?php _e( 'Your Details', 'bbpress' ) ?></legend>

				<?php do_action( 'bbp_user_edit_before_name' ); ?>

				<div class="form-group">
					<label class="col-sm-2 control-label" for="first_name"><?php _e( 'First Name', 'bbpress' ) ?></label>
					<div class="col-sm-10 col-md-8 col-lg-6">
						<input class="form-control" type="text" name="first_name" id="first_name" value="<?php bbp_displayed_user_field( 'first_name', 'edit' ); ?>" tabindex="<?php bbp_tab_index(); ?>" />
					</div>
				</div>

				<div class="form-group">
					<label class="col-sm-2 control-label" for="last_name"><?php _e( 'Last Name', 'bbpress' ) ?></label>
					<div class="col-sm-10 col-md-8 col-lg-6">
						<input class="form-control" type="text" name="last_name" id="last_name" value="<?php bbp_displayed_user_field( 'last_name', 'edit' ); ?>" tabindex="<?php bbp_tab_index(); ?>" />
					</div>
				</div>

				<div class="form-group">
					<label class="col-sm-2 control-label" for="email"><?php _e( 'Email', 'bbpress' ); ?></label>
					<div class="col-sm-10 col-md-8 col-lg-6">
						<input class="form-control" type="email" name="email" id="email" value="<?php bbp_displayed_user_field( 'user_email', 'edit' ); ?>" class="regular-text" tabindex="<?php bbp_tab_index(); ?>" />
					</div>
					<?php
					// Handle address change requests
					$new_email = get_option( bbp_get_displayed_user_id() . '_new_email' );
					if ( !empty( $new_email ) && $new_email !== bbp_get_displayed_user_field( 'user_email', 'edit' ) ) : ?>
						<div class="alert alert-info">
							<?php printf( __( 'There is a pending email address change to <code>%1$s</code>. <a href="%2$s">Cancel</a>', 'bbpress' ), $new_email['newemail'], esc_url( self_admin_url( 'user.php?dismiss=' . bbp_get_current_user_id()  . '_new_email' ) ) ); ?>
						</div>
					<?php endif; ?>
				</div>

				<div class="form-group">
					<label class="col-sm-2 control-label" for="nickname"><?php _e( 'Nickname', 'bbpress' ); ?></label>
					<div class="col-sm-10 col-md-8 col-lg-6">
						<input class="form-control" type="text" name="nickname" id="nickname" value="<?php bbp_displayed_user_field( 'nickname', 'edit' ); ?>" tabindex="<?php bbp_tab_index(); ?>" />
					</div>
				</div>

				<div class="form-group" class="col-sm-2 control-label">
					<label class="col-sm-2 control-label" for="display_name"><?php _e( 'Display Name', 'bbpress' ) ?></label>
					<div class="col-sm-10 col-md-8 col-lg-6">
						<?php eelsdb_bbp_edit_user_display_name(); ?>
					</div>

				</div>

				<?php do_action( 'bbp_user_edit_after_name' ); ?>

			</fieldset>
		</div>

		<div class="tab-pane" id="contact_info">
			<fieldset>
				<legend><?php _e( 'Contact Info', 'bbpress' ) ?></legend>

				<?php do_action( 'bbp_user_edit_before_contact' ); ?>

				<div class="form-group">
					<label class="col-sm-2 control-label" for="url"><?php _e( 'Website', 'bbpress' ) ?></label>
					<div class="col-sm-10 col-md-8 col-lg-6">
						<input class="form-control" type="text" name="url" id="url" value="<?php bbp_displayed_user_field( 'user_url', 'edit' ); ?>" class="regular-text code" tabindex="<?php bbp_tab_index(); ?>" />
					</div>
				</div>

				<?php foreach ( bbp_edit_user_contact_methods() as $name => $desc ) :
					if(in_array($name, $web_links)){
						continue;
					} ?>

					<div class="form-group">
						<label class="col-sm-2 control-label" for="<?php echo esc_attr( $name ); ?>"><?php echo apply_filters( 'user_' . $name . '_label', $desc ); ?></label>
						<div class="col-sm-10 col-md-8 col-lg-6">
							<input class="form-control" type="text" name="<?php echo esc_attr( $name ); ?>" id="<?php echo esc_attr( $name ); ?>" value="<?php bbp_displayed_user_field( $name, 'edit' ); ?>" class="regular-text" tabindex="<?php bbp_tab_index(); ?>" />
						</div>
					</div>

				<?php endforeach; ?>

				<?php do_action( 'bbp_user_edit_after_contact' ); ?>

			</fieldset>
		</div>
		<div class="tab-pane" id="web_links">
			<fieldset>
				<legend><?php _e( 'Web Links', 'bbpress' ) ?></legend>
				<?php foreach ( bbp_edit_user_contact_methods() as $name => $desc ) :
					if(!in_array($name, $web_links)){
						continue;
					} ?>

					<div class="form-group">
						<label class="col-sm-2 control-label" for="<?php echo esc_attr( $name ); ?>"><?php echo apply_filters( 'user_' . $name . '_label', $desc ); ?></label>
						<div class="col-sm-10 col-md-8 col-lg-6">
							<input class="form-control" type="text" name="<?php echo esc_attr( $name ); ?>" id="<?php echo esc_attr( $name ); ?>" value="<?php bbp_displayed_user_field( $name, 'edit' ); ?>" class="regular-text" tabindex="<?php bbp_tab_index(); ?>" />
						</div>
					</div>

				<?php endforeach; ?>
			</fieldset>
		</div>
		<div class="tab-pane" id="about_yourself">
			<fieldset>
				<legend><?php bbp_is_user_home_edit() ? _e( 'About Yourself', 'bbpress' ) : _e( 'About the user', 'bbpress' ); ?></legend>

				<?php do_action( 'bbp_user_edit_before_about' ); ?>

				<div class="form-group">
					<label class="col-sm-2 control-label" for="description"><?php _e( 'Biographical Info', 'bbpress' ); ?></label>
					<div class="col-sm-10 col-md-8 col-lg-6">
						<textarea class="form-control" name="description" id="description" rows="5" cols="30" tabindex="<?php bbp_tab_index(); ?>"><?php bbp_displayed_user_field( 'description', 'edit' ); ?></textarea>
					</div>
				</div>

				<?php do_action( 'bbp_user_edit_after_about' ); ?>

			</fieldset>
		</div>
		<div class="tab-pane" id="password">
			<fieldset>
				<legend><?php _e( 'Password', 'bbpress' ) ?></legend>

				<?php do_action( 'bbp_user_edit_before_account' ); ?>

				<div class="form-group" id="password">
					<label class="col-sm-2 control-label" for="pass1"><?php _e( 'New Password', 'bbpress' ); ?></label>
					<div class="col-sm-10 col-md-8 col-lg-6">
						<input class="form-control" type="password" name="pass1" id="pass1" size="16" value="" autocomplete="off" tabindex="<?php bbp_tab_index(); ?>" />
						<span class="help-block"><?php _e( 'If you would like to change the password type a new one. Otherwise leave this blank.', 'bbpress' ); ?></span>
					</div>
				</div>
				<div class="form-group">
					<label class="col-sm-2 control-label" for="pass2"><?php _e( 'New Password (Repeated)', 'bbpress' ); ?></label>
					<div class="col-sm-10 col-md-8 col-lg-6">
						<input class="form-control" type="password" name="pass2" id="pass2" size="16" value="" autocomplete="off" tabindex="<?php bbp_tab_index(); ?>" />
						<span class="help-block"><?php _e( 'Type your new password again.', 'bbpress' ); ?></span>
						<span class="help-block"><?php _e( 'Your password should be at least ten characters long. Use upper and lower case letters, numbers, and symbols to make it even stronger.', 'bbpress' ); ?></span>
					</div>
				</div>

				<?php do_action( 'bbp_user_edit_after_account' ); ?>

			</fieldset>
		</div>

		<div class="tab-pane" id="user_role">
	<?php if ( current_user_can( 'edit_users' ) && ! bbp_is_user_home_edit() ) : ?>

		<fieldset>
			<legend><?php _e( 'User Role', 'bbpress' ); ?></legend>

			<?php do_action( 'bbp_user_edit_before_role' ); ?>

			<?php if ( is_multisite() && is_super_admin() && current_user_can( 'manage_network_options' ) ) : ?>

				<div class="form-group">
					<label class="col-sm-2 control-label" for="super_admin"><?php _e( 'Network Role', 'bbpress' ); ?></label>
					<label>
						<input class="form-control checkbox" type="checkbox" id="super_admin" name="super_admin"<?php checked( is_super_admin( bbp_get_displayed_user_id() ) ); ?> tabindex="<?php bbp_tab_index(); ?>" />
						<?php _e( 'Grant this user super admin privileges for the Network.', 'bbpress' ); ?>
					</label>
				</div>

			<?php endif; ?>

			<?php bbp_get_template_part( 'form', 'user-roles' ); ?>

			<?php do_action( 'bbp_user_edit_after_role' ); ?>

		</fieldset>

	<?php endif; ?>
		</div>
	</div>

	<?php do_action( 'bbp_user_edit_after' ); ?>

	<fieldset class="submit">
		<legend><?php _e( 'Save Changes', 'bbpress' ); ?></legend>
		<div class="form-group">

			<?php bbp_edit_user_form_fields(); ?>
			<div class="col-sm-10 col-md-8 col-lg-6 col-sm-offset-2">
				<button type="submit" tabindex="<?php bbp_tab_index(); ?>" id="bbp_user_edit_submit" name="bbp_user_edit_submit" class="btn btn-primary btn-lg"><?php bbp_is_user_home_edit() ? _e( 'Update Profile', 'bbpress' ) : _e( 'Update User', 'bbpress' ); ?></button>
			</div>
		</div>
	</fieldset>

</form>

<?php // } // end the custom namespace ?>
