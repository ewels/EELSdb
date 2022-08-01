<?php
/*
Theme my login - lost password page
*/
?>

<?php $template->the_errors(); ?>
<div class="row">
	<div class="col-lg-4 col-lg-offset-4 col-md-6 col-md-offset-3 col-sm-8 col-sm-offset-2">
		<form name="resetpasswordform" id="resetpasswordform<?php $template->the_instance(); ?>" action="<?php $template->the_action_url( 'resetpass' ); ?>" method="post" class="form-signin" role="form">
			<h3 class="form-signin-heading"><?php $template->the_action_template_message( 'resetpass' ); ?></h3>
			
			<input autocomplete="off" name="pass1" id="pass1<?php $template->the_instance(); ?>" value="" type="password" class="form-control inputtop" placeholder="<?php _e( 'New password' ); ?>" required autofocus>
			<input autocomplete="off" name="pass2" id="pass2<?php $template->the_instance(); ?>" value="" type="password" class="form-control inputbottom" placeholder="<?php _e( 'Confirm new password' ); ?>" required>
			<span class="help-block">Hint: The password should be at least seven characters long. To make it stronger, use upper and lower case letters, numbers and symbols like <code>! " ? $ % ^ &amp;</code>).</span>
			<div id="pass-strength-result" class="hide-if-no-js"><?php _e( 'Strength indicator' ); ?></div>
			
			<?php do_action( 'resetpassword_form' ); ?>
			
			<input type="submit" name="wp-submit" id="wp-submit<?php $template->the_instance(); ?>" value="<?php esc_attr_e( 'Reset Password' ); ?>" class="btn btn-lg btn-primary btn-block" />
			<input type="hidden" name="key" value="<?php $template->the_posted_value( 'key' ); ?>" />
			<input type="hidden" name="login" id="user_login" value="<?php $template->the_posted_value( 'login' ); ?>" />
			<input type="hidden" name="instance" value="<?php $template->the_instance(); ?>" />
			<input type="hidden" name="action" value="resetpass" />
		</form>
		<p class="login-bottom-links">
		  <a href="<?php echo home_url('/login/'); ?>">Log In</a> / 
		  <a href="<?php echo home_url('/register/'); ?>">Register</a>
		</p>
	</div>
</div>
