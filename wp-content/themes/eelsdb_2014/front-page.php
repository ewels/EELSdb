<?php get_header();

if(get_theme_mod( 'eelsdb_homepage_alert_text' ) && strlen(trim(get_theme_mod( 'eelsdb_homepage_alert_text' ))) > 0) {
	echo '<div data-alert class="alert '.get_theme_mod( 'eelsdb_homepage_alert_colour' ).'">';
	echo get_theme_mod( 'eelsdb_homepage_alert_text' );
	echo '</div>';
}

if (have_posts()) {
	while (have_posts()) {
		the_post();
		?>
		<div class="well homepage-well" style="margin:20px 0 40px; padding:19px 40px 19px 19px;">
			<div class="row">
				<div class="col-md-6">
					<object type="image/svg+xml" data="<?php echo get_stylesheet_directory_uri(); ?>/img/EELSdb_logo.svg" class="logo">
						<img src="<?php echo get_stylesheet_directory_uri(); ?>/img/EELSdb_logo-medium.png" class="logo"/>
					</object>
				</div>
				<div class="col-md-6" style="padding-top:30px;">
					<?php the_content(); ?>
				</div>
			</div>
		</div>
	  <?php
	}
}

// Homepage widget areas
// Accomodates one to four active widget areas, fits columns accordingly
$widget_count = 0;
for ($i = 1; $i <= 4; $i++){
	if ( is_active_sidebar('homepage-widget-area-'.$i) ) $widget_count++;
}
if ( $widget_count > 0) {
	$widget_column_class = floor(12 / $widget_count);
	echo '<div class="row homepage-widgets">';
	for ($i = 1; $i <= 4; $i++){
		echo '<div class="col-md-'.$widget_column_class.'">';
		if ( is_active_sidebar('homepage-widget-area-'.$i) ) {
			dynamic_sidebar( 'homepage-widget-area-'.$i );
		}
		echo '</div>';
	}
	echo '</div>';
}

get_footer(); ?>
