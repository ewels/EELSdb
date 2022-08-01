<?php
/*
Template Name: Browse EELS DB Spectra
*/
////////////////////////////////////////////
// EELS DB Spectra Plugin
// spectra_browse.php
// Theme template for browsing all spectra
// This is a default template and will be ignored if
// there is a file called "archive-spectra.php"
// in the theme folder..
////////////////////////////////////////////

// NOTE - there is a bunch of code in the core eels-spectra.php file
// which operates this archive page. It needs to be there because it
// has to run before this template is loaded (eg. query filtering)

// Enqueue EELS DB JS
wp_register_script('eelsdb_spectra_view_spectra_js', plugin_dir_url(dirname( __FILE__) ).'js/eelsdb-view-spectra.js', array('jquery') );
wp_enqueue_script( 'eelsdb_spectra_view_spectra_js' );
// Add some CSS
wp_enqueue_style( 'eelsdb_spectra_admin_css', plugin_dir_url( dirname(__FILE__) ).'css/eelsdb_frontend.css' );

get_header();


global $wp_query;

//
// Collect information about filters
//

// Variable setup
$active_filters = false;
$filter_names = array();
$filter_elements = array();
$s_type = '';
$s_energy_min = '';
$s_energy_max = '';
$s_monochromated = false;
$periodic_table = file_get_contents(plugin_dir_path( __FILE__ ).'../resources/periodic_table.html');
$el_names = json_decode(file_get_contents(plugin_dir_path( __FILE__ ).'../resources/element_names.json'));

// echo '<pre>'.print_r($wp_query->meta_query->queries, true).'</pre>';
if(isset($wp_query->meta_query->queries) && count($wp_query->meta_query->queries) > 0){
	if(isset($wp_query->meta_query->queries[1])){
		foreach($wp_query->meta_query->queries[1] as $query){

			if(!is_array($query) || !array_key_exists('key', $query)){
				continue;
			}

			// Element filtering
			if($query['key'] == 'spectrumElement'){
				$filter_elements[] = $query['value'];
			}

			// Meta data filters
			if($query['key'] == 'spectrumType'){
				$s_type = $query['value'];
				$filter_names['spectrumType'] = $spectra_types_text[$query['value']];
				$active_filters = true;
			} else if($query['key'] == 'spectrumFormula' && isset($query['value']) && $query['value'] !== ''){
				$s_formula = $query['value'];
				$filter_names['spectrumFormula'] = 'Formula: '.$query['value'];
				$active_filters = true;
			} else if($query['key'] == 'spectrumMin'){
				$s_energy_min = $query['value'];
				$s_energy_min_op = $query['compare'];
				$filter_names['spectrumEnergyMin'] = 'Min: '.$s_energy_min_op.$query['value'];
				$active_filters = true;
			} else if($query['key'] == 'spectrumMax'){
				$s_energy_max = $query['value'];
				$s_energy_max_op = $query['compare'];
				$filter_names['spectrumEnergyMax'] = 'Max: '.$s_energy_max_op.$query['value'];
				$active_filters = true;
			} else if($query['key'] == 'resolution'){
				$s_resolution = $query['value'];
				$s_resolution_op = $query['compare'];
				$filter_names['resolution'] = 'Res: '.$query['compare'].' '.$query['value'];
				$active_filters = true;
			} else if($query['key'] == 'spectrumEdges'){
				$s_edgeType = $query['value'];
				$filter_names['spectrumEdgeType'] = 'Edge: '.$query['value'];
				$active_filters = true;
			} else if($query['key'] == 'monochromated'){
				$filter_names['monochromatedFilter'] = 'Monochromated';
				$s_monochromated = true;
				$active_filters = true;
			}
		}

		// Did we get any elements?
		if(count($filter_elements) > 0){
			$active_filters = true;
		}
	}
}

// Get the spectrum text search
$s_search = '';
if(isset($wp_query->query_vars['s']) && strlen($wp_query->query_vars['s']) > 0){
	$s_search = $wp_query->query_vars['s'];
	$filter_names['title'] = $s_search;
	$active_filters = true;
}
// Get the spectrum author search
$s_author = '';
$s_author_matches = array();
// Are we trying to set the author?
$filters = get_user_meta(get_current_user_id(), 'eelsdb_filters')[0];
if(isset($filters['spectrumAuthor']) && strlen($filters['spectrumAuthor'])){
	// Display what we typed in
	$s_author = $filters['spectrumAuthor'];
	// What users did the search return?
	if (isset($wp_query->query_vars['author__in']) && count($wp_query->query_vars['author__in']) > 0){
		foreach($wp_query->query_vars['author__in'] as $author_id){
			$author_name = trim(get_the_author_meta('display_name', $author_id));
			if(strlen($author_name) > 0){
				$s_author_matches[] = $author_name;
				$filter_names['author'] = $author_name;
			}
		}
		$active_filters = true;
	}
}

// Build the sorting URLs
$baseURL = ''; //$_SERVER["SERVER_PROTOCOL"].$_SERVER["HTTP_HOST"].basename($_SERVER["REQUEST_URI"]);
$sortURL = [
	'title' => $baseURL.'?spectraSortBy=title',
	'spectrumFormula' => $baseURL.'?spectraSortBy=spectrumFormula',
	'spectrumEdges' => $baseURL.'?spectraSortBy=spectrumEdges',
	'spectrumMin' => $baseURL.'?spectraSortBy=spectrumMin',
	'spectrumMax' => $baseURL.'?spectraSortBy=spectrumMax',
	'resolution' => $baseURL.'?spectraSortBy=resolution',
	'source_purity' => $baseURL.'?spectraSortBy=source_purity',
	'spectrumType' => $baseURL.'?spectraSortBy=spectrumType',
	'author' => $baseURL.'?spectraSortBy=author',
	'date' => $baseURL.'?spectraSortBy=date'
];
$sortIcon = [
	'title' => '',
	'spectrumFormula' => '',
	'spectrumEdges' => '',
	'spectrumMin' => '',
	'spectrumMax' => '',
	'resolution' => '',
	'source_purity' => '',
	'spectrumType' => '',
	'author' => '',
	'date' => ''
];
$orderBy = $wp_query->query_vars['orderby'];
if($orderBy == 'meta_value' || $orderBy == 'meta_value_num'){
	$orderBy = $wp_query->query_vars['meta_key'];
}

if(array_key_exists($orderBy, $sortURL)){
	if($wp_query->query_vars['order'] == 'ASC'){
		$sortURL[$orderBy] .= '&spectraSortByOrder=DESC';
		$sortIcon[$orderBy] = ' <span class="glyphicon glyphicon-triangle-bottom"></span>';
	} else {
		$sortIcon[$orderBy] = ' <span class="glyphicon glyphicon-triangle-top"></span>';
	}
}
// echo '<pre>'.print_r($_SERVER, true).'</pre>';
// echo '<pre>'.print_r($wp_query->query_vars, true).'</pre>';


?>

<h1>
	Browse Spectra
	<button onclick="jQuery('#eelsdb_browse_filter').slideToggle();" type="button" class="btn btn-success pull-right">Show / Hide Filters</button>
</h1>


<div id="active_filters_bar">Active Filters:
<?php // Green Clear Filters button
if($active_filters){
	global $browse_spectrum_url;
	foreach ($filter_names as $f_type => $filter) {
		// Button for each active filter
		echo '<a href="'.$browse_spectrum_url.'?clear_filters='.$f_type.'" class="btn btn-xs btn-success" data-toggle="tooltip" data-placement="bottom" title="Clear Filter">'.$filter.'</a> ';
	}
	foreach($filter_elements as $filter){
		// Button for each active element filter
		echo '<a href="'.$browse_spectrum_url.'?clear_filters=spectrumElements&amp;spectrumElement='.$filter.'" class="btn btn-xs btn-success" data-toggle="tooltip" data-placement="bottom" title="Clear Filter">'. $el_names->$filter.'</a> ';
	}
	// Clear all filters button
	echo '<a href="'.$browse_spectrum_url.'?clear_filters=all" class="btn btn-xs btn-danger" data-toggle="tooltip" data-placement="bottom"  title="Clear All Filters">Clear All</a>';
} else {
	echo '<span class="text-muted"><em>None</em></span>';
} ?>
</div>


<?php // Couldn't find any authors - apologise...
if(isset($_POST['set_filters']) && isset($_POST['spectrumAuthor']) && strlen(trim($_POST['spectrumAuthor'])) > 0 && count($s_author_matches) == 0){
	echo '<div class="alert alert-danger"><strong>Author <em>'.$_POST['spectrumAuthor'].'</em> not found.</strong>. Please search by username or e-mail (comma separate multiple search terms).</div>';
}
?>
<hr style="margin-top:10px;">

<form style="display:none;" id="eelsdb_browse_filter" class="form-horizontal" action="<?php echo get_post_type_archive_link('spectra'); ?>" method="post" role="form">
	<div class="row">
		<div class="col-md-6">
			<div class="form-group">
				<label for="spectrumType" class="col-sm-4 control-label">Spectra type</label>
				<div class="col-sm-8">
					<select class="form-control" id="spectrumType" name="spectrumType">
						<option value="">[ All Spectra ]</option>
						<option value="coreloss" <?php if($s_type == 'coreloss'){ echo ' selected="selected"'; } ?>>Core Loss</option>
						<option value="lowloss" <?php if($s_type == 'lowloss'){ echo ' selected="selected"'; } ?>>Low Loss</option>
						<option value="zeroloss" <?php if($s_type == 'zeroloss'){ echo ' selected="selected"'; } ?>>Zero Loss</option>
						<option value="xrayabs" <?php if($s_type == 'xrayabs'){ echo ' selected="selected"'; } ?>>X Ray Abs</option>
					</select>
				</div>
			</div>
			<div class="form-group">
				<label for="spectrumText" class="col-sm-4 control-label">Spectrum Title</label>
				<div class="col-sm-8">
					<input class="form-control" id="spectrumText" name="spectrumText" placeholder="Search Text" value="<?php echo $s_search; ?>">
				</div>
			</div>
			<div class="form-group">
				<label for="spectrumAuthor" class="col-sm-4 control-label">Spectra Author</label>
				<div class="col-sm-8">
					<input class="form-control" id="spectrumAuthor" name="spectrumAuthor" placeholder="Spectrum Author" value="<?php echo $s_author; ?>">
				</div>
			</div>
			<div class="form-group">
				<label for="spectrumEdgeType" class="col-sm-4 control-label">Edge Type</label>
				<div class="col-sm-8">
					<select class="form-control" id="spectrumEdgeType" name="spectrumEdgeType">
						<option value="">[ All Spectra ]</option>
						<option value="K" <?php if($s_edgeType == 'K'){ echo ' selected="selected"'; } ?>>K</option>
						<option value="L1" <?php if($s_edgeType == 'L1'){ echo ' selected="selected"'; } ?>>L1</option>
						<option value="L2,3" <?php if($s_edgeType == 'L2,3'){ echo ' selected="selected"'; } ?>>L2,3</option>
						<option value="M2,3" <?php if($s_edgeType == 'M2,3'){ echo ' selected="selected"'; } ?>>M2,3</option>
						<option value="M4,5" <?php if($s_edgeType == 'M4,5'){ echo ' selected="selected"'; } ?>>M4,5</option>
						<option value="N2,3" <?php if($s_edgeType == 'N2,3'){ echo ' selected="selected"'; } ?>>N2,3</option>
						<option value="N4,5" <?php if($s_edgeType == 'N4,5'){ echo ' selected="selected"'; } ?>>N4,5</option>
						<option value="O2,3" <?php if($s_edgeType == 'O2,3'){ echo ' selected="selected"'; } ?>>O2,3</option>
						<option value="O4,5" <?php if($s_edgeType == 'O4,5'){ echo ' selected="selected"'; } ?>>O4,5</option>
					</select>
				</div>
			</div>
			<div class="form-group">
				<label for="monochromatedFilter" class="col-sm-4 control-label">Features</label>
				<div class="col-sm-8">
					<div class="checkbox">
						<label>
							<input type="checkbox" id="monochromatedFilter" name="monochromatedFilter" value="1" <?php if($s_monochromated) echo 'checked="checked"'; ?>> Monochromated spectra only
						</label>
					</div>
				</div>
			</div>
		</div>
		<div class="col-md-6">
			<div class="form-group">
				<label for="spectrumAuthor" class="col-sm-4 control-label">Spectrum Formula</label>
				<div class="col-sm-8">
					<input class="form-control" id="spectrumFormula" name="spectrumFormula" placeholder="Spectrum Formula" value="<?php echo $s_formula; ?>">
				</div>
			</div>
			<div class="form-group">
				<label for="periodicTableButton" class="col-sm-4 control-label">Spectrum Elements</label>
				<div class="col-sm-8">
					<div class="input-group">
						<button id="periodicTableButton" type="button" class="btn btn-sm btn-default" data-toggle="modal" data-target="#periodicTableModal">Filter Elements</button>
						<?php foreach($filter_elements as $el){
							echo '<input type="hidden" name="spectrumElements[]" value="'.$el.'">'."\n";
						} ?>
						<span id="element_filter_label_label" <?php echo count($filter_elements) == 0 ? 'style="display:none;"' : ''; ?>>
							<small>Currently filtering:</small>
							<?php foreach($filter_elements as $el){
								echo ' <a href="#" data-toggle="modal" data-target="#periodicTableModal" class="label label-default element_filter_label" id="element_filter_label_'.$el.'">'.$el.'</a>'."\n";
							} ?>
						</span>
					</div>
				</div>
			</div>

			<div class="form-group">
				<label for="spectrumEnergyMin" class="col-sm-4 control-label">Minimum Energy</label>
				<div class="col-sm-2">
					<select class="form-control" id="spectrumEnergyMinOp" name="spectrumEnergyMinOp">
						<option value="lt" <?php if($s_energy_min_op == '<='){ echo ' selected="selected"'; } ?>>&lt;=</option>
						<option value="gt" <?php if($s_energy_min_op == '>='){ echo ' selected="selected"'; } ?>>&gt;=</option>
					</select>
				</div>
				<div class="col-sm-6">
					<div class="input-group">
						<input class="form-control" id="spectrumEnergyMin" name="spectrumEnergyMin" placeholder="Minimum" value="<?php echo $s_energy_min; ?>">
						<span class="input-group-addon">eV</span>
					</div>
				</div>
			</div>
			<div class="form-group">
				<label for="spectrumEnergyMin" class="col-sm-4 control-label">Maximum Energy</label>
				<div class="col-sm-2">
					<select class="form-control" id="spectrumEnergyMaxOp" name="spectrumEnergyMaxOp">
						<option value="gt" <?php if($s_energy_max_op == '>='){ echo ' selected="selected"'; } ?>>&gt;=</option>
						<option value="lt" <?php if($s_energy_max_op == '<='){ echo ' selected="selected"'; } ?>>&lt;=</option>
					</select>
				</div>
				<div class="col-sm-6">
					<div class="input-group">
						<input class="form-control" id="spectrumEnergyMax" name="spectrumEnergyMax" placeholder="Maximum" value="<?php echo $s_energy_max; ?>">
						<span class="input-group-addon">eV</span>
					</div>
				</div>
			</div>
			<div class="form-group">
				<label for="resolution" class="col-sm-4 control-label">Resolution</label>
				<div class="col-sm-2">
					<select class="form-control" id="resolutionOp" name="resolutionOp">
						<option value="gt" <?php if($s_resolution_op == '>='){ echo ' selected="selected"'; } ?>>&gt;=</option>
						<!-- <?php // DOESN'T WORK? ?>					<option value="eq" <?php if($s_resolution_op == '='){ echo ' selected="selected"'; } ?>>=</option>   -->
						<option value="lt" <?php if($s_resolution_op == '<='){ echo ' selected="selected"'; } ?>>&lt;=</option>
					</select>
				</div>
				<div class="col-sm-6">
					<div class="input-group">
						<input class="form-control" id="resolution" name="resolution" placeholder="Resolution" value="<?php echo $s_resolution; ?>">
						<span class="input-group-addon">eV</span>
					</div>
				</div>
			</div>
		</div>
	</div>
	<div class="form-group well" id="filterSubmit">
		<input type="submit" class="btn btn-lg btn-primary" name="set_filters" value="Filter Spectra">
		<button type="submit" class="btn btn-lg btn-default" name="clear_filters" value="all" <?php if(!$active_filters){ echo 'disabled'; }?>>Clear Filters</button>
		<div class="clearfix"></div>
	</div>
	<?php // echo '<pre>'.print_r(get_user_meta(get_current_user_id(), 'eelsdb_filters')[0]).'</pre>; ?>
	<hr>
</form>

<?php if (have_posts()) {	?>

	<table class="table table-striped table-browse-spectra">
		<thead>
			<tr>
				<th><a href="<?php echo $sortURL['title']; ?>">Spectrum Title<?php echo $sortIcon['title']; ?></a></th>
				<th><a href="<?php echo $sortURL['spectrumFormula']; ?>">Formula<?php echo $sortIcon['spectrumFormula']; ?></a></th>
				<th class="hidden-xs"><a href="<?php echo $sortURL['spectrumEdges']; ?>">Edge<?php echo $sortIcon['spectrumEdges']; ?></a></th>
				<th class="hidden-xs hidden-sm text-right"><a href="<?php echo $sortURL['spectrumMin']; ?>">Min Energy<?php echo $sortIcon['spectrumMin']; ?></a></th>
				<th class="hidden-xs hidden-sm text-right"><a href="<?php echo $sortURL['spectrumMax']; ?>">Max Energy<?php echo $sortIcon['spectrumMax']; ?></a></th>
				<th class="hidden-xs hidden-sm text-right"><a href="<?php echo $sortURL['resolution']; ?>">Resolution<?php echo $sortIcon['resolution']; ?></a></th>
				<th class="hidden-xs hidden-sm hidden-md"><a href="<?php echo $sortURL['source_purity']; ?>">Source &amp; Purity<?php echo $sortIcon['source_purity']; ?></a></th>
				<th class="hidden-xs text-center"><a href="<?php echo $sortURL['spectrumType']; ?>">Spectrum Type<?php echo $sortIcon['spectrumType']; ?></a></th>
				<?php if(strlen($s_author) > 0){ ?>
					<th class="hidden-xs hidden-sm hidden-md"><a href="<?php echo $sortURL['author']; ?>">Author<?php echo $sortIcon['author']; ?></a></th>
					<?php } ?>
					<th class="hidden-xs hidden-sm hidden-md text-center"><a href="<?php echo $sortURL['date']; ?>">Date Submitted<?php echo $sortIcon['date']; ?></a></th>
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
				} else echo '<tr>';
				echo '<td><a href="'.$link.'">'.ucwords(get_the_title()).'</a></td>';
				echo '<td><a href="'.$link.'">'.(isset($data['spectrumFormula']) ? make_formula_html($data['spectrumFormula']) : '').'</a></td>';
				echo '<td class="hidden-xs"><a href="'.$link.'">'.(isset($data['spectrumEdges']) ? implode(', ', $data['spectrumEdges']) : '').'</a></td>';
				echo '<td class="hidden-xs hidden-sm text-right"><a href="'.$link.'">'.round($data['spectrumMin'], 1).' eV</a></td>';
				echo '<td class="hidden-xs hidden-sm text-right"><a href="'.$link.'">'.round($data['spectrumMax'], 1).' eV</a></td>';
				echo '<td class="hidden-xs hidden-sm text-right"><a href="'.$link.'">';
				if($data['resolution'] > 0) echo sprintf("%.1f", $data['resolution']).' eV</a></td>';
				else echo '- </a></td>';
				echo '<td class="hidden-xs hidden-sm hidden-md"><small><a href="'.$link.'" title="'.$s_purity_title.'">'.$s_purity.'</a></small></td>';
				echo '<td class="hidden-xs text-center"><a href="'.$link.'">'.$s_type.'</a></td>';
				if(strlen($s_author) > 0)
				echo '<td class="hidden-xs hidden-sm hidden-md"><small>'.get_the_author_meta('display_name').'</small></td>';
				echo '<td class="hidden-xs hidden-sm hidden-md text-center"><a href="'.$link.'">'.get_the_date('Y-m-d').'</a></td>';
				echo '</tr>';
			}
		echo '</tbody></table>';

	$current_page = max(1, get_query_var('paged'));
	$total_pages = $wp_query->max_num_pages;
	$posts_per_page = $wp_query->query_vars['posts_per_page'];
	$start_num = (($current_page-1) * $posts_per_page)+1;
	$end_num = $start_num + count($wp_query->posts) - 1;
	$total_num = $wp_query->found_posts;

	// PAGINATION
	// number of posts per page is changed in main eelsdb file.
	$big = 999999999;
	$paginate = paginate_links( array(
		'base' => str_replace( $big, '%#%', esc_url( get_pagenum_link( $big ) ) ),
		'type' => 'array',
		'total' => $total_pages,
		'format' => '?paged=%#%',
		'current' => $current_page,
		'prev_text' => '&laquo;',
		'next_text' => '&raquo;'
	));
	?>

	<div class="pagination-top">
		<?php if ($total_pages > 1){
			echo '<ul class="pagination">';
			foreach ( $paginate as $page ) {
				if($current_page == strip_tags($page)){
					echo '<li class="active">'.$page.'</li>';
				} else if(strip_tags($page) == '&hellip;'){
					echo '<li class="disabled">'.$page.'</li>';
				} else {
					echo '<li>'.$page.'</li>';
				}
			}
			echo '</ul>';
		} ?>
	</div>
	<form id="posts_per_page_form" class="form-inline" action="<?php echo get_post_type_archive_link('spectra'); ?>" method="post" role="form">
		<div class="form-group">
			<select class="form-control input-sm" id="spectraPostsPerPage" name="spectraPostsPerPage">
				<option<?php if($posts_per_page == 50){ echo ' selected="selected"'; } ?>>50</option>
				<option<?php if($posts_per_page == 100){ echo ' selected="selected"'; } ?>>100</option>
				<option<?php if($posts_per_page == 200){ echo ' selected="selected"'; } ?>>200</option>
				<option<?php if($posts_per_page == -1){ echo ' selected="selected"'; } ?> value="-1">All</option>
			</select>
			<label for="spectraPostsPerPage" class="control-label" style="font-weight:normal;">Spectra per page</label>
			<input type="submit" value="Go" class="btn btn-default btn-sm">
		</div>
	</form>
	<?php
	// How many spectra are we showing?
	echo '<div class="num-spectra-text">'."Showing spectra $start_num to $end_num out of $total_num.</div>";



} else { // do we have any posts to show? ?>
	<div class="alert alert-info" role="alert">
		<h3>No Spectra Found</h3>
		<p>Apologies - no spectra were found with those filtering criteria. Perhaps you could <a href="<?php echo home_url('submit'); ?>">submit one</a>?</p>
	</div>
<?php }

?>

<!-- Filter elements modal -->
<div class="modal fade" id="periodicTableModal" tabindex="-1" role="dialog" aria-labelledby="periodicTableModalTitle" aria-hidden="true">
  <div class="modal-dialog modal-lg">
    <div class="modal-content">
      <div class="modal-header">
        <button type="button" class="close" data-dismiss="modal" aria-label="Close"><span aria-hidden="true">&times;</span></button>
        <h4 class="modal-title" id="periodicTableModalTitle">Filter by Formula</h4>
      </div>
      <div class="modal-body">
        <?php
		// PERIODIC TABLE
		foreach($filter_elements as $el){
			$periodic_table = str_replace(
			'<a href="#" title="'.$el_names->$el.'">'.$el.'</a>',
			'<a href="#" title="'.$el_names->$el.'" class="active">'.$el.'</a>',
			$periodic_table);
		}
		foreach($filter_elements as $el){
			$periodic_table .= '<input type="hidden" name="spectrumElements[]" value="'.$el.'">'."\n";
		}

		// Disable those elements with no spectra
		$spectra_elements = get_all_spectra_elements();
		foreach($spectra_elements as $el){
			$periodic_table = str_replace(
				'<a href="#" title="'.$el_names->$el.'" class="active">'.$el.'</a>',
				'<a href="#" title="'.$el_names->$el.'" class="active has-spectra">'.$el.'</a>',
				$periodic_table);
			$periodic_table = str_replace(
				'<a href="#" title="'.$el_names->$el.'">'.$el.'</a>',
				'<a href="#" title="'.$el_names->$el.'" class="has-spectra">'.$el.'</a>',
				$periodic_table);
		}
		echo $periodic_table;
		?>
      </div>
      <div class="modal-footer">
        <button type="button" class="btn btn-primary" data-dismiss="modal">Set Elements</button>
        <!-- <button type="button" class="btn btn-primary">Save changes</button> -->
      </div>
    </div>
  </div>
</div>

<?php get_footer(); ?>
