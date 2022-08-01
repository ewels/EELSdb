<?php
/*
Template Name: No Title
*/

get_header(); 

if (have_posts()) {
	while (have_posts()) {
		the_post(); 
		$content = apply_filters('the_content',get_the_content());
	}
}
?>

<div class="row">
	<div class="col-md-12">
		<?php echo $content; ?>
	</div>
</div>

<?php get_footer(); ?>