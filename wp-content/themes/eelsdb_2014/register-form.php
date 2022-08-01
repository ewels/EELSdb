<?php
/*
Theme my login - registration page
*/
?>

<?php $template->the_errors(); ?>
<div class="row">
	<div class="col-lg-4 col-lg-offset-4 col-md-6 col-md-offset-3 col-sm-8 col-sm-offset-2">
		<form name="registerform" id="registerform<?php $template->the_instance(); ?>" action="<?php $template->the_action_url( 'register' ); ?>" method="post" class="form-signin" role="form">
			<h3 class="form-signin-heading">Please enter your details</h3>
			
			<input name="user_login" id="user_login<?php $template->the_instance(); ?>" value="<?php $template->the_posted_value( 'user_login' ); ?>" type="text" class="form-control inputtop" placeholder="<?php _e( 'Username' ); ?>" required autofocus>
			<input name="user_email" id="user_email<?php $template->the_instance(); ?>" value="<?php $template->the_posted_value( 'user_email' ); ?>" type="email" class="form-control inputbottom" placeholder="<?php _e( 'E-mail' ); ?>" required>
			<span id="reg_passmail<?php $template->the_instance(); ?>" class="help-block"><?php echo apply_filters( 'tml_register_passmail_template_message', __( 'A password will be e-mailed to you.' ) ); ?></span>
			
			
			<?php do_action( 'register_form' ); ?>
						
			<input type="submit" name="wp-submit" id="wp-submit<?php $template->the_instance(); ?>" value="<?php esc_attr_e( 'Register' ); ?>" class="btn btn-lg btn-primary btn-block" />
			<input type="hidden" name="redirect_to" value="<?php $template->the_redirect_url( 'register' ); ?>" />
			<input type="hidden" name="instance" value="<?php $template->the_instance(); ?>" />
			<input type="hidden" name="action" value="register" />
		</form>
		<p class="login-bottom-links">
		  <a href="<?php echo home_url('/login/'); ?>">Log In</a> / 
		  <a href="<?php echo home_url('/lostpassword/'); ?>">Lost Password</a>
		</p>
	</div>
</div>
