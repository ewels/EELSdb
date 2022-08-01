<?php

////////////////////////////////////////////
// EELS DB Spectra Plugin
// spectra_admin.php
// Customisation of administration back end
////////////////////////////////////////////

////////////////////////////////
// Add Columns to List View
////////////////////////////////
function eelsdb_columns_head($defaults) {
	$date = array_pop($defaults);
	$defaults['spectrum_formula'] = 'Formula';
	$defaults['spectrum_type'] = 'Spectrum Type';
	$defaults['date'] = $date;
	return $defaults;
}
function eelsdb_columns_content($column_name, $post_ID) {
	if ($column_name == 'spectrum_formula' || $column_name == 'spectrum_type') {
		$data = get_post_meta($post_ID);
		// echo '<pre>'.print_r($data, true).'</pre>';
		if ($column_name == 'spectrum_formula') {
			echo '<a href="'.get_edit_post_link($post_ID).'">'.$data['spectrumFormula'][0].'</a>';
		}
		if ($column_name == 'spectrum_type') {
			global $spectra_types;
			echo '<a href="'.get_edit_post_link($post_ID).'">'.$spectra_types[$data['spectrumType'][0]].'</a>';
		}
	}
}
add_filter('manage_spectra_posts_columns', 'eelsdb_columns_head');
add_action('manage_spectra_posts_custom_column', 'eelsdb_columns_content', 10, 2);


////////////////////////////////
// Admin Javascript and CSS
////////////////////////////////
add_action('admin_enqueue_scripts', 'eelsdb_spectra_validate_js');
function eelsdb_spectra_validate_js(){
	global $typenow;
	if($typenow == 'spectra'){
		// Enqueue jQuery Validate scripts
		// VALIDATION REMOVED. This is so we can save spectra with missing fields if we want to.
		// Left in as comments so that we can come back to it if we want to.
		// wp_enqueue_script('eelsdb_spectra_validate', plugin_dir_url( __FILE__ ).'libraries/jquery.validate.min.js', array('jquery'));
		// wp_enqueue_script('eelsdb_spectra_validate_additional_methods', plugin_dir_url( __FILE__ ).'libraries/additional-methods.min.js', array('jquery'));

		// Enqueue EELS DB JS, with clever WP stuff to make PHP variables available to file
		wp_register_script('eelsdb_spectra_submit_js', plugin_dir_url( __FILE__ ).'js/eelsdb-submit-spectra.js', array('jquery'));
		$php_vars_array = array( 'plugin_dir_url' => plugin_dir_url( __FILE__ ).'resources/', 'admin' => 1, 'spectrumEdges' => $s_edge, 'spectrumLevel' => $s_level );
		wp_localize_script( 'eelsdb_spectra_submit_js', 'php_vars', $php_vars_array );
		wp_enqueue_script( 'eelsdb_spectra_submit_js' );

		// Add some CSS
		wp_enqueue_style( 'eelsdb_spectra_admin_css', plugin_dir_url( __FILE__ ).'css/eelsdb_admin.css' );
	}
}

// Change form enctype to allow file uploads
function eelsdb_spectra_add_post_enctype() {
    echo ' enctype="multipart/form-data"';
}
add_action('post_edit_form_tag', 'eelsdb_spectra_add_post_enctype');

// Instead of 'Enter title here' prompt for Specimen Name
function eelsdb_spectra_admin_title_prompt ( $title ){
     $screen = get_current_screen();
     if ($screen->post_type == 'spectra') {
          $title = 'Enter specimen name here';
     }
     return $title;
}
add_filter( 'enter_title_here', 'eelsdb_spectra_admin_title_prompt' );

// Add the metaboxes
function eelsdb_spectra_admin_init_custpost(){
	add_meta_box("eelsdb_spectra_metadata_metabox", "Spectrum Description", "eelsdb_spectra_metadata_metabox", "spectra", "normal", "high");
    add_meta_box("eelsdb_spectra_edges_metabox", "Feature Identification", "eelsdb_spectra_edges_metabox", "spectra", "normal", "high");
    add_meta_box("eelsdb_spectra_acquisition_metabox", "Microscope Acquisition Details", "eelsdb_spectra_acquisition_metabox", "spectra", "normal", "high");
    add_meta_box("eelsdb_spectra_data_treatment_metabox", "Spectra Data Treatment Tags", "eelsdb_spectra_data_treatment_metabox", "spectra", "normal", "high");
    add_meta_box("eelsdb_spectra_references_metabox", "Associated References", "eelsdb_spectra_references_metabox", "spectra", "side", "high");
    add_meta_box("eelsdb_spectra_assoc_spectra_metabox", "Associated Spectra", "eelsdb_spectra_assoc_spectra_metabox", "spectra", "normal", "default");
	// Change "The Excerpt" to "Comments"
	global $wp_meta_boxes;
	$wp_meta_boxes['spectra']['normal']['core']['postexcerpt']['title']= 'Comments';
}
add_action("add_meta_boxes", "eelsdb_spectra_admin_init_custpost");

// Metabox for Spectra Metadata
function eelsdb_spectra_metadata_metabox(){
	global $post;
	wp_nonce_field(plugin_basename(__FILE__), 'eelsdb_spectra_upload_nonce');
	$data = get_spectrum_data($post->ID);
	$s_type = isset($data['spectrumType']) ? $data['spectrumType'] : '';
	$s_upload = isset($data['spectrumUpload']) ? $data['spectrumUpload'] : false;
	$s_name = isset($data['spectrumName']) ? $data['spectrumName'] : '';
	$s_formula = isset($data['spectrumFormula']) ? $data['spectrumFormula'] : '';
	$s_source_purity = isset($data['source_purity']) ? $data['source_purity'] : '';
	?>
	<table width="100%" class="eels_spectra_fields">
		<tr>
			<td>
				<label for="eelsdb_spectra_spectrumType" class="required_label">Spectrum Type</label>
			</td>
			<td>
				<select name="eelsdb_spectra_spectrumType" id="eelsdb_spectra_spectrumType">
					<option value="coreloss" <?php if($s_type == 'coreloss') echo 'selected="selected" '; ?>>Core-loss</option>
					<option value="lowloss" <?php if($s_type == 'lowloss') echo 'selected="selected" '; ?>>Low-loss</option>
					<option value="zeroloss" <?php if($s_type == 'zeroloss') echo 'selected="selected" '; ?>>Zero-loss</option>
					<option value="xrayabs" <?php if($s_type == 'xrayabs') echo 'selected="selected" '; ?>>XRay Abs</option>
				</select>
			</td>

			<td>
				<label for="eelsdb_spectra_spectrumUpload" class="required_label">Data Upload</label>
			</td>
			<td>
				<?php
					// Only show file overwrite warning if we're editing a post
					global $pagenow;
					if(!$s_upload){
						echo '<input type="file" id="eelsdb_spectra_spectrumUpload" name="eelsdb_spectra_spectrumUpload" value="" accept=".msa,.dm3,.csv,.txt" size="25">';
					} else {
						?>
						<div id="current_spectra_file">
							<a href="<?php echo $s_upload['url']; ?>" target="_blank" title="Download <?php echo basename($s_upload['file']); ?>" class="current_filename"><?php echo basename($s_upload['file']); ?></a> &nbsp;
							<a id="spectra_new_file_upload" class="button" href="#">Replace file</a>
						</div>
						<div id="new_spectra_file" style="display:none;">
							<input type="file" class="required" id="eelsdb_spectra_spectrumUpload" name="eelsdb_spectra_spectrumUpload" value="" accept=".msa,.dm3,.csv,.txt" size="25">
							<br /><small class="warning">This will delete the previous upload. <a id="spectra_cancel_new_file_upload" href="#">Cancel</a></small>
						</div>
						<?php
					}
				?>
			</td>
		</tr>
		<tr class="hide-zero">
			<td><label for="eelsdb_spectra_spectrumFormula" class="required_label">Specimen Formula</label></td>
			<td><input type="text" class="required hide-zero" name="eelsdb_spectra_spectrumFormula" id="eelsdb_spectra_spectrumFormula" value="<?php echo $s_formula; ?>" /></td>

			<td><label for="eelsdb_spectra_source_purity">Source and Purity</label></td>
			<td><input type="text" class="hide-zero" name="eelsdb_spectra_source_purity" id="eelsdb_spectra_source_purity" value="<?php echo $s_source_purity; ?>" /></td>
		</tr>
	</table>
	<?php
}

// Metabox for Spectra Edges & Levels
function eelsdb_spectra_edges_metabox(){
	global $post;
	$data = get_spectrum_data($post->ID);
	$spectrumEdges = isset($data['spectrumEdges']) ? $data['spectrumEdges'] : array();
	$el_levels = json_decode(file_get_contents ( plugin_dir_path( __FILE__ ).'resources/element_levels.json'));
	$el_names = json_decode(file_get_contents ( plugin_dir_path( __FILE__ ).'resources/element_names.json'));
	// Quality control
	foreach($spectrumEdges as $key => $edge){
		$edge_parts = explode('_', $edge, 2);
		if(count($edge_parts) != 2 || strlen($edge_parts[1]) == 0){
			unset($spectrumEdges[$key]);
		}
	}
	?>
	<div class="hide-zero">
		<div id="eelsdb_edges_added_edges"<?php if (count($spectrumEdges) == 0) echo ' style="display:none;"'; ?>>
			<p>Click name to delete edge..</p>
			<?php
			foreach($spectrumEdges as $edge) {
				list($el, $level) = explode('_', $edge, 2);
				echo '<div id="'.$edge.'" class="level_edge button">
						'.$el_names->$el.' - '.$level.' ('.$el_levels->$el->$level.' eV)
						<input type="hidden" name="eelsdb_spectra_spectrumEdges[]" value="'.$edge.'">
						<div style="clear:both;"></div>
					  </div>';
			}
			?>
		</div>
		<div style="clear:both;"></div>
		<a href="#" class="button eelsdb_edges_add">Add Spectra Edge</a>
		<?php echo file_get_contents(plugin_dir_path( __FILE__ ).'resources/edge_selection.html'); ?>
	</div>
	<p class="show-zero" style="display:none;"><small>Not applicable for zero-loss spectra</small></p>
	<?php
}

// Metabox for Acquisition Tags
function eelsdb_spectra_acquisition_metabox(){
	global $post;
	$data = get_spectrum_data($post->ID);
	$s_microscope = isset($data['microscope']) ? $data['microscope'] : '';
	$s_guntype = isset($data['guntype']) ? $data['guntype'] : '';
	$s_beamenergy = isset($data['beamenergy']) ? $data['beamenergy'] : '';
	$s_resolution = isset($data['resolution']) ? $data['resolution'] : '';
	$s_monochromated = isset($data['monochromated']) && $data['monochromated'] == '1' ? '1' : '0';
	$s_acquisition_mode = isset($data['acquisition_mode']) ? $data['acquisition_mode'] : '';
	$s_convergence = isset($data['convergence']) ? $data['convergence'] : '';
	$s_collection = isset($data['collection']) ? $data['collection'] : '';
	$s_probesize = isset($data['probesize']) ? $data['probesize'] : '';
	$s_beamcurrent = isset($data['beamcurrent']) ? $data['beamcurrent'] : '';
	$s_integratetime = isset($data['integratetime']) ? $data['integratetime'] : '';
	$s_readouts = isset($data['readouts']) ? $data['readouts'] : '';
	$s_detector = isset($data['detector']) ? $data['detector'] : '';
	?>
	<table width="100%" class="eels_spectra_fields">
		<tr>
			<td><label for="eelsdb_spectra_microscope" class="required_label">Microscope Name / Model</label></td>
			<td><input type="text" class="required" name="eelsdb_spectra_microscope" id="eelsdb_spectra_microscope" value="<?php echo $s_microscope; ?>" /></td>
		</tr>
		<tr>
			<td><label for="eelsdb_spectra_guntype" class="required_label">Gun Type</label></td>
			<td><input type="text" class="required" name="eelsdb_spectra_guntype" id="eelsdb_spectra_guntype" value="<?php echo $s_guntype; ?>" /></td>
		</tr>
		<tr>
			<td><label for="eelsdb_spectra_beamenergy" class="required_label">Incident Beam Energy</label></td>
			<td><label><input type="text" class="required" name="eelsdb_spectra_beamenergy" id="eelsdb_spectra_beamenergy" value="<?php echo $s_beamenergy; ?>" /> kV</label></td>
		</tr>
		<tr>
			<td><label for="eelsdb_spectra_resolution" class="required_label">Resolution</label></td>
			<td><label><input type="text" class="required" name="eelsdb_spectra_resolution" id="eelsdb_spectra_resolution" value="<?php echo $s_resolution; ?>" /> eV</label></td>
		</tr>
		<tr>
			<td><label for="eelsdb_spectra_monochromated" class="required_label">Monochromated</label></td>
			<td><label><input type="radio" class="hide-zero" name="eelsdb_spectra_monochromated" id="eelsdb_spectra_monochromated" value="1" <?php if($s_monochromated == '1') echo 'checked="checked" '; ?> /> Yes</label>  &nbsp; &nbsp;
				<label><input type="radio" class="hide-zero" name="eelsdb_spectra_monochromated" value="0" <?php if($s_monochromated == '0') echo 'checked="checked" '; ?> /> No</label>
			</td>
		</tr>
		<tr>
			<td><label for="eelsdb_spectra_acquisition_mode" class="required_label">Acquisition Mode</label></td>
			<td>
				<select id="eelsdb_spectra_acquisition_mode" name="eelsdb_spectra_acquisition_mode">
					<option value="">[ choose mode ]</option>
					<option value="imaging" <?php if($s_acquisition_mode == 'imaging'){ echo 'selected="selected"'; } ?>>Imaging</option>
					<option value="diffraction" <?php if($s_acquisition_mode == 'diffraction'){ echo 'selected="selected"'; } ?>>Diffraction</option>
					<option value="stem" <?php if($s_acquisition_mode == 'stem'){ echo 'selected="selected"'; } ?>>STEM</option>
					<option value="xas-electron-yield" <?php if($s_acquisition_mode == 'xas-electron-yield'){ echo 'selected="selected"'; } ?>>XAS Electron Yield</option>
					<option value="xas-transmission" <?php if($s_acquisition_mode == 'xas-transmission'){ echo 'selected="selected"'; } ?>>XAS Transmission</option>
					<option value="fluorescence" <?php if($s_acquisition_mode == 'fluorescence'){ echo 'selected="selected"'; } ?>>Fluorescence</option>
				</select>
			</td>
		</tr>
		<tr>
			<td><label for="eelsdb_spectra_convergence" class="required_label">Convergence Semi-angle</label></td>
			<td><label><input type="text" class="required" name="eelsdb_spectra_convergence" id="eelsdb_spectra_convergence" value="<?php echo $s_convergence; ?>" /> mrad</label></td>
		</tr>
		<tr>
			<td><label for="eelsdb_spectra_collection" class="required_label">Collection Semi-angle</label></td>
			<td><label><input type="text" class="required" name="eelsdb_spectra_collection" id="eelsdb_spectra_collection" value="<?php echo $s_collection; ?>" /> mrad</label></td>
		</tr>
		<tr>
			<td><label for="eelsdb_spectra_probesize">Probe Size</label></td>
			<td><label><input type="text" name="eelsdb_spectra_probesize" id="eelsdb_spectra_probesize" value="<?php echo $s_probesize; ?>" /> nm<sup>2</sup></label></td>
		</tr>
		<tr>
			<td><label for="eelsdb_spectra_beamcurrent">Beam Current</label></td>
			<td><label><input type="text" name="eelsdb_spectra_beamcurrent" id="eelsdb_spectra_beamcurrent" value="<?php echo $s_beamcurrent; ?>" /></label></td>
		</tr>
		<tr>
			<td><label for="eelsdb_spectra_integratetime">Integration Time</label></td>
			<td><label><input type="text" name="eelsdb_spectra_integratetime" id="eelsdb_spectra_integratetime" value="<?php echo $s_integratetime; ?>" /> secs</label></td>
		</tr>
		<tr>
			<td><label for="eelsdb_spectra_readouts">Number of Readouts</label></td>
			<td><input type="text" name="eelsdb_spectra_readouts" id="eelsdb_spectra_readouts" value="<?php echo $s_readouts; ?>" /></td>
		</tr>
		<tr>
			<td><label for="eelsdb_spectra_detector" class="required_label">Detector</label></td>
			<td><input type="text" class="required" name="eelsdb_spectra_detector" id="eelsdb_spectra_detector" value="<?php echo $s_detector; ?>" /></td>
		</tr>

	</table>
	<?php
}

// Data Treatment Metabox
function eelsdb_spectra_data_treatment_metabox() {
	global $post;
	$data = get_spectrum_data($post->ID);
	$s_darkcurrent = isset($data['darkcurrent']) && $data['darkcurrent'] == '1' ? '1' : '0';
	$s_gainvariation = isset($data['gainvariation']) && $data['gainvariation'] == '1' ? '1' : '0';
	$s_calibration = isset($data['calibration']) ? $data['calibration'] : '';
	$s_thickness = isset($data['thickness']) ? $data['thickness'] : '';
	$s_deconv_fourier_log = isset($data['deconv_fourier_log']) && $data['deconv_fourier_log'] == '1' ? '1' : '0';
	$s_deconv_fourier_ratio = isset($data['deconv_fourier_ratio']) && $data['deconv_fourier_ratio'] == '1' ? '1' : '0';
	$s_deconv_stephens_deconvolution = isset($data['deconv_stephens_deconvolution']) && $data['deconv_stephens_deconvolution'] == '1' ? '1' : '0';
	$s_deconv_richardson_lucy = isset($data['deconv_richardson_lucy']) && $data['deconv_richardson_lucy'] == '1' ? '1' : '0';
	$s_deconv_maximum_entropy = isset($data['deconv_maximum_entropy']) && $data['deconv_maximum_entropy'] == '1' ? '1' : '0';
	$s_deconv_other = isset($data['deconv_other']) ? $data['deconv_other'] : '';
	?>
	<table width="100%"  class="eels_spectra_fields hide-zero">
		<tr>
			<td><label for="eelsdb_spectra_darkcurrent">Dark Current Correction</label></td>
			<td>
				<label><input type="radio" class="hide-zero" name="eelsdb_spectra_darkcurrent" id="eelsdb_spectra_darkcurrent" value="1" <?php if($s_darkcurrent == '1') echo 'checked="checked" '; ?> /> Yes</label>  &nbsp; &nbsp;
			 	<label><input type="radio" class="hide-zero" name="eelsdb_spectra_darkcurrent" value="0" <?php if($s_darkcurrent == '0') echo 'checked="checked" '; ?> /> No</label>
			</td>
		</tr>
		<tr>
			<td><label for="eelsdb_spectra_gainvariation">Gain Variation Spectrum</label></td>
			<td>
				<label><input type="radio" class="hide-zero" name="eelsdb_spectra_gainvariation" id="eelsdb_spectra_gainvariation" value="1" <?php if($s_gainvariation == '1') echo 'checked="checked" '; ?> /> Yes</label>  &nbsp; &nbsp;
				<label><input type="radio" class="hide-zero" name="eelsdb_spectra_gainvariation" value="0" <?php if($s_gainvariation == '0') echo 'checked="checked" '; ?> /> No</label>
			</td>
		</tr>
		<tr>
			<td><label for="eelsdb_spectra_calibration" class="required_label">Calibration</label></td>
			<td><input type="text" class="required" name="eelsdb_spectra_calibration" id="eelsdb_spectra_calibration" value="<?php echo $s_calibration; ?>" /></td>
		</tr>
		<tr>
			<td><label for="eelsdb_spectra_thickness">Relative Thickness</label></td>
			<td><input type="text" class="hide-zero" name="eelsdb_spectra_thickness" id="eelsdb_spectra_thickness" value="<?php echo $s_thickness; ?>" /> t/&lambda;</td>
		</tr>
		<tr>
			<td><label for="eelsdb_spectra_deconv_fourier_log">Deconvolutions</label></td>
			<td>
				<label><input type="checkbox" name="eelsdb_spectra_deconv_fourier_log" id="eelsdb_spectra_deconv_fourier_log" value="1" <?php if($s_deconv_fourier_log == '1') echo 'checked="checked" '; ?>> Fourier-log</label><br>
				<label><input type="checkbox" name="eelsdb_spectra_deconv_fourier_ratio" value="1" <?php if($s_deconv_fourier_ratio == '1') echo 'checked="checked" '; ?>> Fourier-ratio</label><br>
				<label><input type="checkbox" name="eelsdb_spectra_deconv_stephens_deconvolution" value="1" <?php if($s_deconv_stephens_deconvolution == '1') echo 'checked="checked" '; ?>> Stephen's deconvolution</label><br>
				<label><input type="checkbox" name="eelsdb_spectra_deconv_richardson_lucy" value="1" <?php if($s_deconv_richardson_lucy == '1') echo 'checked="checked" '; ?>> Richardson-Lucy</label><br>
				<label><input type="checkbox" name="eelsdb_spectra_deconv_maximum_entropy" value="1" <?php if($s_deconv_maximum_entropy == '1') echo 'checked="checked" '; ?>> Maximum-Entropy</label><br>
			</td>
		</tr>
		<tr>
			<td><label for="eelsdb_spectra_deconv_other">Other Deconvolution</label></td>
			<td><input type="text" class="hide-zero" name="eelsdb_spectra_deconv_other" id="eelsdb_spectra_deconv_other" value="<?php echo $s_deconv_other; ?>" /></td>
		</tr>
	</table>
	<p class="show-zero" style="display:none;"><small>Not applicable for zero-loss spectra</small></p>
	<?php
}

// Metabox for Associated Spectra
function eelsdb_spectra_assoc_spectra_metabox(){
	global $post;
	$data = get_spectrum_data($post->ID);
    $s_assoc_spectra = '';
    if(isset($data['assoc_spectra'])){
        $s_assoc_spectra = '';
        if(is_serialized( $data['assoc_spectra'] )) {
            $data['assoc_spectra'] = unserialize($data['assoc_spectra']);
        }
        // Why is this so difficult?!
        if($data['assoc_spectra'] == 'a:0:{}'){
            $s_assoc_spectra = '';
        } else if(is_array($data['assoc_spectra'])){
            foreach($data['assoc_spectra'] as $assoc_id){
                $s_assoc_spectra .= get_permalink($assoc_id)."\n";
            }
        } else {
            $s_assoc_spectra = $data['assoc_spectra'];
        }
    }
	?>
	<textarea rows="1" cols="40" name="eelsdb_spectra_assoc_spectra" id="eelsdb_spectra_assoc_spectra" style="margin:0; width:98%; height: 4em;"><?php echo $s_assoc_spectra; ?></textarea>
    <p>Add one URL per line, for each associated EELS DB spectra.<br>These should look like <small><samp>https://eelsdb.eu/?post_type=spectra&p=1234</samp></small>
    or <small><samp>https://eelsdb.eu/spectra/related-spectrum/</samp></small></p>
	<?php
}


// Metabox for Spectra References
function eelsdb_spectra_references_metabox(){
	global $post;
	$data = get_spectrum_data($post->ID);
	$s_doi = isset($data['ref_doi']) ? $data['ref_doi'] : '';
	$s_url = isset($data['ref_url']) ? $data['ref_url'] : '';
	$s_ref_authors = isset($data['ref_authors']) ? $data['ref_authors'] : '';
	$s_ref_journal = isset($data['ref_journal']) ? $data['ref_journal'] : '';
	$s_ref_volume = isset($data['ref_volume']) ? $data['ref_volume'] : '';
	$s_ref_issue = isset($data['ref_issue']) ? $data['ref_issue'] : '';
	$s_ref_page = isset($data['ref_page']) ? $data['ref_page'] : '';
	$s_ref_year = isset($data['ref_year']) ? $data['ref_year'] : '';
	$s_ref_title = isset($data['ref_title']) ? $data['ref_title'] : '';
	$s_otherURLs = isset($data['otherURLs']) ? $data['otherURLs'] : '';
	$s_ref_freetext = isset($data['ref_freetext']) ? $data['ref_freetext'] : '';
	?>
	<div class="eels_spectra_fields">
		<input style="width:100%;" type="text" name="eelsdb_spectra_ref_doi" id="eelsdb_spectra_ref_doi" value="<?php echo $s_doi; ?>" placeholder="DOI" />
		<button id="find_doi" class="button" style="width:100%; margin: 8px 0;">
			<span class="spinner" style="display:none;" id="doi_spinner"></span>
			Find Ref
		</button>
		<input style="width:100%;" type="text" class="url" name="eelsdb_spectra_ref_url" id="eelsdb_spectra_ref_url" value="<?php echo $s_url; ?>" placeholder="Ref URL" />
		<input style="width:100%;" type="text" name="eelsdb_spectra_ref_authors" id="eelsdb_spectra_ref_authors" value="<?php echo $s_ref_authors; ?>" placeholder="Authors" />
		<input style="width:100%;" type="text" name="eelsdb_spectra_ref_journal" id="eelsdb_spectra_ref_journal" value="<?php echo $s_ref_journal; ?>" placeholder="Journal" />
		<input style="width:100%;" type="text" name="eelsdb_spectra_ref_volume" id="eelsdb_spectra_ref_volume" value="<?php echo $s_ref_volume; ?>" placeholder="Volume" />
		<input style="width:100%;" type="text" name="eelsdb_spectra_ref_issue" id="eelsdb_spectra_ref_issue" value="<?php echo $s_ref_issue; ?>" placeholder="Issue" />
		<input style="width:100%;" type="text" name="eelsdb_spectra_ref_page" id="eelsdb_spectra_ref_page" value="<?php echo $s_ref_page; ?>" placeholder="Page" />
		<input style="width:100%;" type="text" class="number" name="eelsdb_spectra_ref_year" id="eelsdb_spectra_ref_year" value="<?php echo $s_ref_year; ?>" placeholder="Year" />
		<input style="width:100%;" type="text" name="eelsdb_spectra_ref_title" id="eelsdb_spectra_ref_title" value="<?php echo $s_ref_title; ?>" placeholder="Title" />
		<textarea style="width:100%;" name="eelsdb_spectra_otherURLs" id="eelsdb_spectra_otherURLs" placeholder="Other URLs"><?php echo $s_otherURLs; ?></textarea>
		<textarea style="width:100%;" name="eelsdb_spectra_ref_freetext" id="eelsdb_spectra_ref_freetext" placeholder="Depreciated free-text ref"><?php echo $s_ref_freetext; ?></textarea>
	</div>
	<?php
}


////////////////////////////////
// Save fields from metaboxes
////////////////////////////////
add_action('save_post', 'eelsdb_spectra_save_spectra');
function eelsdb_spectra_save_spectra ($post_id){

	// only fire this when we're on administration pages
	if(is_admin()){

		global $post;

		// Security nonce
	    if(!wp_verify_nonce($_POST['eelsdb_spectra_upload_nonce'], plugin_basename(__FILE__))) {
			return $post_id;
		}

		// Ignore autosaves
		if(defined('DOING_AUTOSAVE') && DOING_AUTOSAVE) {
			return $post_id;
		}

		// Check user permissions
		if(!current_user_can('edit_page', $post_id)) {
			return $post_id;
		}

		// Trim the POST prefixes
		$data = array();
		foreach($_POST as $key => $var){
			if(substr($key, 0, 15) == 'eelsdb_spectra_'){
				$data[substr($key, 15)] = is_string($var) ? trim($var) : $var;
			}
		}

		// Add on the file upload if there
		if(!empty($_FILES['eelsdb_spectra_spectrumUpload']['name'])) {
			$data['spectrumUpload'] = $_FILES['eelsdb_spectra_spectrumUpload'];
		} else {
			$data['spectrumUpload'] = false;
		}

		// Convert the associated spectra field into an array of post IDs
	    $assoc_ids = [];
	    foreach(preg_split('/\s+/', trim($data['assoc_spectra'])) as $url){
	        $postid = url_to_postid( $url );
	        if($postid){
	            if(get_post_type($postid) == 'spectra'){
	                $assoc_ids[] = $postid;
	            } else {
	                wp_die('Error: Associated Spectrum URL is not a spectra: <code>'.$url.'</code> - "'.get_the_title($postid).'"');
	            }
	        } elseif(strlen($url) > 0) {
	            wp_die('Error: Associated Spectrum URL not recognised as an EELS DB spectrum: <code>'.$url.'</code>');
	        }
	    }
	    $data['assoc_spectra'] = maybe_serialize($assoc_ids);

		// Get old data, if it exists (empty array if not)
		$old = get_spectrum_data($post->ID);

		// Upload Spectrum File
		if($data['spectrumUpload']) {
			// Delete existing file if it already exists
			if(strlen($old['spectrumUpload']['file']) > 0 && file_exists($old['spectrumUpload']['file'])){
	    	    if(!unlink($old['spectrumUpload']['file'])) {
					wp_die('Error: There was an error trying to delete the old spectrum file.');
	    	    }
			}
			// Upload new file
			$upload = wp_upload_bits($data['spectrumUpload']['name'], null, file_get_contents($data['spectrumUpload']['tmp_name']));
			if(isset($upload['error']) && strlen($upload['error']) !== 0 && $upload['error'] !== 0) {
				wp_die('Error: There was an error uploading the spectrum file: ' . $upload['error']);
			} else {
				$data['spectrumUpload'] = $upload;
			}
		}
		// No upload - don't wipe the name of the existing file upload
		else {
			$data['spectrumUpload'] = $old['spectrumUpload'];
		}

    	// Pull the min and max values out as meta keys
    	list($data['spectrumMin'], $data['spectrumMax'], $data['stepSize']) = find_spectra_min_max($data['spectrumUpload']['file']);

		// Save elements
		$num_matches = preg_match_all('/([A-Z][a-z]?[a-z]?)/', $data['spectrumFormula'], $formula_split);
		$el_names = json_decode(file_get_contents(plugin_dir_path( __FILE__ ).'/resources/element_names.json'));
		$elements = array();
		foreach($formula_split[0] as $el){
			if(array_key_exists($el, $el_names) && !in_array($el, $elements)){
				$elements[] = $el;
			}
		}
		// Don't check if this has worked - may not be any meta data called this.
		delete_post_meta($post_id, 'spectrumElement');
		if(count($elements) > 0){
			foreach($elements as $el){
				add_post_meta($post_id, 'spectrumElement', $el);
			}
		}

        // Save the reciprocal spectra links
	    foreach($data['assoc_spectra'] as $assoc_id){
	        $recip_assoc_ids = get_post_meta($assoc_id, 'assoc_spectra');
	        if(!in_array($post_id, $recip_assoc_ids)){
	            array_push($recip_assoc_ids, $post_id);
	            if(!update_post_meta($assoc_id, 'assoc_spectra', $recip_assoc_ids)){
	                wp_die("Error: Could not update reciprocal associated spectrum <code>$assoc_id</code>: ".get_the_title($assoc_id).".");
	            }
	        }
	    }

	    // Save remaining meta values
		global $meta_keys;
		foreach($meta_keys as $key){
			if(isset($data[$key])){
				$newval = is_string($data[$key]) ? stripslashes($data[$key]) : $data[$key];
				// update_post_meta returns false if the data is the same, so only try if we've changed it
				if(!isset($old[$key]) || $old[$key] != $newval){
					if(!update_post_meta($post_id, $key, $newval)){
						wp_die("Error: Could not update post meta data ('$key': <code>".$old[$key]."</code> changing to <code>".$newval."</code>, post ID: <code>$post_id</code>)");
					}
				}
			}
		}

	}

}


?>
