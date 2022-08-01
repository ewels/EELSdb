<?php
/*
 Code for API to process a EELS DB news page wordpress loop and return the data
*/

$news = array();

// Initialise the post
while(have_posts()): the_post();

// Core fields
$results = array(
    'id' => get_the_ID(),
    'title' => get_the_title(),
    'permalink' => get_the_permalink(),
    'author' => array(
        'name' => get_the_author_meta('display_name'),
        'profile_url' => get_author_posts_url(get_the_author_ID())
    ),
    'published' => get_the_time('Y-m-d H:i:s'),
    'description' => get_the_excerpt()
);

// Comment count
$comment_counts = get_comment_count();
$results['comment_count'] = $comment_counts['approved'];

// Make API permalink by adding on api. subdomain to permalink
$api_permalink = str_replace('://', '://api.', get_the_permalink());
$api_permalink = str_replace('www', '', $api_permalink);
$results['api_permalink'] = $api_permalink;

// Keywords
foreach(wp_get_post_terms(get_the_ID(), 'keywords') as $keyword){
    $results['keywords'][] = $keyword->name;
}

// Get meta data
$data = get_spectrum_data (get_the_ID());

// $results = get_post(get_the_ID());

$news[] = $results;

endwhile;
