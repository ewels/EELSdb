<?php
/*
Author Archive Template
*/

// Setup
$author = get_user_by( 'slug', get_query_var( 'author_name' ) );

function count_pending_author_spectra( $userid ) {
	global $wpdb;
	// $where = get_posts_by_author_sql( $post_type, true, $userid );
	$where = "WHERE post_type = 'spectra' AND post_status = 'pending' AND post_author = '".$userid."'";
	$count = $wpdb->get_var( "SELECT COUNT(*) FROM $wpdb->posts $where" );
  	return $count; //apply_filters( 'get_usernumposts', $count, $userid );
}

// Is this the favourites page?
if(isset($_GET['favourites']) && $author->id == get_current_user_id()){
	$favourites_page = true;
	$favourites = get_user_meta(get_current_user_id(), 'eelsdb_favourites');
	if(count($favourites) == 0){
		// Hacky way to make sure that no spectra are returned
		$favourites = array(0);
	}
	$wp_query = new WP_Query( array(
		'post_type'         => 'spectra',
		'post_status'       => 'publish',
		'post__in'			=> $favourites,
		'ignore_sticky_posts' => true,
		'posts_per_page'    => 9999999999,  // -1 should work, but doesn't
	)); 
} else {
	$favourites_page = false;
	$pending_posts = $pending_posts = count_pending_author_spectra(get_current_user_id());
	// Don't limit post count
	global $wp_query;
	$args = array_merge( $wp_query->query_vars, array( 'posts_per_page' => 9999999999 ) ); // -1 should work, but doesn't
	query_posts( $args );
}

get_header(); 

?>


<h1><?php echo $author->display_name; ?>'s <?php echo $favourites_page ? 'Favourite' : 'Uploaded'; ?> Spectra</h1>

<div id="bbpress-forums">

	<div id="row">

		<div class="col-sm-9 col-sm-push-3">
			<?php
			// Note about any pending posts
			if(!$favourites_page && $author->id == get_current_user_id()){
				if($pending_posts > 0){ 
				?>
					<div class="alert alert-warning">You currently have <strong><?php echo $pending_posts; ?></strong> spectr<?php echo $pending_posts > 1 ? 'a' : 'um'; ?> awaiting review.</div>
				<?php 
				}
			}
			// Go through spectra
			if (have_posts()) { 
				if($favourites_page) {
					echo '<h3>Your Favourite Spectra</h3>';
                    echo '<p>Click the red heart icon next to a spectrum title to set it as a favourite.</p>';
				} else {
					echo '<h3>Uploaded Spectra</h3>';
				}
				?>
				<table class="table table-striped">
				<thead>
					<tr>
						<th>Spectrum Title</th>
						<th>Formula</th>
						<th class="hidden-xs">Edge</th>
						<th class="hidden-xs hidden-sm text-right">Min Energy</th>
						<th class="hidden-xs hidden-sm text-right">Max Energy</th>
						<th class="hidden-xs hidden-sm hidden-md">Source &amp; Purity</th>
						<th class="hidden-xs text-center">Spectrum Type</th>
						<th class="hidden-xs hidden-sm hidden-md text-center">Date Submitted</th>
						<?php if(!$favourites_page){ ?>
						<th class="hidden-xs hidden-sm hidden-md text-center">Actions</th>
						<?php }?>
					</tr>
				</thead>
				<tbody>
				<?php
				while(have_posts()){
					the_post();
					$data = get_spectrum_data($post->ID);
					// echo '<pre>'.print_r(get_post_meta($post->ID), true).'</pre>';
					$link = get_the_permalink();
					if(!isset($data['source_purity'])){
						$s_purity = $s_purity_title = '';
					} else{
						$s_purity_title = $data['source_purity'];
						if(strlen($data['source_purity']) < 30){
							$s_purity = $data['source_purity'];
						} else {
							$s_purity = substr($data['source_purity'], 0, 30).'&hellip;';
						}
					}
					global $spectra_types;
					if(isset($data['spectrumType']) && array_key_exists($data['spectrumType'], $spectra_types)){
						$s_type = $spectra_types[$data['spectrumType']];
					} else $s_type = '';
					if(get_post_status() == 'private'){
						echo '<tr class="danger">';
					} else if(get_post_status() == 'pending'){
						echo '<tr class="warning">';
					} else echo '<tr>';
					echo '<td><a href="'.$link.'">'.ucwords(get_the_title()).'</a>';
                    if (get_post_status() == 'pending') echo ' <em>(pending)</em>';
                    echo '</td>';
					echo '<td><a href="'.$link.'">'.(isset($data['spectrumFormula']) ? make_formula_html($data['spectrumFormula']) : '').'</a></td>';
					echo '<td class="hidden-xs"><a href="'.$link.'">'.(isset($data['spectrumEdges']) ? implode(', ', $data['spectrumEdges']) : '').'</a></td>';
					echo '<td class="hidden-xs hidden-sm text-right"><a href="'.$link.'">'.round($data['spectrumMin'], 1).' eV</a></td>';
					echo '<td class="hidden-xs hidden-sm text-right"><a href="'.$link.'">'.round($data['spectrumMax'], 1).' eV</a></td>';
					echo '<td class="hidden-xs hidden-sm hidden-md"><small><a href="'.$link.'" title="'.$s_purity_title.'">'.$s_purity.'</a></small></td>';
					echo '<td class="hidden-xs text-center"><a href="'.$link.'">'.$s_type.'</a></td>';
					echo '<td class="hidden-xs hidden-sm hidden-md text-center"><a href="'.$link.'">'.get_the_date('Y-m-d').'</a></td>';
					if(!$favourites_page){
					echo '<td class="hidden-xs hidden-sm hidden-md text-center"><a href="'.site_url('submit-data/?edit='.$post->ID).'" title="Edit" class="btn btn-sm btn-info"><span class="glyphicon glyphicon-pencil"></span></a></td>';	
					}
					echo '</tr>';
				}
				?>
				</tbody></table>
			<?php
			} else {
				if($favourites_page){
					echo '<div class="alert alert-info"><p>You don\'t have any favourite spectra yet.</p><p>Click the "Add to Favourites" button on a spectrum page to set it as a favourite.</div>';
				} else if($pending_posts == 0) { 
	                if($author->id == get_current_user_id()){ 
	                    echo '<div class="alert alert-info">You have not yet submitted any spectra yet.';
	                    if(isset($edit_spectrum_url)){
	                        echo ' <a href="'.$edit_spectrum_url.'">Click here</a> to submit a spectrum.';
	                    }
	                    echo '</div>';
	                } else {
	                    echo '<div class="alert alert-info">This user has not yet submitted any spectra.</div>';
	                }
				}
            } ?>
		</div>
		
		<div class="col-sm-3 col-sm-pull-9">
			<div class="bbpress-user-sidenav">

				<ul class="nav nav-pills nav-stacked">
					<li><a class="url fn n" href="<?php echo home_url('/forum/users/'.$author->user_nicename); ?>" title="<?php echo $author->display_name; ?>'s Profile" rel="me">View Profile</a></li>
					<?php if($author->id == get_current_user_id()) { ?>
						<li><a href="<?php echo home_url('/forum/users/'.$author->user_nicename); ?>/edit/" title="Edit <?php echo $author->display_name; ?>'s Profile">Edit Profile</a></li>
					<?php } ?>
					<li class="nav-divider"></li>
					<li<?php if(!$favourites_page){ echo ' class="active"'; } ?>><a href="<?php echo get_author_posts_url( $author->id ); ?>" title="<?php echo $author->display_name; ?>'s Uploaded Spectra">Uploaded Spectra</a></li>
					<?php if($author->id == get_current_user_id()) { ?>
						<li<?php if($favourites_page){ echo ' class="active"'; } ?>><a href="<?php echo get_author_posts_url( $author->id ); ?>?favourites" title="<?php echo $author->display_name; ?>'s Favourite Spectra">Favourite Spectra</a></li>
					<?php } ?>
					<li class="nav-divider"></li>
					<li><a href="<?php echo home_url('/forum/users/'.$author->user_nicename); ?>/topics/" title="<?php echo $author->display_name; ?>'s Topics Started">Topics Started</a></li>
					<li><a href="<?php echo home_url('/forum/users/'.$author->user_nicename); ?>/replies/" title="<?php echo $author->display_name; ?>'s Replies Created">Replies Created</a></li>
					<li><a href="<?php echo home_url('/forum/users/'.$author->user_nicename); ?>/favorites/" title="<?php echo $author->display_name; ?>'s Favorites">Favorite Topics</a></li>
					<li><a href="<?php echo home_url('/forum/users/'.$author->user_nicename); ?>/subscriptions/" title="<?php echo $author->display_name; ?>'s Subscriptions">Subscriptions</a></li>
					<li class="nav-divider"></li>

				</ul>
		
				<div class="bbpress-avatar text-center hidden-xs">
					<a href="<?php echo home_url('/forum/users/'.$author->user_nicename); ?>/" title="<?php echo $author->display_name; ?>" rel="me">
						<?php $avatar = get_avatar( $author->id, '150' );
						$avatar = str_replace("class='avatar avatar-150 photo", "class='img-thumbnail ", $avatar);
						echo $avatar;
						?>
					</a>
					</div><!-- #author-avatar -->
				</div>
		</div>
		
	</div>
</div>


<div class="row">
	<div class="col-md-12">
		<?php echo $content; ?>
	</div>
</div>

<?php get_footer(); ?>
	<div class="col-md-12">
		<?php echo $content; ?>
	</div>
</div>

<?php get_footer(); ?>