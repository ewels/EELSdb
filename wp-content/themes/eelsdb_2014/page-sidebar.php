<?php
/*
Template Name: Sidebar
*/

get_header(); 

if (have_posts()) {
	while (have_posts()) {
		the_post(); 
		$title = '<h1>'.get_the_title().'</h1>';
		$content = apply_filters('the_content',get_the_content());
	}
}
?>

<?php echo $title; ?>
<div class="row">
	<div class="col-md-10">
		<?php echo $content; ?>
	</div>
	<div class="col-md-2">
		<?php
		if ( is_active_sidebar('page-side-bar') ) {
			dynamic_sidebar( 'page-side-bar' );
		}
		?>
	</div>
</div>

<?php get_footer(); ?>