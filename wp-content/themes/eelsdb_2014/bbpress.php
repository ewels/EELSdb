<?php get_header();

if (have_posts()) {
	while (have_posts()) {
		the_post(); 
		
		if(!bbp_is_favorites() && !bbp_is_subscriptions() && !bbp_is_single_user_topics() && !bbp_is_single_user_replies() && !bbp_is_single_user_edit() && !bbp_is_single_user_profile() ){
			echo '<h1>'.get_the_title().'</h1>';
		}
		echo '<p class="post_date">';
		the_date();
		echo '</p>';
		the_content();
		
	}
}

get_footer(); ?>