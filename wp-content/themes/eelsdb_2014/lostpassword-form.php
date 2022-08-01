<?php
/*
If you would like to edit this file, copy it to your current theme's directory and edit it there.
Theme My Login will always look in your theme's directory first, before using this default template.
*/
?>

<?php $template->the_errors(); ?>
<div class="row">
	<div class="col-lg-4 col-lg-offset-4 col-md-6 col-md-offset-3 col-sm-8 col-sm-offset-2">
		<form name="lostpasswordform" id="lostpasswordform<?php $template->the_instance(); ?>" action="<?php $template->the_action_url( 'lostpassword' ); ?>" method="post" class="form-signin" role="form">
			<h3 class="form-signin-heading">Retrieve Your Password</h3>
			
			<input name="user_login" id="user_login<?php $template->the_instance(); ?>" value="<?php $template->the_posted_value( 'user_login' ); ?>" type="text" class="form-control" placeholder="<?php _e( 'Username or E-mail:' ); ?>" required autofocus>
			<span class="help-block"><?php $template->the_action_template_message( 'lostpassword' ); ?></span>
			
			<?php do_action( 'lostpassword_form' ); ?>
			<input type="submit" name="wp-submit" id="wp-submit<?php $template->the_instance(); ?>" value="<?php esc_attr_e( 'Get New Password' ); ?>" class="btn btn-lg btn-primary btn-block" />
			<input type="hidden" name="redirect_to" value="<?php $template->the_redirect_url( 'lostpassword' ); ?>" />
			<input type="hidden" name="instance" value="<?php $template->the_instance(); ?>" />
			<input type="hidden" name="action" value="lostpassword" />
		</form>
		<p class="login-bottom-links">
		  <a href="<?php echo home_url('login/'); ?>">Log In</a> / 
  		  <a href="<?php echo home_url('register/'); ?>">Register</a>
		</p>
	</div>
</div>

