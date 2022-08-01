<?php
/*
Theme my login - login page
*/
?>

<?php $template->the_errors(); ?>
<div class="row">
	<div class="col-lg-4 col-lg-offset-4 col-md-6 col-md-offset-3 col-sm-8 col-sm-offset-2">
		<form name="loginform" id="loginform<?php $template->the_instance(); ?>" action="<?php $template->the_action_url( 'login' ); ?>" method="post" class="form-signin" role="form">
			<h3 class="form-signin-heading">Please sign in</h3>
			<input name="log" id="user_login<?php $template->the_instance(); ?>" value="<?php $template->the_posted_value( 'log' ); ?>" type="text" class="form-control inputtop" placeholder="<?php _e( 'Username' ); ?>" required autofocus>
			<input name="pwd" id="user_pass<?php $template->the_instance(); ?>" value="" type="password" class="form-control inputbottom" placeholder="Password" required>
			<?php do_action( 'login_form' ); ?>
			<label class="checkbox">
				<input name="rememberme" type="checkbox" id="rememberme<?php $template->the_instance(); ?>" value="forever"> Remember me
			</label>
			<input type="submit" name="wp-submit" id="wp-submit<?php $template->the_instance(); ?>" value="<?php esc_attr_e( 'Sign In' ); ?>" class="btn btn-lg btn-primary btn-block" />
			<input type="hidden" name="redirect_to" value="<?php $template->the_redirect_url( 'login' ); ?>" />
			<input type="hidden" name="instance" value="<?php $template->the_instance(); ?>" />
			<input type="hidden" name="action" value="login" />
		</form>
		<p class="login-bottom-links">
		  <a href="<?php echo home_url('/register'); ?>">Register</a> / 
		  <a href="<?php echo home_url('/lostpassword'); ?>">Lost Password</a>
		</p>
	</div>
</div>
