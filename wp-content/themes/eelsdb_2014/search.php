<?php get_header(); ?>

<h1>Search Results for <em><?php echo get_search_query(); ?></em></h1>

<?php
if (have_posts()) {
	$first = true;
	while (have_posts()) {
		the_post();
		if(!$first) { echo '<hr>'; } $first = false;
		if($post->post_parent){
			$parent = get_the_title($post->post_parent).' &raquo; ';
		} else {
			$parent = '';
		}
		if ( has_post_thumbnail($post->ID) ) {
			echo '<a href="'.get_permalink($post->ID).'" class="th" style="float:right; margin-left:15px;">'.get_the_post_thumbnail($page->ID).'</a>';
		} 
		echo '<h3>'.$parent.'<a href="'.get_permalink().'">'.get_the_title().'</a></h3>';
		the_excerpt();
	}
} else {
	echo '<p>Sorry - nothing found.</p>';
}


get_footer(); ?>