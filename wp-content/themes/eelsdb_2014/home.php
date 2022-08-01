<?php get_header(); ?>

<h1>News</h1>

<?php
if (have_posts()) {
	while (have_posts()) {
		the_post(); ?>
		
		<h2><a href="<?php the_permalink(); ?>"><?php the_title(); ?></a></h2>
		
		<?php if ( has_post_thumbnail() ) { ?>
			<a href="<?php the_permalink(); ?>" class="alignright"><?php the_post_thumbnail('thumb'); ?></a>
		<?php } ?>
		
		
		<?php
		the_excerpt();
		
        echo '<p><span class="post_date">'.get_the_date().'</span> <span class="post_category">Categories: <em>'.get_the_category_list(', ').'</em></span></p>';
		
		echo '<hr style="clear:both;">';
	}
} else {
	echo '<p>No items found.</p>';
}

?>

<?php get_footer(); ?>