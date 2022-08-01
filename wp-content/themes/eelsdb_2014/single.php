<?php get_header();

if (have_posts()) {
	while (have_posts()) {
		the_post(); 
		
		echo '<h1>'.get_the_title().'</h1>';
		echo '<p><span class="post_date">'.get_the_date().'</span> <span class="post_category">Categories: <em>'.get_the_category_list(', ').'</em></span></p>';
		echo '<div class="single_post_content">';
		the_content();
		echo '</div>';
		
	}
}

get_footer(); ?>