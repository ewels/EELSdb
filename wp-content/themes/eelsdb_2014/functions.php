<?php
/* EELS DB Theme Functions */

// Bounce non-admins from the wp-admin area
add_action( 'admin_init', 'eelsdb_redirect_non_admin_users' );
function eelsdb_redirect_non_admin_users() {
	if ( ! current_user_can( 'manage_options' ) && '/wp-admin/admin-ajax.php' != $_SERVER['PHP_SELF'] ) {
		wp_redirect( home_url() );
		exit;
	}
}

// Enqueue Bootstrap JS and CSS files
function cwd_wp_bootstrap_scripts_styles() {
  wp_enqueue_script('bootstrapjs', get_stylesheet_directory_uri().'/js/bootstrap.min.js', array('jquery'),'3.3.4', true );
  wp_enqueue_style('bootstrapwp', get_stylesheet_directory_uri().'/css/bootstrap.min.css', false ,'3.3.4');
  wp_enqueue_style('style', get_stylesheet_directory_uri().'/style.css', array('bootstrapwp') ,'1.0');
}
add_action('wp_enqueue_scripts', 'cwd_wp_bootstrap_scripts_styles');

// Register navigation menus
function register_eelsdb_nav() {
	register_nav_menu('main-nav',__( 'Main Navigation' ));
	register_nav_menu('secondary-nav',__( 'Secondary Navigation' ));
}
add_action( 'init', 'register_eelsdb_nav' );

// Log in and log out link in the navigation
add_filter( 'wp_nav_menu_items', 'eelsdb_loginout_menu_link', 10, 2 );
function eelsdb_loginout_menu_link( $items, $args ) {
   if ($args->theme_location == 'secondary-nav') {
      if (is_user_logged_in()) {
         $items .= '<li class="menu-item"><a href="'. bbp_get_user_profile_url( bbp_get_current_user_id() ) .'">Profile</a></li>';
		 $items .= '<li class="menu-item"><a href="'. wp_logout_url(home_url()) .'">Log Out</a></li>';
      } else {
         $items .= '<li class="menu-item"><a href="'. wp_login_url(get_permalink()) .'">Log In</a></li>';
		 $items .= '<li class="menu-item"><a href="'. site_url('/wp-login.php?action=register') .'">Register</a></li>';
      }
   }
   return $items;
}

// Register widget areas
function eelsdb_widgets_init() {
	register_sidebar( array(
		'name' => 'Homepage - 1',
		'id' => 'homepage-widget-area-1',
		'description' => 'The left hand widget area on the homepage.',
		'before_widget' => '',
		'after_widget' => '',
		'before_title' => '<h2 class="widget-title">',
		'after_title' => '</h2>',
	) );
	register_sidebar( array(
		'name' => 'Homepage - 2',
		'id' => 'homepage-widget-area-2',
		'description' => 'The central widget area on the homepage.',
		'before_widget' => '',
		'after_widget' => '',
		'before_title' => '<h2 class="widget-title">',
		'after_title' => '</h2>',
	) );
	register_sidebar( array(
		'name' => 'Homepage - 3',
		'id' => 'homepage-widget-area-3',
		'description' => 'The right hand widget area on the homepage.',
		'before_widget' => '',
		'after_widget' => '',
		'before_title' => '<h2 class="widget-title">',
		'after_title' => '</h2>',
	) );
	register_sidebar( array(
		'name' => 'Homepage - 4',
		'id' => 'homepage-widget-area-4',
		'description' => 'An optional fourth column on the homepage.',
		'before_widget' => '',
		'after_widget' => '',
		'before_title' => '<h2 class="widget-title">',
		'after_title' => '</h2>',
	) );
	register_sidebar( array(
		'name' => 'Page Side Bar',
		'id' => 'page-side-bar',
		'description' => 'Widget area for pages using the side-bar template.',
		'before_widget' => '',
		'after_widget' => '',
		'before_title' => '<h2 class="widget-title">',
		'after_title' => '</h2>',
	) );
}
add_action( 'widgets_init', 'eelsdb_widgets_init' );

// Load jQuery
if (!is_admin()) add_action("wp_enqueue_scripts", "my_jquery_enqueue", 11);
function my_jquery_enqueue() {
	wp_enqueue_script('jquery');
}

// Theme customiser
function eelsdb_theme_customizer( $wp_customize ) {

	// Helper Functions
	class EELSDB_Customize_Textarea_Control extends WP_Customize_Control {
	    public $type = 'textarea';

	    public function render_content() {
	        ?>
	        <label>
	        <span class="customize-control-title"><?php echo esc_html( $this->label ); ?></span>
	        <textarea rows="5" style="width:100%;" <?php $this->link(); ?>><?php echo esc_textarea( $this->value() ); ?></textarea>
	        </label>
	        <?php
	    }
	}

	// Homepage Alert
	$wp_customize->add_section( 'eelsdb_homepage_alert_section' , array(
	    'title'       => 'Homepage Alert',
	    'priority'    => 32,
	    'description' => 'Show an alert box at the top of the homepage',
	) );
	$wp_customize->add_setting( 'eelsdb_homepage_alert_text' );
	$wp_customize->add_control( new EELSDB_Customize_Textarea_Control( $wp_customize, 'eelsdb_homepage_alert_text', array(
	    'label'   => 'Alert Text',
	    'section' => 'eelsdb_homepage_alert_section',
	    'settings'   => 'eelsdb_homepage_alert_text',
	) ) );
	$wp_customize->add_setting( 'eelsdb_homepage_alert_colour' );
	$wp_customize->add_control( 'eelsdb_homepage_alert_colour', array(
	    'label'   => 'Alert Colour:',
	    'section' => 'eelsdb_homepage_alert_section',
	    'type'    => 'select',
	    'choices'    => array(
	        'alert-info' => 'Blue',
			'alert-success' => 'Green',
	        'alert-warning' => 'Yellow',
			'alert-danger' => 'Red',
	        ),
	) );

	// Footer Text
	$wp_customize->add_section( 'eelsdb_footer_section' , array(
	    'title'       => 'Footer',
	    'priority'    => 110,
	    'description' => 'Change the text and images shown in the footer',
	) );
	$wp_customize->add_setting( 'eelsdb_footer_text_setting', array(
	    'default' => 'The EELS Database is funded by the CNRS with significant contributions from the European Union and the French Government.'
	) );
	$wp_customize->add_control( new EELSDB_Customize_Textarea_Control( $wp_customize, 'eelsdb_footer_text_setting', array(
	    'label'   => 'Text (can contain HTML)',
	    'section' => 'eelsdb_footer_section',
	    'settings'   => 'eelsdb_footer_text_setting',
		'priority' => 1
	) ) );
	for ($i = 1; $i <= 8; $i++){
		$wp_customize->add_setting( 'eelsdb_footer_logo_'.$i );
		$wp_customize->add_control( new WP_Customize_Image_Control( $wp_customize, 'eelsdb_footer_logo_'.$i, array(
		    'label'    => 'Logo '.$i,
		    'section'  => 'eelsdb_footer_section',
		    'settings' => 'eelsdb_footer_logo_'.$i,
			'priority' => $i+1
		) ) );
		$wp_customize->add_setting( 'eelsdb_footer_logo_link_'.$i );
		$wp_customize->add_control( new WP_Customize_Control ( $wp_customize, 'eelsdb_footer_logo_link_'.$i, array(
		    'label'    => 'Logo '.$i.' URL',
		    'section'  => 'eelsdb_footer_section',
		    'settings' => 'eelsdb_footer_logo_link_'.$i,
			'priority' => $i+1.5
		) ) );
	}
}
add_action('customize_register', 'eelsdb_theme_customizer');


// Disable admin bar for non-admins
add_action('after_setup_theme', 'eelsdb_remove_admin_bar');
function eelsdb_remove_admin_bar() {
	if (!current_user_can('administrator') && !is_admin()) {
	  show_admin_bar(false);
	}
}


// Custom Fields for Job Adverts
add_filter( 'submit_job_form_fields', 'eelsdb_submit_job_form_fields' );

// https://github.com/mikejolley/WP-Job-Manager/blob/v1.2.0/includes/forms/class-wp-job-manager-form-submit-job.php#L101
function eelsdb_submit_job_form_fields ( $fields ) {
    $fields['job']['job_location']['placeholder'] = 'e.g. "London, UK", "Paris", "Nantes"';
	$fields['job']['job_location']['description'] = '';
	$fields['company']['company_tagline']['label'] = 'Description';
	$fields['company']['company_tagline']['priority'] = 1.5;
	unset($fields['company']['company_twitter']);
	$fields['job']['job_start_date'] = array(
	        'label'       => __( 'Start Date', 'job_manager' ),
	        'type'        => 'text',
	        'required'    => true,
	        'placeholder' => 'e.g. "1st '.date("F Y", strtotime("+1 month")).'", "From '.date("F Y", strtotime("+6 months")).'", "Immediatey"',
	        'priority'    => 3.5
	    );
    return $fields;
}
add_action( 'job_manager_update_job_data', 'eelsdb_frontend_add_startdate_field_save', 10, 2 );
function eelsdb_frontend_add_startdate_field_save ( $job_id, $values ) {
    update_post_meta( $job_id, '_job_salary', $values['job']['job_start_date'] );
}
// Admin add/edit job
add_filter( 'job_manager_job_listing_data_fields', 'eelsdb_admin_add_startdate_field' );
function eelsdb_admin_add_startdate_field ( $fields ) {
    $fields['_job_location']['placeholder'] = 'e.g. "London, UK", "Paris", "Nantes"';
	$fields['_job_location']['description'] = '';
	$fields['_company_tagline']['label'] = 'Company Description';
	$fields['_company_tagline']['priority'] = 1.5;
	unset($fields['_company_twitter']);
    $fields['_job_start_date'] = array(
        'label'       => __( 'Start Date', 'job_manager' ),
        'type'        => 'text',
        'placeholder' => 'e.g. "1st '.date("F Y", strtotime("+1 month")).'", "From '.date("F Y", strtotime("+6 months")).'", "Immediatey"',
        'description' => ''
    );
    return $fields;
}



// Replace excerpt ellipsis with a linked ellipsis
function replace_excerpt($content) {
	return str_replace('[&hellip;]', '<a href="'. get_permalink() .'">[&hellip;]</a>', $content );
}
add_filter('the_excerpt', 'replace_excerpt');

// Rename "Posts" to "News"
// https://gist.github.com/gyrus/3155982
add_action( 'admin_menu', 'eelsnews_change_post_menu_label' );
add_action( 'init', 'eelsnews_change_post_object_label' );
function eelsnews_change_post_menu_label() {
	global $menu;
	global $submenu;
	$menu[5][0] = 'News';
	$submenu['edit.php'][5][0] = 'News';
	$submenu['edit.php'][10][0] = 'Add News';
	$submenu['edit.php'][16][0] = 'News Tags';
	echo '';
}
function eelsnews_change_post_object_label() {
	global $wp_post_types;
	$labels = &$wp_post_types['post']->labels;
	$labels->name = 'News';
	$labels->singular_name = 'News';
	$labels->add_new = 'Add News';
	$labels->add_new_item = 'Add News';
	$labels->edit_item = 'Edit News';
	$labels->new_item = 'News';
	$labels->view_item = 'View News';
	$labels->search_items = 'Search News';
	$labels->not_found = 'No News found';
	$labels->not_found_in_trash = 'No News found in Trash';
}

// Custom user profile fields
// http://davidwalsh.name/add-profile-fields
function modify_contact_methods($profile_fields) {

	// Add new fields
	$profile_fields['phone'] = 'Personal Phone';
	$profile_fields['u_lab_url'] = 'Academic URL';
	$profile_fields['u_lab'] = 'Laboratory';
	$profile_fields['u_address'] = 'Address';
	$profile_fields['u_zip'] = 'Zip Code';
	$profile_fields['u_city'] = 'City';
	$profile_fields['u_country'] = 'Country';
	$profile_fields['u_phone'] = 'Lab Phone';
	$profile_fields['u_fax'] = 'Lab Fax';

	$profile_fields['skype'] = 'Skype Username';
	$profile_fields['twitter'] = 'Twitter Username';
	$profile_fields['linkedin'] = 'LinkedIn URL';
	$profile_fields['academia_edu'] = 'Academia.edu URL';
	$profile_fields['researchgate'] = 'Research Gate URL';
	$profile_fields['google_scholar'] = 'Google Scholar URL';
	$profile_fields['orcid'] = 'ORCiD URL';
	$profile_fields['researcherid'] = 'ResearcherID URL';
	$profile_fields['facebook'] = 'Facebook URL';
	$profile_fields['gplus'] = 'Google+ URL';

	// Remove old fields
	unset($profile_fields['yim']);
	unset($profile_fields['jabber']);
	unset($profile_fields['aim']);

	return $profile_fields;
}
add_filter('user_contactmethods', 'modify_contact_methods');

// Add .form-horizontal class to Contact Form 7 Forms
// http://www.wildli.com/blog/dev-tip-getting-contact-form-7-wordpress-plugin-and-twitter-bootstrap-to-play-nice/
add_filter( 'wpcf7_form_class_attr', 'eelsdb_cf7_custom_form_class_attr' );
function eelsdb_cf7_custom_form_class_attr( $class ) {
	$class .= ' form-horizontal';
	return $class;
}


// Styles for TinyMCE in admin
add_editor_style('tinymce_styles.css');
// unhide the styles dropdown
add_filter( 'mce_buttons_2', 'eelsdb_mce_editor_buttons' );
function eelsdb_mce_editor_buttons( $buttons ) {
    array_unshift( $buttons, 'styleselect' );
    return $buttons;
}
// Extra classes for TinyMCE in admin
function eelsdb_tinymce_classes( $init_array ) {
	$style_formats = array(
		array(
			'title' => 'Lead Text',
			'block' => 'div',
			'classes' => 'lead',
			'wrapper' => false
		),
		array(
			'title' => 'Code',
			'inline' => 'code',
			'wrapper' => true
		)
	);
	$init_array['style_formats'] = json_encode( $style_formats );
	return $init_array;
}
add_filter('tiny_mce_before_init', 'eelsdb_tinymce_classes');


// Add credit to the admin footer
function modify_footer_admin () {
  echo 'Created by <a href="http://phil.ewels.co.uk" target="_blank">Phil Ewels</a>. ';
  echo 'Powered by <a href="http://wordpress.org/" target="_blank">WordPress</a>.';
}
add_filter('admin_footer_text', 'modify_footer_admin');


// Comment form - make it bootstap styled
// Stolen from  http://www.codecheese.com/2013/11/wordpress-comment-form-with-twitter-bootstrap-3-supports/
add_filter( 'comment_form_default_fields', 'eelsdb_comment_form_fields' );
function eelsdb_comment_form_fields( $fields ) {
    $commenter = wp_get_current_commenter();
    $req      = get_option( 'require_name_email' );
    $aria_req = ( $req ? " aria-required='true'" : '' );
    $html5    = current_theme_supports( 'html5', 'comment-form' ) ? 1 : 0;
    $fields   =  array(
        'author' => '<div class="form-group comment-form-author">' . '<label for="author">' . __( 'Name' ) . ( $req ? ' <span class="required">*</span>' : '' ) . '</label> ' .
                    '<input class="form-control" id="author" name="author" type="text" value="' . esc_attr( $commenter['comment_author'] ) . '" size="30"' . $aria_req . ' /></div>',
        'email'  => '<div class="form-group comment-form-email"><label for="email">' . __( 'Email' ) . ( $req ? ' <span class="required">*</span>' : '' ) . '</label> ' .
                    '<input class="form-control" id="email" name="email" ' . ( $html5 ? 'type="email"' : 'type="text"' ) . ' value="' . esc_attr(  $commenter['comment_author_email'] ) . '" size="30"' . $aria_req . ' /></div>',
        'url'    => '<div class="form-group comment-form-url"><label for="url">' . __( 'Website' ) . '</label> ' .
                    '<input class="form-control" id="url" name="url" ' . ( $html5 ? 'type="url"' : 'type="text"' ) . ' value="' . esc_attr( $commenter['comment_author_url'] ) . '" size="30" /></div>',
    );
    return $fields;
}
add_filter( 'comment_form_defaults', 'eelsdb_comment_form' );
function eelsdb_comment_form( $args ) {
    $args['comment_field'] = '<div class="form-group comment-form-comment">
            <label for="comment">' . __( 'Your Comment' ) . '</label>
            <textarea class="form-control" id="comment" name="comment" rows="3" aria-required="true"></textarea>
        </div>';
    return $args;
}
add_action('comment_form', 'eelsdb_comment_button' );
function eelsdb_comment_button() {
    echo '<button class="btn btn-default" type="submit">' . __( 'Submit Comment' ) . '</button>';
}


// Make the author page use spectra instead of posts
function author_page_use_spectra ( &$query ){
    if ( $query->is_author ){
        $query->set( 'post_type', 'spectra' );
	}
    remove_action( 'pre_get_posts', 'author_page_use_spectra' ); // run once!
}
add_action( 'pre_get_posts', 'author_page_use_spectra' );


// Customise message after user registration
function eelsdb_login_messages( $messages ) {
	$messages = str_replace( 'check your e-mail', 'check your e-mail (and spam folder). Contact us at info@eelsdb.eu if you do not receive a message with your login informations within 2 hours', $messages );
	return $messages;
}
add_filter( 'login_messages', 'eelsdb_login_messages' );

?>
