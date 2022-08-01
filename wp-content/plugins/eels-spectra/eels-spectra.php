<?php
/*
Plugin Name: EELS Spectra
Plugin URI: https://eelsdb.eu
Description: Plugin to handle administration, submission and display of EELS Spectra
Version: 1.0
Author: Phil Ewels
Author URI: http://phil.ewels.co.uk
License: GPLv2
*/

//////////////////////////
// Config Variables
//////////////////////////
$browse_spectrum_url = home_url('spectra/');
$edit_spectrum_url = home_url('submit-data/');

//////////////////////////
// Custom Post Type setup
//////////////////////////
function eels_post_type() {
	$labels = array(
		'name' => 'EELS Spectra',
		'singular_name' => 'EELS Spectrum',
		'add_new' => 'Add New',
		'add_new_item' => 'Add New Spectrum',
		'edit_item' => 'Edit Spectrum',
		'new_item' => 'New Spectrum',
		'view_item' => 'View Spectrum',
		'search_items' => 'Search Spectra',
		'not_found' => 'No Spectra found',
		'not_fount_in_trash' => 'No Spectra found in Trash'
	);

	$args = array(
		'labels' => $labels,
		'public' => true,
		'menu_icon' => 'dashicons-chart-line',
		'exclude_from_search' => false,
		'publicly_queryable' => true,
		'show_ui' => true,
		'show_in_menu' => true,
		'query_var' => true,
		'rewrite' => true,
		'capability_type' => array('spectrum', 'spectra'),
		'map_meta_cap' => true,
		'has_archive' => true,
		'hierarchical' => false,
		'menu_position' => 6,
		'supports' => array('title', 'excerpt', 'author', 'revisions')
	);

	register_post_type('spectra', $args);
}
add_action('init', 'eels_post_type');

// Set up the taxonomy - keywords instead of post tags
function create_spectra_keyword_tax() {
	$labels = array(
		'name'                       => __( 'Associated Keywords' ),
		'singular_name'              => __( 'Associated Keyword' ),
		'search_items'               => __( 'Search Associated Keywords' ),
		'popular_items'              => __( 'Popular Keywords' ),
		'all_items'                  => __( 'All Keywords' ),
		'parent_item'                => null,
		'parent_item_colon'          => null,
		'edit_item'                  => __( 'Edit Keyword' ),
		'update_item'                => __( 'Update Keyword' ),
		'add_new_item'               => __( 'Add New Keyword' ),
		'new_item_name'              => __( 'New Keyword Name' ),
		'separate_items_with_commas' => __( 'Separate keywords with commas' ),
		'add_or_remove_items'        => __( 'Add or remove keywords' ),
		'choose_from_most_used'      => __( 'Choose from the most used keywords' ),
		'not_found'                  => __( 'No keywords found.' ),
		'menu_name'                  => __( 'Keywords' ),
	);
	$args = array(
		'hierarchical'          => false,
		'labels'                => $labels,
		'show_ui'               => true,
		'show_admin_column'     => false,
		'update_count_callback' => '_update_post_term_count',
		'query_var'             => true,
	);
	register_taxonomy('keywords', 'spectra', $args);
}
add_action( 'init', 'create_spectra_keyword_tax' );

// Add our upload mime types into WordPress security settings
function eelsdb_upload_mimes ( $existing_mimes ) {
	$existing_mimes['msa'] = 'text/plain';
	$existing_mimes['dm3'] = 'text/plain';
	return $existing_mimes;
}
add_filter( 'mime_types', 'eelsdb_upload_mimes' );

// Allow admins to set a subscriber as the author of a spectrum
function eeldb_post_author_select($output){
	global $post;
	if($post->post_type == 'spectra'){
	    $users = get_users();
	    $output = '<select id="post_author_override" name="post_author_override" class="">';
	    foreach($users as $user) {
	        $sel = ($post->post_author == $user->ID) ? "selected='selected'" : '';
	        $output .= '<option value="'.$user->ID.'"'.$sel.'>'.$user->display_name.'</option>';
	    }
	    $output .= '</select>';
	    return $output;
	} else { return $output; }
}
add_filter('wp_dropdown_users', 'eeldb_post_author_select');

// Spectra types array
$spectra_types = array(
	'coreloss' => '<span class="label label-primary">Core Loss</span>',
	'lowloss' => '<span class="label label-success">Low Loss</span>',
	'zeroloss' => '<span class="label label-default">Zero Loss</span>',
	'xrayabs' => '<span class="label label-danger">X Ray Abs</span>'
);
$spectra_types_short = array(
	'coreloss' => '<span class="label label-primary" title="Core Loss">CL</span>',
	'lowloss' => '<span class="label label-success" title="Low Loss">LL</span>',
	'zeroloss' => '<span class="label label-default" title="Zero Loss">ZL</span>',
	'xrayabs' => '<span class="label label-danger" title="X Ray Abs">XR</span>'
);
$spectra_types_text = array(
	'coreloss' => 'Core Loss',
	'lowloss' => 'Low Loss',
	'zeroloss' => 'Zero Loss',
	'xrayabs' => 'X Ray Abs'
);

// Spectra elements
function get_all_spectra_elements (){
	global $wpdb;
	$spectra_elements = $wpdb->get_col( $wpdb->prepare( "
	        SELECT DISTINCT pm.meta_value FROM {$wpdb->postmeta} pm
	        LEFT JOIN {$wpdb->posts} p ON p.ID = pm.post_id
	        WHERE pm.meta_key = '%s'
	        AND p.post_status = '%s'
	        AND p.post_type = '%s'
	    ", 'spectrumElement', 'publish', 'spectra' ) );
  return $spectra_elements;
}

// Function to make Formula look nice with HTML
function make_formula_html ($formula){
	$html_formula = preg_replace('/(\d+[\.\d+]?)/', '<sub>${1}</sub>', $formula);
	if($html_formula == NULL || strlen($html_formula) < strlen($formula)){
		$html_formula = $formula;
	}
	return $html_formula;
}

// Set the meta_keys
$meta_keys = ['spectrumType', 'spectrumMin', 'spectrumMax', 'stepSize',
	'spectrumFormula', 'spectrumElement', 'spectrumUpload', 'source_purity', 'spectrumEdges',
	'microscope', 'guntype', 'beamenergy', 'resolution', 'monochromated',
	'acquisition_mode', 'convergence', 'collection', 'probesize', 'beamcurrent',
	'integratetime', 'readouts', 'detector', 'darkcurrent', 'gainvariation', 'calibration',
	'zeroloss_deconv', 'thickness', 'deconv_fourier_log', 'deconv_fourier_ratio',
	'deconv_stephens_deconvolution', 'deconv_richardson_lucy', 'deconv_maximum_entropy',
	'deconv_other', 'assoc_spectra', 'ref_freetext', 'ref_doi', 'ref_url', 'ref_authors',
	'ref_journal', 'ref_volume', 'ref_issue', 'ref_page', 'ref_year', 'ref_title', 'otherURLs' ];
$numeric_meta_keys = ['spectrumMin', 'spectrumMax', 'stepSize', 'beamenergy', 'resolution',
	'convergence', 'collection', 'probesize', 'beamcurrent', 'integratetime', 'readouts',
	'thickness', 'deconv_fourier_ratio', 'ref_year'];
// Function to return meta data
function get_spectrum_data ($post_id){
	global $meta_keys;
	$data = array();
	foreach(get_post_meta($post_id) as $key => $var){
		if(is_serialized($var[0])){
			$data[$key] = unserialize($var[0]);
		} else if(in_array($key, $meta_keys)) {
			if(count($var) == 1){
				$data[$key] = $var[0];
			} else {
				$data[$key] = $var;
			}
		}
	}
	return $data;
}

// Find min and max of spectra file
function find_spectra_min_max($fn){
	if(!file_exists($fn)){
		return array('', '');
	}
	$spectrum_min = 999999999999;
	$spectrum_max = -999999999999;
    $spectrum_res_a = [];
    $lastline = 0;
	$lines = file($fn);
	foreach ($lines as $line) {
		$line = trim($line);
		if(substr($line, 0, 1) == '#'){
			continue;
		} else {
			$parts = preg_split('/\s+/', $line);
			$energy = preg_replace("/[,]/", "", $parts[0]);
            $lastline_diff = $energy - $lastline;
			if($energy < $spectrum_min){
				$spectrum_min = $energy;
			}
			if($energy > $spectrum_max){
				$spectrum_max = $energy;
			}
            if($lastline > 0 && $lastline_diff > 0){
                $spectrum_res_a[] = $lastline_diff;
            }
            $lastline = $energy;
		}
	}
	if($spectrum_min == 999999999999){
		$spectrum_min = '';
	}
	if($spectrum_max == -999999999999){
		$spectrum_max = '';
	}
    if(count($spectrum_res_a) == 0){
        $spectrum_res = '';
    } else {
        $spectrum_res = round(array_sum($spectrum_res_a) / count($spectrum_res_a), 3);
    }
	return array($spectrum_min, $spectrum_max, $spectrum_res);
}

// Helper functions
function st_isset ($var){
  if(isset($var) && strlen($var) > 0){
    return true;
  } else {
    return false;
  }
}
function nm_isset ($var){
  if(!st_isset($var)){ return false; }
  if(!is_numeric($var)){ return false; }
  if($var == 0){ return false; }
  return true;
}
function yn_isset ($var){
  if(isset($var)){
    return true;
  } else {
    return false;
  }
}
function unser_array ($var){
  if(@unserialize($var)){
    $var = unserialize($var);
  }
  if(is_array($var)){
    return $var;
  } else {
    return false;
  }
}

//////////////////////////
// Load Other Scripts
//////////////////////////
add_action('wp_enqueue_scripts', 'eelsdb_enqueue_scripts');
function eelsdb_enqueue_scripts() {
	wp_enqueue_script('jquery');
	wp_enqueue_script( 'eelsdb_highcharts_js', plugin_dir_url(__FILE__).'js/highcharts.js', array('jquery') );
	wp_enqueue_script( 'eelsdb_highcharts_exporting_js', '//code.highcharts.com/modules/exporting.js', array('jquery') );
}

require_once('emails.php');
require_once('spectra_admin.php');
require_once('api/common_api.php'); // This then imports what it needs.
require_once('front_end/spectra_browse.php');
require_once('front_end/spectra_submit_spectrum.php');
require_once('front_end/spectra_search.php');

// require_once('import_old_db.php');


/////////////////////////////////////////////////////
// SIMPLE SHORT CODES
// For use in the theme, eg. the homepage
/////////////////////////////////////////////////////

// Count spectra
function eels_count_objects($atts, $content = null) {
	// Filter for one type of spectrum
	global $spectra_types_text;
	$types = array_keys($spectra_types_text);
	if(isset($atts['type']) && in_array($atts['type'], $types)){
		$meta_value = $atts['type'];
		$sql = "SELECT count(DISTINCT pm.post_id)
						FROM $wpdb->postmeta pm
						JOIN $wpdb->posts p ON (p.ID = pm.post_id)
						WHERE pm.meta_key = 'spectrumType'
						AND pm.meta_value = '$meta_value'
						AND p.post_type = 'spectra'
						AND p.post_status = 'publish'";
		$count = $wpdb->get_var($sql);
	}
	// Count elements
	else if(isset($atts['type']) && $atts['type'] == 'elements'){
		$elements = get_all_spectra_elements();
		$count = count($elements);
	}
	// Count all spectra
	else {
		$count_obj = wp_count_posts('spectra');
		$count = $count_obj->publish;
	}
	return $count;
}
add_shortcode('eels-count', 'eels_count_objects');

// List registered users in table
function eelsdb_list_users($atts, $content = null) {
	$users = get_users(array(
		'meta_key' => 'first_name',
		'orderby'  => 'meta_var'
	));
	$u_table = '<table class="table table-hover table-condensed"><thead><tr>
		<th>Name</th>
		<th>Laboratory</th>
		<th>Uploaded Spectra</th>
	</tr></thead><tbody>';
	foreach($users as $u){
		$uid = $u->data->ID;
		$udata = get_userdata($uid);
		$profile_url = home_url('forum/users/'.get_the_author_meta('user_nicename', $uid).'/');
		$spectra_url = get_author_posts_url($uid);
		$u_table .= '<tr>
			<td><a href="'.$profile_url.'">'.get_the_author_meta('display_name', $uid).'</a></td>
			<td>'.$udata->u_lab.'</td>
			<td class="text-center"><a href="'.$spectra_url.'">'.count_user_posts($uid , 'spectra').'</a></td>
		</tr>';
	}
	$u_table .= '</tbody></table>';
	return $u_table;
}
add_shortcode('eelsdb-users', 'eelsdb_list_users');


/////////////////////////////////////////////////////
// VIEW SINGLE SPECTRA
// Queue up the single spectrum template if there isn't
// a file in the theme folder called single-spectra.php
/////////////////////////////////////////////////////
add_filter('single_template', 'eelsdb_single_template');
function eelsdb_single_template ($template) {
    if (get_post_type(get_queried_object_id()) == 'spectra' &&
		(!$template || basename($template) != 'single-spectra.php')) {
        $template = dirname(__FILE__) . '/front_end/spectra_view_spectrum.php';
    }
	return $template;
}


/////////////////////////////////////////////////////
// AUTHOR PAGE
// Show pending posts as well..
/////////////////////////////////////////////////////
add_action('pre_get_posts', 'eelsdb_author_show_pending');
function eelsdb_author_show_pending ($query) {
    // is_author(current_user_id()) doesn't seem to work for some reason
    // Are we looking at an author page?
    if(is_author()){
        $author = get_user_by( 'slug', get_query_var( 'author_name' ) );
        // Is it our own author page?
        if($author->id == get_current_user_id() || current_user_can('edit_others_posts')){
            $query->set('post_status', 'any');
        }
    }
}



?>
