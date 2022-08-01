<?php
// Functions to make EELS DB e-mails look nice!
// http://www.smashingmagazine.com/2011/10/25/create-perfect-emails-wordpress-website/

// Make e-mails look nice, send from desired user
add_filter ('wp_mail_content_type', 'eelsdb_content_type');
function eelsdb_content_type() {
    return "text/html";
}
function set_bp_message_content_type() {
    return 'text/html';
}
add_filter ('wp_mail_from', 'eelsdb_email_from');
function eelsdb_email_from() {
    return 'info@eelsdb.eu';
}
add_filter ('wp_mail_from_name', 'eelsdb_email_from_name');
function eelsdb_email_from_name() {
    return 'EELS DB';
}


// Over-write the default buddypress new user e-mail activation
add_filter('bp_core_signup_send_validation_email_subject', 'eelsdb_bp_activation_subject', 10, 2 );
function eelsdb_bp_activation_subject( $subject, $user_id ) { return "Please activate your EELS DB account"; }
add_filter('bp_core_signup_send_validation_email_message', 'eelsdb_bp_change_activation_email_message', 10, 3);
function eelsdb_bp_change_activation_email_message( $message, $user_id, $activate_url ) {
    $user = get_userdata( $user_id );
    ob_start();
    include("email-template/eelsdb_email_header.html"); ?>
	
	<h3 style="font-family: 'HelveticaNeue-Light', 'Helvetica Neue Light', 'Helvetica Neue', Helvetica, Arial, 'Lucida Grande', sans-serif; line-height: 1.1; color: #000; font-weight: 500; font-size: 27px; margin: 0 0 15px; padding: 0;">Hi <?php echo $user->user_login ?>,</h3>
	<p class="lead" style="font-family: 'Helvetica Neue', 'Helvetica', Helvetica, Arial, sans-serif; font-weight: normal; font-size: 17px; line-height: 1.6; margin: 0 0 10px; padding: 0;">Thanks for registering!</p>
	<p class="callout" style="font-family: 'Helvetica Neue', 'Helvetica', Helvetica, Arial, sans-serif; font-weight: normal; font-size: 14px; line-height: 1.6; background: #ECF8FF; margin: 0 0 15px; padding: 15px;">
		To complete the activation of your account, please click the following link:<br>
		<a href="<?php echo wp_login_url(); ?>" style="font-family: 'Helvetica Neue', 'Helvetica', Helvetica, Arial, sans-serif; color: #2BA6CB; margin: 0; padding: 0;"><?php echo $activate_url; ?></a>  
	</p>
	<p style="font-family: 'Helvetica Neue', 'Helvetica', Helvetica, Arial, sans-serif; font-weight: normal; font-size: 14px; line-height: 1.6; margin: 0 0 10px; padding: 0;">
	  Thanks for getting involved with the EELS DB site. If you have any questions, please get in touch at <a href="mailto:<?php echo get_bloginfo('admin_email'); ?>" style="font-family: 'Helvetica Neue', 'Helvetica', Helvetica, Arial, sans-serif; color: #2BA6CB; margin: 0; padding: 0;"><?php echo get_bloginfo('admin_email'); ?></a>      
	</p>
    <?php include("email-template/eelsdb_email_footer.html");
    $message = ob_get_contents();
    ob_end_clean();
	return $message;
}



// Over-write the default new user e-mail
if(!function_exists('wp_new_user_notification')){ 
function wp_new_user_notification($user_id, $notify) {
    global $wpdb;
    
    $user = new WP_User($user_id);
    $user_displayname = stripslashes($user->display_name);
    $user_login = stripslashes($user->user_login);
    $user_email = stripslashes($user->user_email);
    $email_subject = "Welcome to the EELS DB Website";
    
    // Generate a key.
		$key = wp_generate_password( 20, false );
		do_action( 'retrieve_password_key', $user->user_login, $key );

		// Now insert the key, hashed, into the DB.
		if ( empty( $wp_hasher ) ) {
			require_once ABSPATH . WPINC . '/class-phpass.php';
			$wp_hasher = new PasswordHash( 8, true );
		}
		$hashed = time() . ':' . $wp_hasher->HashPassword( $key );
		$wpdb->update( $wpdb->users, array( 'user_activation_key' => $hashed ), array( 'user_login' => $user->user_login ) );
    
    $pass_url = site_url('wp-login.php?action=rp&key='.$key.'&login='.rawurlencode($user->user_login), 'https');
    
    ob_start();
    include("email-template/eelsdb_email_header.html"); ?>
    
    <h3 style="font-family: 'HelveticaNeue-Light', 'Helvetica Neue Light', 'Helvetica Neue', Helvetica, Arial, 'Lucida Grande', sans-serif; line-height: 1.1; color: #000; font-weight: 500; font-size: 27px; margin: 0 0 15px; padding: 0;">Hi <?php echo $user_displayname ?>,</h3>
    <p class="lead" style="font-family: 'Helvetica Neue', 'Helvetica', Helvetica, Arial, sans-serif; font-weight: normal; font-size: 17px; line-height: 1.6; margin: 0 0 10px; padding: 0;">Welcome to the EELS DB community!</p>
    <p class="callout" style="font-family: 'Helvetica Neue', 'Helvetica', Helvetica, Arial, sans-serif; font-weight: normal; font-size: 14px; line-height: 1.6; background: #ECF8FF; margin: 0 0 15px; padding: 15px;">
	     Your user name is <strong style="font-family: 'Courier New', Courier, monospace; color: #000; font-weight: bold; margin: 0; padding: 0;"><?php echo $user_login ?></strong> <br>
       To set your password, visit the following address:<br>
       <strong style="font-family: 'Courier New', Courier, monospace; color: #000; font-weight: bold; margin: 0; padding: 0;"><a href="<?php echo $pass_url; ?>"><?php echo $pass_url; ?></a></strong>
     </p>
     <p style="font-family: 'Helvetica Neue', 'Helvetica', Helvetica, Arial, sans-serif; font-weight: normal; font-size: 14px; line-height: 1.6; margin: 0 0 10px; padding: 0;">
       Thanks for getting involved with the EELS DB site. If you have any questions, please get in touch at <a href="mailto:<?php echo get_bloginfo('admin_email'); ?>" style="font-family: 'Helvetica Neue', 'Helvetica', Helvetica, Arial, sans-serif; color: #2BA6CB; margin: 0; padding: 0;"><?php echo get_bloginfo('admin_email'); ?></a>      
     </p>
	
    <?php include("email-template/eelsdb_email_footer.html");
    $message = ob_get_contents();
    ob_end_clean();

    @wp_mail($user_email, $email_subject, $message);
}
}


// Over-write the default recover password e-mail
add_filter ('retrieve_password_title', 'eelsdb_retrieve_password_title');
function eelsdb_retrieve_password_title() { return "Password Reset for EELS DB"; }

add_filter ('retrieve_password_message', 'eelsdb_retrieve_password_message', 10, 2);
function eelsdb_retrieve_password_message($content, $key) {
	$login = trim($_POST['user_login']);
	if(strpos($_POST['user_login'], '@')){
		$user = get_user_by( 'email', trim( $_POST['user_login'] ) );
	} else {
		$login = trim($_POST['user_login']);
		$user = get_user_by('login', $login);
	}
	ob_start();
	$email_subject = eelsdb_retrieve_password_title();
	$reset_url = wp_login_url().'?action=rp&key='.$key.'&login='.rawurlencode($user->user_login);
	include("email-template/eelsdb_email_header.html"); ?>
    
	<h3 style="font-family: 'HelveticaNeue-Light', 'Helvetica Neue Light', 'Helvetica Neue', Helvetica, Arial, 'Lucida Grande', sans-serif; line-height: 1.1; color: #000; font-weight: 500; font-size: 27px; margin: 0 0 15px; padding: 0;">Hi <?php echo $user->display_name; ?>,</h3>
	<p class="lead" style="font-family: 'Helvetica Neue', 'Helvetica', Helvetica, Arial, sans-serif; font-weight: normal; font-size: 17px; line-height: 1.6; margin: 0 0 10px; padding: 0;">Here's how to reset your password..</p>
	<p style="font-family: 'Helvetica Neue', 'Helvetica', Helvetica, Arial, sans-serif; font-weight: normal; font-size: 14px; line-height: 1.6; margin: 0 0 10px; padding: 0;">Someone (hopefully you) just requested to reset your password on the EELS DB website.</p>

	<p class="callout" style="font-family: 'Helvetica Neue', 'Helvetica', Helvetica, Arial, sans-serif; font-weight: normal; font-size: 14px; line-height: 1.6; background: #ECF8FF; margin: 0 0 15px; padding: 15px;">
		To reset your password, click <a href="<?php echo $reset_url; ?>" style="font-family: 'Helvetica Neue', 'Helvetica', Helvetica, Arial, sans-serif; color: #2BA6CB; font-weight: bold; margin: 0; padding: 0;">here</a>.
	</p>
			
	<p style="font-family: 'Helvetica Neue', 'Helvetica', Helvetica, Arial, sans-serif; font-weight: normal; font-size: 14px; line-height: 1.6; margin: 0 0 10px; padding: 0;">
	  If the link above doesn't work, copy and paste the following into your web browser: <br>
	  <a href="<?php echo $reset_url; ?>" style="font-family: 'Helvetica Neue', 'Helvetica', Helvetica, Arial, sans-serif; color: #2BA6CB; font-weight: bold; margin: 0; padding: 0;"><?php echo $reset_url; ?></a>
	</p>

	<p style="font-family: 'Helvetica Neue', 'Helvetica', Helvetica, Arial, sans-serif; font-weight: normal; font-size: 14px; line-height: 1.6; margin: 0 0 10px; padding: 0;">
	  If you remember your password, just ignore the link and log in as normal.
	</p>

	<p style="font-family: 'Helvetica Neue', 'Helvetica', Helvetica, Arial, sans-serif; font-weight: normal; font-size: 14px; line-height: 1.6; margin: 0 0 10px; padding: 0;">
	  If you think that your account may have been compromised, or have any questions, please get in touch at <a href="mailto:<?php echo get_bloginfo('admin_email'); ?>" style="font-family: 'Helvetica Neue', 'Helvetica', Helvetica, Arial, sans-serif; color: #2BA6CB; margin: 0; padding: 0;"><?php echo get_bloginfo('admin_email'); ?></a>      
	</p>
	
	<?php include("email-template/eelsdb_email_footer.html");
	$message = ob_get_contents();
	ob_end_clean();
	return $message;
}



// Send an e-mail to users when their spectrum is approved
add_action('publish_spectra', 'eelsdb_publication_notification');
function eelsdb_publication_notification($post_id) {
  
	$post = get_post($post_id);
	$author = get_userdata($post->post_author);
	
	$author_email = $author->user_email;
  $email_subject = 'Your EELS DB spectrum has been approved!';
	
	ob_start();
	include('email-template/eelsdb_email_header.html'); ?>
	
	<h3 style="font-family: 'HelveticaNeue-Light', 'Helvetica Neue Light', 'Helvetica Neue', Helvetica, Arial, 'Lucida Grande', sans-serif; line-height: 1.1; color: #000; font-weight: 500; font-size: 27px; margin: 0 0 15px; padding: 0;">Hi <?php echo $author->display_name ?>,</h3>
	<p class="lead" style="font-family: 'Helvetica Neue', 'Helvetica', Helvetica, Arial, sans-serif; font-weight: normal; font-size: 17px; line-height: 1.6; margin: 0 0 10px; padding: 0;">Your spectrum has been approved!</p>
	<p style="font-family: 'Helvetica Neue', 'Helvetica', Helvetica, Arial, sans-serif; font-weight: normal; font-size: 14px; line-height: 1.6; margin: 0 0 10px; padding: 0;">You recently uploaded a spectrum called <a href="<?php echo get_permalink($post->ID) ?>" style="font-family: 'Helvetica Neue', 'Helvetica', Helvetica, Arial, sans-serif; color: #2BA6CB; margin: 0; padding: 0;"><?php echo $post->post_title ?></a>, which has just been approved by a moderator. This spectrum is now publicly visible to the world.</p>

	<p class="callout" style="font-family: 'Helvetica Neue', 'Helvetica', Helvetica, Arial, sans-serif; font-weight: normal; font-size: 14px; line-height: 1.6; background: #ECF8FF; margin: 0 0 15px; padding: 15px;">
		The link for your new spectrum is: <a href="<?php echo get_permalink($post->ID) ?>" style="font-family: 'Helvetica Neue', 'Helvetica', Helvetica, Arial, sans-serif; color: #2BA6CB; font-weight: bold; margin: 0; padding: 0;"><?php echo get_permalink($post->ID) ?></a>
	</p>
	
	<p style="font-family: 'Helvetica Neue', 'Helvetica', Helvetica, Arial, sans-serif; font-weight: normal; font-size: 14px; line-height: 1.6; margin: 0 0 10px; padding: 0;">
		Many thanks for your contribution to the EELS community. If you have any questions, please get in touch at <a href="mailto:<?php echo get_bloginfo('admin_email'); ?>" style="font-family: 'Helvetica Neue', 'Helvetica', Helvetica, Arial, sans-serif; color: #2BA6CB; margin: 0; padding: 0;"><?php echo get_bloginfo('admin_email'); ?></a>      
	</p>	
	
	<?php include('email-template/eelsdb_email_footer.html');
	$message = ob_get_contents();
	ob_end_clean();
	wp_mail($author_email, $email_subject, $message);
	
}

    
?>