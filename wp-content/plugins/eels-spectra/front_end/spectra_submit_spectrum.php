<?php

////////////////////////////////////////////
// EELS DB Spectra Plugin
// spectra_submit_spectrum.php
// Form for users submitting new spectra
////////////////////////////////////////////

// Run output buffers to allow redirects
add_action('init', 'eelsdb_submit_output_buffer');
function eelsdb_submit_output_buffer() {
    if(isset($_POST['eelsdb_spectra_upload_nonce'])){
        ob_start();
    }
}

// Set up Shortcode
add_shortcode('submit-spectrum', 'eelsdb_submit_spectrum_sc');

// Shortcode function
function eelsdb_submit_spectrum_sc ( $atts ) {
	////////////////////////////////////////////
	// Enqueue all of the form-specific stuff
	////////////////////////////////////////////
	// jQuery Validate scripts
	wp_enqueue_script('eelsdb_spectra_validate', plugin_dir_url( __FILE__ ).'../libraries/jquery.validate.min.js', array('jquery'));
	wp_enqueue_script('eelsdb_spectra_validate_additional_methods', plugin_dir_url( __FILE__ ).'../libraries/additional-methods.min.js', array('jquery'));
	// Enqueue EELS DB JS, with clever WP stuff to make PHP variables available to file
	wp_register_script('eelsdb_spectra_submit_js', plugin_dir_url( __FILE__ ).'../js/eelsdb-submit-spectra.js', array('jquery') );
	$php_vars_array = array( 'plugin_dir_url' => plugin_dir_url( __FILE__ ).'../resources/', 'admin' => 0, 'spectrumEdges' => $s_edge, 'spectrumLevel' => $s_level );
	wp_localize_script( 'eelsdb_spectra_submit_js', 'php_vars', $php_vars_array );
	wp_enqueue_script( 'eelsdb_spectra_submit_js' );
	// Add some CSS
	wp_enqueue_style( 'eelsdb_spectra_admin_css', plugin_dir_url( __FILE__ ).'../css/eelsdb_frontend.css' );


	////////////////////////////////////////////
	// Get saved data if we're editing
	////////////////////////////////////////////
	$data = array();
	$edit = false;
	if(isset($_GET['edit']) && is_numeric($_GET['edit'])){
		$post = get_post($_GET['edit']);
		if($post){
			if(!current_user_can('edit_others_posts') && $post->post_author != get_current_user_id() ){
				return '<div class="alert alert-danger" role="alert"><strong>Error:</strong> You do not have permission to edit this spectrum.</div>';
			}
			$data = get_spectrum_data($post->ID);
			$data['post_title'] = $post->post_title;
			$data['post_id'] = $post->ID;
			$data['spectrumComments'] = $post->post_excerpt;
			$keywords = [];
			foreach(wp_get_post_terms($post->ID, 'keywords') as $keyword){
				$keywords[] = $keyword->name;
			}
			$data['spectrumKeywords'] = implode(', ', $keywords);
			$edit = true;
		}
	}

	////////////////////////////////////////////
	// Delete spectrum (admin only)
	////////////////////////////////////////////
    if(isset($_GET['delete']) && is_numeric($_GET['delete']) && current_user_can('edit_others_posts')){
        if(!wp_trash_post($_GET['delete'])){
            return '<div class="alert alert-danger" role="alert"><strong>Error!</strong> Could not delete spectrum.</div>';
        } else {
            return '<div class="alert alert-success" role="alert"><h2>Spectrum Deleted</h2><p>This post has been sent to the trash.</p></div>';
        }
    }


	////////////////////////////////////////////
	// Process the submitted form
	////////////////////////////////////////////
	$error_msg = false;
	if(isset($_POST['eelsdb_spectra_upload_nonce'])){

		// Save the old stuff and start afresh
		if($edit){
			$olddata = $data;
			$data = array();
		}
		// Get the data that we want and trim the prefixes
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
		// Send for processing
		if($edit){
			list($saved_id, $error_msg) = eelsdb_submit_spectrum_save_post ($data, true, $olddata, $post);
		} else {
			list($saved_id, $error_msg) = eelsdb_submit_spectrum_save_post ($data, false, false, false);
		}
		// Worked! Show the status message and link to the new spectra
		if($saved_id){
            global $edit_spectrum_url;
            $hdr = "Spectrum Submitted";
            wp_redirect($edit_spectrum_url.'?eelsdb_hdr='.urlencode(htmlentities($hdr)).'&eelsdb_msg='.urlencode(htmlentities($error_msg)));
            exit;
		}
		// Failed, prep the fields to show the form again
		else {
			if($edit){
				$data['spectrumUpload'] = $olddata['spectrumUpload'];
                $data['post_id'] = $olddata['post_id'];
                $data['assoc_spectra'] = $_POST['eelsdb_spectra_assoc_spectra'];
			} else {
				unset($data['spectrumUpload']);
			}
		}
	}

	////////////////////////////////////////////
	// Print a success status message
	////////////////////////////////////////////
    if(isset($_GET['eelsdb_msg'])){
        $message = '<div class="alert alert-success" role="alert">';
        if(isset($_GET['eelsdb_hdr'])){
            $message .= '<h2>'.html_entity_decode(urldecode($_GET['eelsdb_hdr'])).'</h2>';
        }
        $message .= '<p>'.html_entity_decode(urldecode($_GET['eelsdb_msg'])).'</p></div>';
        return $message;
    }

	////////////////////////////////////////////
	// Print the form
	////////////////////////////////////////////
	return eelsdb_submit_spectrum_form($data, $edit, $error_msg);

}


////////////////////////////////////////////
// Function to output the main form
////////////////////////////////////////////
function eelsdb_submit_spectrum_form ($data, $edit=false, $error_msg=false){
    // echo '<pre>'.print_r($data, true).'</pre>';
    global $edit_spectrum_url;
	// THE MAIN FORM
	ob_start();
	?>
	<h1><?php echo $edit ? 'Edit' : 'Submit'; ?> Spectra</h1>
	<p class="lead" id="eelsdb_submit_introText">You can submit your X-Ray and Electron Energy Loss Spectroscopy data here. Published data is welcome.</p>
	<?php
	if($error_msg){
		echo '<div class="alert alert-danger" role="alert">'.$error_msg.'</div>';
	}
	?>
	<form id="eelsdb_submit_form" class="form-horizontal" method="post" action="<?php echo $edit_spectrum_url; if($edit) echo '?edit='.$data['post_id']; ?>" enctype="multipart/form-data" role="form">
		<?php if ( !is_user_logged_in() ) { ?>
		<fieldset>
			<legend>About You</legend>
			<div class="form-group two-field-form-group">
				<label for="eelsdb_spectra_author_firstname" class="col-sm-3 col-lg-4 control-label required_label">Your Name</label>
				<div class="col-sm-9 col-md-8 col-lg-5">
					<input type="text" class="required form-control" id="eelsdb_spectra_author_firstname" name="eelsdb_spectra_author_firstname" placeholder="First name"> &nbsp;
                    <input type="text" class="required form-control" id="eelsdb_spectra_author_lastname" name="eelsdb_spectra_author_lastname" placeholder="Last name">
				</div>
			</div>
			<div class="form-group">
				<label for="eelsdb_spectra_author_email" class="col-sm-3 col-lg-4 control-label required_label">Email address</label>
				<div class="col-sm-9 col-md-8 col-lg-5">
					<input type="email" class="required email form-control" id="eelsdb_spectra_author_email" name="eelsdb_spectra_author_email" placeholder="Your e-mail address">
					<span class="help-block"><strong>Note:</strong> An account will be created for you if you're not already registered.</span>
				</div>
			</div>
		</fieldset>
		<?php } //if ( !is_user_logged_in() ) { ?>


		<fieldset>
			<legend>Spectrum Description</legend>
			<?php
			wp_nonce_field(plugin_basename(__FILE__).'../', 'eelsdb_spectra_upload_nonce');
			$post_title = isset($data['post_title']) ? $data['post_title'] : '';
			$s_type = isset($data['spectrumType']) ? $data['spectrumType'] : '';
			$s_upload = isset($data['spectrumUpload']) ? $data['spectrumUpload'] : false;
			$s_name = isset($data['spectrumName']) ? $data['spectrumName'] : '';
			$s_formula = isset($data['spectrumFormula']) ? $data['spectrumFormula'] : '';
			$s_source_purity = isset($data['source_purity']) ? $data['source_purity'] : '';
			$s_comment = isset($data['spectrumComment']) ? $data['spectrumComment'] : '';
			$s_keywords = isset($data['spectrumKeywords']) ? $data['spectrumKeywords'] : '';
			$s_comment = isset($data['spectrumComments']) ? $data['spectrumComments'] : '';
			?>
			<div class="form-group">
				<label for="post_title" class="col-sm-3 col-lg-4 control-label required_label">Specimen Name</label>
				<div class="col-sm-9 col-md-8 col-lg-5">
					<input type="text" class="required form-control" id="eelsdb_spectra_post_title" name="eelsdb_spectra_post_title"  value="<?php echo $post_title; ?>" placeholder="Specimen name">
				</div>
			</div>
			<div class="form-group">
				<label for="eelsdb_spectra_spectrumType" class="col-sm-3 col-lg-4 control-label required_label">Spectrum Type</label>
				<div class="col-sm-9 col-md-8 col-lg-5">
					<select class="form-control" name="eelsdb_spectra_spectrumType" id="eelsdb_spectra_spectrumType">
						<option value="coreloss" <?php if($s_type == 'coreloss') echo 'selected="selected" '; ?>>Core-loss</option>
						<option value="lowloss" <?php if($s_type == 'lowloss') echo 'selected="selected" '; ?>>Low-loss</option>
						<option value="zeroloss" <?php if($s_type == 'zeroloss') echo 'selected="selected" '; ?>>Zero-loss</option>
						<option value="xrayabs" <?php if($s_type == 'xrayabs') echo 'selected="selected" '; ?>>XRay Abs</option>
					</select>
				</div>
			</div>
			<div class="form-group">
				<label for="eelsdb_spectra_spectrumUpload" class="col-sm-3 col-lg-4 control-label required_label">Data Upload</label>
				<div class="col-sm-9 col-md-8 col-lg-5">
					<?php
						// Only show file overwrite warning if we're editing a post
						global $pagenow;
						if(!$s_upload){
							?>
							<div class="input-group">
								<span class="input-group-btn">
									<span class="btn btn-info btn-file">
										Browse&hellip; <input type="file" id="eelsdb_spectra_spectrumUpload" name="eelsdb_spectra_spectrumUpload" accept=".msa,.dm3,.csv,.txt" size="25">
									</span>
								</span>
								<input type="text" class="form-control" readonly>
							</div>
							<?php
						} else {
							?>
							<div id="current_spectra_file">
								<a href="<?php echo $s_upload['url']; ?>" target="_blank" title="Download <?php echo basename($s_upload['file']); ?>" class="current_filename"><code><?php echo basename($s_upload['file']); ?></code></a> &nbsp;
								<a id="spectra_new_file_upload" class="btn btn-sm btn-default" href="#">Replace file</a>
							</div>
							<div id="new_spectra_file" style="display:none;">
								<div class="input-group">
									<span class="input-group-btn">
										<span class="btn btn-info btn-file">
											Browse&hellip; <input type="file" id="eelsdb_spectra_spectrumUpload" name="eelsdb_spectra_spectrumUpload" accept=".msa,.dm3,.csv,.txt" size="25">
										</span>
									</span>
									<input type="text" class="form-control" readonly>
								</div>
								<span class="help-block">This will delete the previous upload. <a id="spectra_cancel_new_file_upload" href="#">Cancel</a></span>
							</div>
							<?php
						}
					?>
                    <span class="help-block">Files can be in <code>.msa</code>, <code>.csv</code> or <code>.txt</code> format. Files must contain two columns of numbers separated by whitespace or a comma. Lines starting with a <code>#</code> will be ignored.</span>
				</div>
			</div>
			<div class="form-group hide-zero">
				<label for="eelsdb_spectra_spectrumFormula" class="col-sm-3 col-lg-4 control-label required_label">Specimen Formula</label>
				<div class="col-sm-9 col-md-8 col-lg-5">
					<input type="text" class="required form-control" id="eelsdb_spectra_spectrumFormula" name="eelsdb_spectra_spectrumFormula" value="<?php echo $s_formula; ?>" placeholder="Specimen Formula">
				</div>
			</div>
			<div class="form-group hide-zero">
				<label for="eelsdb_spectra_source_purity" class="col-sm-3 col-lg-4 control-label">Source and Purity</label>
				<div class="col-sm-9 col-md-8 col-lg-5">
					<input type="text" class="form-control" id="eelsdb_spectra_source_purity" name="eelsdb_spectra_source_purity" value="<?php echo $s_source_purity; ?>" placeholder="Source and Purity">
				</div>
			</div>
			<div class="form-group">
				<label for="eelsdb_spectra_spectrumKeywords" class="col-sm-3 col-lg-4 control-label">Associated Keywords</label>
				<div class="col-sm-9 col-md-8 col-lg-5">
					<input type="text" class="form-control" id="eelsdb_spectra_spectrumKeywords" name="eelsdb_spectra_spectrumKeywords" value="<?php echo $s_keywords; ?>" placeholder="Separate keywords with commas">
				</div>
			</div>
			<div class="form-group">
				<label for="eelsdb_spectra_spectrumComments" class="col-sm-3 col-lg-4 control-label">Author Comments</label>
				<div class="col-sm-9 col-md-8 col-lg-5">
					<textarea class="form-control" id="eelsdb_spectra_spectrumComments" name="eelsdb_spectra_spectrumComments" placeholder="Author Comments"><?php echo $s_comment; ?></textarea>
				</div>
			</div>
		</fieldset>

		<fieldset class="hide-zero">
			<legend>Feature Identification</legend>
			<?php
			// Get edges and level data
			$spectrumEdges = isset($data['spectrumEdges']) ? $data['spectrumEdges'] : array();
			$el_levels = json_decode(file_get_contents ( plugin_dir_path( __FILE__ ).'../resources/element_levels.json'));
			$el_names = json_decode(file_get_contents ( plugin_dir_path( __FILE__ ).'../resources/element_names.json'));
			// Quality control
			foreach($spectrumEdges as $key => $edge){
				$edge_parts = explode('_', $edge, 2);
				if(count($edge_parts) != 2 || strlen($edge_parts[1]) == 0){
					unset($spectrumEdges[$key]);
				}
			}
			?>
			<div id="eelsdb_edges_added_edges"<?php if (count($spectrumEdges) == 0) echo ' style="display:none;"'; ?>>
				<p>Click name to delete edge..</p>
				<?php
				foreach($spectrumEdges as $edge) {
					list($el, $level) = explode('_', $edge, 2);
					echo '<div id="'.$edge.'" class="level_edge btn btn-default">
							'.$el_names->$el.' - '.$level.' ('.$el_levels->$el->$level.' eV)
							<input type="hidden" name="eelsdb_spectra_spectrumEdges[]" value="'.$edge.'">
							<div style="clear:both;"></div>
						  </div>';
				}
				?>
			</div>
			<div style="clear:both;"></div>
			<?php echo file_get_contents(plugin_dir_path( __FILE__ ).'../resources/edge_selection.html'); ?>
			<p class="add_spectra_edge_button"><a href="#" class="btn btn-info eelsdb_edges_add">Add Spectra Edge</a></p>
		</fieldset>


		<fieldset id="microscope_acquiisition_details_fieldset">
			<legend>Microscope Acquisition Details</legend>
			<?php
      if( is_user_logged_in() ){
  			// presets
  			$s_microscope_presets = get_user_meta(get_current_user_id(), 'microscope_presets', true);
  			// metadata
  			$s_microscope = isset($data['microscope']) ? $data['microscope'] : '';
  			$s_guntype = isset($data['guntype']) ? $data['guntype'] : '';
  			$s_beamenergy = isset($data['beamenergy']) ? $data['beamenergy'] : '';
  			$s_resolution = isset($data['resolution']) ? $data['resolution'] : '';
  			$s_monochromated = isset($data['monochromated']) && $data['monochromated'] == '1' ? '1' : '0';
  			$s_acquisition_mode = isset($custom['acquisition_mode']) ? $custom['acquisition_mode'] : '';
  			$s_convergence = isset($data['convergence']) ? $data['convergence'] : '';
  			$s_collection = isset($data['collection']) ? $data['collection'] : '';
  			$s_probesize = isset($data['probesize']) ? $data['probesize'] : '';
  			$s_beamcurrent = isset($data['beamcurrent']) ? $data['beamcurrent'] : '';
  			$s_integratetime = isset($data['integratetime']) ? $data['integratetime'] : '';
  			$s_readouts = isset($data['readouts']) ? $data['readouts'] : '';
  			$s_detector = isset($data['detector']) ? $data['detector'] : '';
  			?>
  			<?php if($s_microscope_presets != '' && count($s_microscope_presets) > 0) { ?>
  			<div class="form-group">
  				<label for="eelsdb_user_microscope_preset" class="col-sm-3 col-lg-4 control-label">Acquisition Details Preset</label>
  				<div class="col-sm-9 col-md-8 col-lg-5">
  					<select name="eelsdb_user_microscope_preset" id="eelsdb_user_microscope_preset" class="form-control">
  						<option value="">[ enter manually ]</option>
  						<?php
  						foreach($s_microscope_presets as $slug => $preset){
  							echo '<option value="'.$slug.'">'.$preset['name'].'</option>';
  						}
  						?>
  					</select>
  				</div>
  			</div>
  			<?php } // count microscope presets ?>
  			<div class="form-group">
  				<label for="eelsdb_spectra_save_microscope_details" class="col-sm-3 col-lg-4 control-label">Save these fields as:</label>
  				<div class="col-sm-9 col-md-8 col-lg-5">
  					<input type="text" class="form-control" id="eelsdb_spectra_save_microscope_details" name="eelsdb_spectra_save_microscope_details" value="" placeholder="Preset name">
  					<span class="help-block">You can save these details as a preset for future spectra submissions. Leave blank if you don't want to save details.</span>
  				</div>
  			</div>
      <?php } // user not logged in ?>
			<div class="form-group">
				<label for="eelsdb_spectra_microscope" class="col-sm-3 col-lg-4 required_label control-label">Microscope Name / Model</label>
				<div class="col-sm-9 col-md-8 col-lg-5">
					<input type="text" class="required form-control" id="eelsdb_spectra_microscope" name="eelsdb_spectra_microscope" value="<?php echo $s_microscope; ?>" placeholder="Microscope Name">
				</div>
			</div>
			<div class="form-group">
				<label for="eelsdb_spectra_guntype" class="col-sm-3 col-lg-4 required_label control-label">Gun Type</label>
				<div class="col-sm-9 col-md-8 col-lg-5">
					<input type="text" class="required form-control" id="eelsdb_spectra_guntype" name="eelsdb_spectra_guntype" value="<?php echo $s_guntype; ?>" placeholder="Gun Type">
				</div>
			</div>
			<div class="form-group">
				<label for="eelsdb_spectra_beamenergy" class="col-sm-3 col-lg-4 required_label control-label">Incident Beam Energy</label>
				<div class="col-sm-9 col-md-8 col-lg-5">
					<div class="input-group">
						<input type="text" class="required form-control" id="eelsdb_spectra_beamenergy" name="eelsdb_spectra_beamenergy" value="<?php echo $s_beamenergy; ?>" placeholder="Incident Beam Energy">
						<span class="input-group-addon">kV</span>
					</div>
				</div>
			</div>
			<div class="form-group">
				<label for="eelsdb_spectra_resolution" class="col-sm-3 col-lg-4 required_label control-label">Resolution</label>
				<div class="col-sm-9 col-md-8 col-lg-5">
					<div class="input-group">
						<input type="text" class="required form-control" id="eelsdb_spectra_resolution" name="eelsdb_spectra_resolution" value="<?php echo $s_resolution; ?>" placeholder="Resolution">
						<span class="input-group-addon">eV</span>
					</div>
				</div>
			</div>
			<div class="form-group">
				<label for="eelsdb_spectra_monochromated" class="col-sm-3 col-lg-4 control-label">Monochromated</label>
				<div class="col-sm-9 col-md-8 col-lg-5">
					<div class="btn-group" data-toggle="buttons">
						<label class="btn-yes btn btn-default <?php if($s_monochromated == '1') echo 'active'; ?>">
							<input type="radio" name="eelsdb_spectra_monochromated" id="eelsdb_spectra_monochromated" value="1" <?php if($s_monochromated == '1') echo 'checked="checked" '; ?>> Yes
						</label>
						<label class="btn-no btn btn-default <?php if($s_monochromated == '0') echo 'active'; ?>">
							<input type="radio" name="eelsdb_spectra_monochromated" value="0" <?php if($s_monochromated == '0') echo 'checked="checked" '; ?>> No
						</label>
					</div>
				</div>
			</div>
			<div class="form-group">
				<label for="eelsdb_spectra_acquisition_mode" class="col-sm-3 col-lg-4 control-label">Acquisition Mode</label>
				<div class="col-sm-9 col-md-8 col-lg-5">
					<select class="form-control" id="eelsdb_spectra_acquisition_mode" name="eelsdb_spectra_acquisition_mode">
						<option value="">[ choose mode ]</option>
						<option value="imaging" <?php if($s_acquisition_mode == 'imaging'){ echo 'selected="selected"'; } ?>>Imaging</option>
						<option value="diffraction" <?php if($s_acquisition_mode == 'diffraction'){ echo 'selected="selected"'; } ?>>Diffraction</option>
						<option value="stem" <?php if($s_acquisition_mode == 'stem'){ echo 'selected="selected"'; } ?>>STEM</option>
						<option value="xas-electron-yield" <?php if($s_acquisition_mode == 'xas-electron-yield'){ echo 'selected="selected"'; } ?>>XAS Electron Yield</option>
						<option value="xas-transmission" <?php if($s_acquisition_mode == 'xas-transmission'){ echo 'selected="selected"'; } ?>>XAS Transmission</option>
						<option value="fluorescence" <?php if($s_acquisition_mode == 'fluorescence'){ echo 'selected="selected"'; } ?>>Fluorescence</option>
					</select>
				</div>
			</div>
			<div class="form-group">
				<label for="eelsdb_spectra_convergence" class="col-sm-3 col-lg-4 required_label control-label">Convergence Semi-angle</label>
				<div class="col-sm-9 col-md-8 col-lg-5">
					<div class="input-group">
						<input type="text" class="required form-control" id="eelsdb_spectra_convergence" name="eelsdb_spectra_convergence" value="<?php echo $s_convergence; ?>" placeholder="Convergence Semi-angle">
						<span class="input-group-addon">mrad</span>
					</div>
				</div>
			</div>
			<div class="form-group">
				<label for="eelsdb_spectra_collection" class="col-sm-3 col-lg-4 required_label control-label">Collection Semi-angle</label>
				<div class="col-sm-9 col-md-8 col-lg-5">
					<div class="input-group">
						<input type="text" class="required form-control" id="eelsdb_spectra_collection" name="eelsdb_spectra_collection" value="<?php echo $s_collection; ?>" placeholder="Collection Semi-angle">
						<span class="input-group-addon">mrad</span>
					</div>
				</div>
			</div>
			<div class="form-group">
				<label for="eelsdb_spectra_probesize" class="col-sm-3 col-lg-4 control-label">Probe Size</label>
				<div class="col-sm-9 col-md-8 col-lg-5">
					<div class="input-group">
						<input type="text" class="form-control" id="eelsdb_spectra_probesize" name="eelsdb_spectra_probesize" value="<?php echo $s_probesize; ?>" placeholder="Probe Size">
						<span class="input-group-addon">nm<sup>2</sup></span>
					</div>
				</div>
			</div>
			<div class="form-group">
				<label for="eelsdb_spectra_beamcurrent" class="col-sm-3 col-lg-4 control-label">Beam Current</label>
				<div class="col-sm-9 col-md-8 col-lg-5">
					<input type="text" class="form-control" id="eelsdb_spectra_beamcurrent" name="eelsdb_spectra_beamcurrent" value="<?php echo $s_beamcurrent; ?>" placeholder="Beam Current">
				</div>
			</div>
			<div class="form-group">
				<label for="eelsdb_spectra_integratetime" class="col-sm-3 col-lg-4 control-label">Integration Time</label>
				<div class="col-sm-9 col-md-8 col-lg-5">
					<div class="input-group">
						<input type="text" class="form-control" id="eelsdb_spectra_integratetime" name="eelsdb_spectra_integratetime" value="<?php echo $s_integratetime; ?>" placeholder="Integrate Time">
						<span class="input-group-addon">secs</span>
					</div>
				</div>
			</div>
			<div class="form-group">
				<label for="eelsdb_spectra_readouts" class="col-sm-3 col-lg-4 control-label">Number of Readouts</label>
				<div class="col-sm-9 col-md-8 col-lg-5">
					<input type="text" class="form-control" id="eelsdb_spectra_readouts" name="eelsdb_spectra_readouts" value="<?php echo $s_readouts; ?>" placeholder="Number of Readouts">
				</div>
			</div>
			<div class="form-group">
				<label for="eelsdb_spectra_detector" class="col-sm-3 col-lg-4 required_label control-label">Detector</label>
				<div class="col-sm-9 col-md-8 col-lg-5">
					<input type="text" class="required form-control" id="eelsdb_spectra_detector" name="eelsdb_spectra_detector" value="<?php echo $s_detector; ?>" placeholder="Detector">
				</div>
			</div>
		</fieldset>
		<?php if(count($s_microscope_presets) > 0) { ?>
		<!-- Preset values -->
		<script type="text/javascript">
		var microscope_presets = {
			<?php
			foreach($s_microscope_presets as $slug => $preset){
				echo $slug.':{';
				foreach($preset['data'] as $preset_key => $preset_data){
					echo $preset_key.":'".addslashes($preset_data)."',\n";
				}
				echo "}, \n";
			} ?>
		};
		</script>
		<?php } // count presets?>


		<fieldset class="hide-zero">
			<legend>Spectra Data Treatment Tags</legend>
			<?php
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
			<div class="form-group">
				<label for="eelsdb_spectra_darkcurrent" class="col-sm-3 col-lg-4 control-label">Dark Current Correction</label>
				<div class="col-sm-9 col-md-8 col-lg-5">
					<div class="btn-group" data-toggle="buttons">
						<label class="btn-yes btn btn-default <?php if($s_darkcurrent == '1') echo 'active'; ?>">
							<input type="radio" name="eelsdb_spectra_darkcurrent" id="eelsdb_spectra_darkcurrent" value="1" <?php if($s_darkcurrent == '1') echo 'checked="checked" '; ?>> Yes
						</label>
						<label class="btn-no btn btn-default <?php if($s_darkcurrent == '0') echo 'active'; ?>">
							<input type="radio" name="eelsdb_spectra_darkcurrent" value="0" <?php if($s_darkcurrent == '0') echo 'checked="checked" '; ?>> No
						</label>
					</div>
				</div>
			</div>
			<div class="form-group">
				<label for="eelsdb_spectra_gainvariation" class="col-sm-3 col-lg-4 control-label">Gain Variation Spectrum</label>
				<div class="col-sm-9 col-md-8 col-lg-5">
					<div class="btn-group" data-toggle="buttons">
						<label class="btn-yes btn btn-default <?php if($s_gainvariation == '1') echo 'active'; ?>">
							<input type="radio" name="eelsdb_spectra_gainvariation" id="eelsdb_spectra_gainvariation" value="1" <?php if($s_gainvariation == '1') echo 'checked="checked" '; ?>> Yes
						</label>
						<label class="btn-no btn btn-default <?php if($s_gainvariation == '0') echo 'active'; ?>">
							<input type="radio" name="eelsdb_spectra_gainvariation" value="0" <?php if($s_gainvariation == '0') echo 'checked="checked" '; ?>> No
						</label>
					</div>
				</div>
			</div>
			<div class="form-group">
				<label for="eelsdb_spectra_calibration" class="col-sm-3 col-lg-4 required_label control-label">Calibration</label>
				<div class="col-sm-9 col-md-8 col-lg-5">
					<input type="text" class="required form-control" id="eelsdb_spectra_calibration" name="eelsdb_spectra_calibration" value="<?php echo $s_calibration; ?>" placeholder="Calibration">
                    <span class="help-block"><em>eg.</em> "low loss + drift tube" or "zero + dispersion"</span>
				</div>
			</div>
			<div class="form-group">
				<label for="eelsdb_spectra_thickness" class="col-sm-3 col-lg-4 control-label">Relative Thickness</label>
				<div class="col-sm-9 col-md-8 col-lg-5">
					<div class="input-group">
						<input type="text" class="form-control" id="eelsdb_spectra_thickness" name="eelsdb_spectra_thickness" value="<?php echo $s_thickness; ?>" placeholder="Relative Thickness">
						<span class="input-group-addon">t/&lambda;</span>
					</div>
					<span class="help-block">Before plural scattering removal</span>
				</div>
			</div>
			<div class="form-group">
				<label for="eelsdb_spectra_deconv_fourier_log" class="col-sm-3 col-lg-4 control-label">Deconvolutions</label>
				<div class="col-sm-9 col-md-8 col-lg-5">
					<div class="input-group">
						<div class="checkbox">
							<label>
								<input type="checkbox" name="eelsdb_spectra_deconv_fourier_log" id="eelsdb_spectra_deconv_fourier_log" value="1" <?php if($s_deconv_fourier_log == '1') echo 'checked="checked" '; ?>> Fourier-log
							</label>
						</div>
						<div class="checkbox">
							<label>
								<input type="checkbox" name="eelsdb_spectra_deconv_fourier_ratio" value="1" <?php if($s_deconv_fourier_ratio == '1') echo 'checked="checked" '; ?>> Fourier-ratio
							</label>
						</div>
						<div class="checkbox">
							<label>
								<input type="checkbox" name="eelsdb_spectra_deconv_stephens_deconvolution" value="1" <?php if($s_deconv_stephens_deconvolution == '1') echo 'checked="checked" '; ?>> Stephen's deconvolution
							</label>
						</div>
						<div class="checkbox">
							<label>
								<input type="checkbox" name="eelsdb_spectra_deconv_richardson_lucy" value="1" <?php if($s_deconv_richardson_lucy == '1') echo 'checked="checked" '; ?>> Richardson-Lucy
							</label>
						</div>
						<div class="checkbox">
							<label>
								<input type="checkbox" name="eelsdb_spectra_deconv_maximum_entropy" value="0" <?php if($s_deconv_maximum_entropy == '1') echo 'checked="checked" '; ?>> Maximum-Entropy
							</label>
						</div>
					</div>
				</div>
			</div>
			<div class="form-group">
				<label for="eelsdb_spectra_deconv_other" class="col-sm-3 col-lg-4 control-label">Other Deconvolution</label>
				<div class="col-sm-9 col-md-8 col-lg-5">
					<input type="text" class="form-control" id="eelsdb_spectra_deconv_other" name="eelsdb_spectra_deconv_other" value="<?php echo $s_deconv_other; ?>" placeholder="Deconvolution Method">
				</div>
			</div>
		</fieldset>

		<fieldset>
			<legend>Associated Spectra</legend>
			<?php
            $s_assoc_spectra = '';
            if(isset($data['assoc_spectra'])){
                $s_assoc_spectra = '';
                $data['assoc_spectra'] = keep_unserializing($data['assoc_spectra']);
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
			<div class="form-group">
				<label for="eelsdb_spectra_assoc_spectra" class="col-sm-3 col-lg-4 control-label">EELS DB Spectra URLs</label>
				<div class="col-sm-9 col-md-8 col-lg-5">
					<textarea class="form-control" id="eelsdb_spectra_assoc_spectra" name="eelsdb_spectra_assoc_spectra" rows="3"><?php echo $s_assoc_spectra; ?></textarea>
                    <span class="help-block">Add one URL per line, for each associated EELS DB spectra.</span>
                    <span class="help-block">These should look like <small><samp>https://eelsdb.eu/?post_type=spectra&p=1234</samp></small>
                         or <small><samp>https://eelsdb.eu/spectra/related-spectrum/</samp></small></span>
                    <span class="help-block">Note that you can add other relevant links below - see
                         <label for="eelsdb_spectra_otherURLs" style="cursor:pointer;">Other URLs</label></span>
				</div>
			</div>
        </fieldset>

        <fieldset>
			<legend>Associated References</legend>
			<?php
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
			?>
			<div class="form-group">
				<label for="eelsdb_spectra_ref_doi" class="col-sm-3 col-lg-4 control-label">DOI (Digital Object Identifier)</label>
				<div class="col-sm-7 col-md-6 col-lg-3">
					<input type="text" class="form-control" id="eelsdb_spectra_ref_doi" name="eelsdb_spectra_ref_doi" value="<?php echo $s_doi; ?>" placeholder="10.1063/1.1707491">
				</div>
                <div class="col-sm-2 text-right">
                  <button class="btn btn-default" id="find_doi">
                    <span class="glyphicon glyphicon-refresh glyphicon-spin" aria-hidden="true" style="display:none;" id="doi_spinner"></span>
                    Find ref
                  </button>
                </div>
			</div>
			<div class="form-group">
				<div class="col-sm-push-3 col-lg-push-4 col-sm-9 col-md-8 col-lg-5">
					<span class="help-block">If your work is not yet published, you can get a dataset DOI with <a href="http://www.zenodo.org" target="_blank">Zenodo</a>.</span>
				</div>
			</div>
			<div class="form-group">
				<label for="eelsdb_spectra_ref_url" class="col-sm-3 col-lg-4 control-label">Web Link</label>
				<div class="col-sm-9 col-md-8 col-lg-5">
					<input type="text" class="url form-control" id="eelsdb_spectra_ref_url" name="eelsdb_spectra_ref_url" value="<?php echo $s_url; ?>" placeholder="http://www.example.com">
				</div>
			</div>
			<div class="form-group">
				<label for="eelsdb_spectra_ref_journal" class="col-sm-3 col-lg-4 control-label">Reference</label>
				<div class="col-sm-9 col-md-8 col-lg-5">
					<div class="form-inline">
						<div class="form-group">
							<input type="text" class="form-control" id="eelsdb_spectra_ref_journal" name="eelsdb_spectra_ref_journal" value="<?php echo $s_ref_journal; ?>" placeholder="Journal">
						</div>
						<div class="form-group">
							<input type="text" class="form-control" id="eelsdb_spectra_ref_volume" name="eelsdb_spectra_ref_volume" value="<?php echo $s_ref_volume; ?>" placeholder="Volume">
						</div>
						<div class="form-group">
							<input type="text" class="form-control" id="eelsdb_spectra_ref_issue" name="eelsdb_spectra_ref_issue" value="<?php echo $s_ref_issue; ?>" placeholder="Issue">
						</div>
						<div class="form-group">
							<input type="text" class="form-control" id="eelsdb_spectra_ref_page" name="eelsdb_spectra_ref_page" value="<?php echo $s_ref_page; ?>" placeholder="Page">
						</div>
						<div class="form-group">
							<input type="text" class="number form-control" id="eelsdb_spectra_ref_year" name="eelsdb_spectra_ref_year" value="<?php echo $s_ref_year; ?>" placeholder="Year">
						</div>
					</div>
				</div>
			</div>
			<div class="form-group">
				<label for="eelsdb_spectra_ref_title" class="col-sm-3 col-lg-4 control-label">Reference Title</label>
				<div class="col-sm-9 col-md-8 col-lg-5">
					<textarea class="form-control" id="eelsdb_spectra_ref_title" name="eelsdb_spectra_ref_title" placeholder="Title"><?php echo $s_ref_title; ?></textarea>
				</div>
			</div>
			<div class="form-group">
				<label for="eelsdb_spectra_ref_authors" class="col-sm-3 col-lg-4 control-label">Reference Authors</label>
				<div class="col-sm-9 col-md-8 col-lg-5">
					<textarea class="form-control" id="eelsdb_spectra_ref_authors" name="eelsdb_spectra_ref_authors" placeholder="Authors"><?php echo $s_ref_authors; ?></textarea>
				</div>
			</div>
			<div class="form-group">
				<label for="eelsdb_spectra_otherURLs" class="col-sm-3 col-lg-4 control-label">Other URLs</label>
				<div class="col-sm-9 col-md-8 col-lg-5">
					<textarea class="form-control" id="eelsdb_spectra_otherURLs" name="eelsdb_spectra_otherURLs" placeholder="Other relevant URLs"><?php echo $s_otherURLs; ?></textarea>
					<span class="help-block">One per line. Follow the URL with the text that you would like to be displayed. <em>eg.</em> <small><samp>http://www.example.com My Nice Website</samp></small></span>
				</div>
			</div>
		</fieldset>

		<fieldset>
			<div class="form-group">
				<div class="col-sm-offset-3 col-lg-offset-4 col-sm-9 col-md-8 col-lg-5">
					<div class="checkbox">
						<label>
							<input type="checkbox" name="eelsdb_spectra_agreement" id="eelsdb_spectra_agreement" value="true" required>
							By submitting this data to the EELS Data Base, I agree to license it under the Open Data Commons Open Database License. My work can be re-used, as long as myself and the EELS Data Base are credited.
						</label>
						<span class="help-block">Find out more about the Open Data Commons Open Database License (ODbL) licence here: <a href="http://opendatacommons.org/licenses/odbl/" target="_blank">http://opendatacommons.org/licenses/odbl/</a></span>
					</div>
				</div>
			</div>
		</fieldset>

		<fieldset class="form-actions">
			<div class="form-group">
				<div class="col-sm-offset-3 col-lg-offset-4 col-sm-9 col-md-8 col-lg-5">
					<input type="submit" name="eelsdb_spectra_submit_btn" id="eelsdb_spectra_submit_btn" class="btn btn-lg btn-primary" value="<?php echo $edit ? 'Edit' : 'Submit'; ?> Spectrum">
					<?php if($edit && current_user_can('edit_others_posts')) { ?>
						<a href="<?php echo $edit_spectrum_url.'?delete='.$data['post_id']; ?>" class="btn btn-lg btn-danger" onclick="return confirm('Are you sure that you want to delete this spectrum? It will be sent to the trash.');">Delete Spectrum</a>
					<?php } ?>
				</div>
			</div>
		</fieldset>
	</form>

	<?php
	$form = ob_get_clean();
	return $form;
}


////////////////////////////////////////////
// Function to process the POST data
////////////////////////////////////////////
function eelsdb_submit_spectrum_save_post ($data, $edit, $old, $post){

	// Validate the Nonce
	if(!wp_verify_nonce($data['upload_nonce'], plugin_basename(__FILE__).'../')) {
		return array(false, '<strong>Error</strong> - Problem with the security nonce');
	} else {
		// We don't need to save this in the database..
		unset($data['upload_nonce']);
	}

	// Check user permissions
	if($edit && !current_user_can('edit_others_posts') && $post->post_author != get_current_user_id() ){
		return array(false, '<strong>Error:</strong> You do not have permission to edit this spectrum.');
	}

	// Pull out and remove fields that we don't want to save
	unset($data['submit_btn']);
	$save_microscope_preset = false;
	if(isset($data['save_microscope_details'])){
		$save_microscope_preset = trim($data['save_microscope_details']);
		unset($data['save_microscope_details']);
	}

	// LOOK FOR EMPTY FIELDS
	// function to check multiple fields in one go
	function fields_empty($vars, $data) {
		foreach($vars as $var){
			if(!isset($data[$var]) || (empty($data[$var]) && $data[$var] !== '0')){
				echo $data[$var].' - '.$var;
				return true;
			}
		}
		return false;
	}
	$required_fields = array(
		'post_title', 'spectrumType', 'microscope', 'guntype',
		'beamenergy', 'resolution', 'convergence', 'collection', 'detector'
	);
	$required_notZeroLoss = array('spectrumFormula','darkcurrent', 'gainvariation',
		'calibration');
	if(fields_empty($required_fields, $data)){
		return array(false, '<strong>Error</strong> - Required fields were empty..');
	}
	if($data['spectrumType'] != 'zeroloss' && fields_empty($required_notZeroLoss, $data)){
		return array(false, '<strong>Error</strong> - Required loss fields were empty..');
	}
	if(!$edit && !isset($data['spectrumUpload'])){
		return array(false, '<strong>Error</strong> - No file upload detected..');
	}

    // Convert the associated spectra field into an array of post IDs
    $assoc_ids = [];
    foreach(preg_split('/\s+/', trim($data['assoc_spectra'])) as $url){
        $postid = url_to_postid( $url );
        if($postid){
            if(get_post_type($postid) == 'spectra'){
                $assoc_ids[] = $postid;
            } else {
                return array(false, '<strong>Error</strong> - Associated Spectrum URL is not a spectra: <code>'.$url.'</code> - "'.get_the_title($postid).'"');
            }
        } elseif(strlen($url) > 0) {
            return array(false, '<strong>Error</strong> - Associated Spectrum URL not recognised as an EELS DB spectrum: <code>'.$url.'</code>');
        }
    }
    $data['assoc_spectra'] = maybe_serialize($assoc_ids);


	// Upload Spectrum File
	if($data['spectrumUpload']) {
		// Delete existing file if it already exists
		if(strlen($old['spectrumUpload']['file']) > 0 && file_exists($old['spectrumUpload']['file'])){
    	    if(!unlink($old['spectrumUpload']['file'])) {
				return array(false, '<strong>Error</strong> - There was an error trying to delete the old spectrum file.');
    	    }
		}
		// Upload new file
		$upload = wp_upload_bits($data['spectrumUpload']['name'], null, file_get_contents($data['spectrumUpload']['tmp_name']));
		if(isset($upload['error']) && strlen($upload['error']) !== 0 && $upload['error'] !== 0) {
			return array(false, '<strong>Error</strong> - There was an error uploading the spectrum file: ' . $upload['error']);
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

	// Make post core data array
	$post_id = false;
	$msg = false;
	$post_core = Array (
		'post_title'   => $data['post_title'],
		'post_excerpt' => $data['spectrumComments'],
		'post_type'	   => 'spectra'
	);
	unset($data['post_title'], $data['spectrumComments']);

	// Register / Set author if not logged in
	$new_user = false;
	if( !is_user_logged_in() ){
		$author_user_id = email_exists( $data['author_email'] );
		if( $author_user_id ) {
			$post_core['post_author'] = $author_user_id;
		} else {
			// New user - sign them up..
			$new_user = true;
			preg_match('/^([^@]+)/', $data['author_email'], $un_matches);
			$username = $un_matches[0];
			$i = 1;
			while( username_exists( $username ) ){
				$username = $un_matches[0].'_'.$i;
				$i++;
			}
			$random_password = wp_generate_password( $length=12, $include_standard_special_chars=false );
			$userdata = array(
				'user_login'   =>  $username,
				'user_pass'    =>  $random_password,
				'user_email'   =>  $data['author_email'],
				'display_name' =>  $data['author_firstname'].' '.$data['author_lastname'],
				'nickname'     =>  $data['author_firstname'],
				'first_name'   =>  $data['author_firstname'],
				'last_name'    =>  $data['author_lastname']
			);
			$user_id = wp_insert_user( $userdata );
			if( is_wp_error( $user_id ) ) {
				return array(false, '<strong>Error</strong> - Could not register new user <code>'.$data['author_email'].'</code>: <pre>'.print_r($un_matches, true).'</pre>'.$user_id->get_error_message());
			} else {
				wp_new_user_notification( $user_id, $random_password );
				$post_core['post_author'] = $user_id;
			}
		}
	} else {
		$post_core['post_author'] = get_current_user_id();
	}

	// Update post core if editing
	if($edit){
		$post_core['ID'] = $post->ID;
		$post_id = $post->ID;
		if(!wp_update_post($post_core)){
			return array(false, "<strong>Error</strong> - Could not update post core data (post ID: $post_id)");
		}
		$success_msg = 'Spectrum successfully edited. <a href="'.get_permalink($post_id).'">Click here</a> to see it.';
	}

	// Create new post
	else {
		$post_core['post_name'] = sanitize_title_with_dashes($post_core['post_title'],'','save');
		$post_core['post_status'] = 'pending';
		$post_id = wp_insert_post($post_core);
		$success_msg = 'Spectrum successfully submitted. Thanks! Your submission will be moderated and made available as soon as possible.';
        if( !is_user_logged_in() ){
            if($new_user){
                $success_msg .= '</p><p>You should receive an e-mail with your login details shortly.';
            } else {
                $success_msg .= '</p><p>The e-mail address was already registered so we added the spectrum to your profile.';
            }
            $success_msg .= ' Please <a href="'.wp_login_url(get_author_posts_url( $post_core['post_author'] )).'">log in</a> to see your submitted spectra..';
        } else {
            $success_msg .= '</p><p>To preview your submitted spectra, <a href="'.get_permalink($post_id).'">click here</a> (temporary link).';
			$success_msg .= '</p><p>You can keep track of your submitted spectra on the <a href="'.get_author_posts_url( $post_core['post_author'] ).'">Uploaded Spectra</a> page on your profile.</p>';
		}
	}

	// Add our keywords
	if(!is_array(wp_set_post_terms($post_id, $data['spectrumKeywords'], 'keywords', false))){
		if(!$edit){
			wp_delete_post($post_id);
		}
		return array(false, "<strong>Error</strong> - Could not insert spectrum keywords (post ID: $post_id)");
	} else {
		unset($data['spectrumKeywords']);
	}

	// Save elements
	$num_matches = preg_match_all('/([A-Z][a-z]?[a-z]?)/', $data['spectrumFormula'], $formula_split);
	$el_names = json_decode(file_get_contents(plugin_dir_path( __FILE__ ).'../resources/element_names.json'));
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
    foreach($assoc_ids as $assoc_id){
      $recip_assoc_ids = get_post_meta($assoc_id, 'assoc_spectra', true);
      $recip_assoc_ids = keep_unserializing($recip_assoc_ids);
      // return array(false, "recip_assoc_ids for ".get_the_title($assoc_id)."= <pre>".print_r($recip_assoc_ids, true)."</pre>.");
      if(!in_array($post_id, $recip_assoc_ids)){
        array_push($recip_assoc_ids, $post_id);
        $recip_assoc_ids = maybe_serialize($recip_assoc_ids);
        if(!update_post_meta($assoc_id, 'assoc_spectra', $recip_assoc_ids)){
  				if(!$edit){
  					wp_delete_post($post_id);
  				}
          return array(false, "<strong>Error:</strong> Could not update reciprocal associated spectrum <code>$assoc_id</code>: ".get_the_title($assoc_id).".");
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
					if(!$edit){
						wp_delete_post($post_id);
					}
					return array(false, "<strong>Error:</strong> Could not update post meta data ('$key': <code>".$old[$key]."</code> changing to <code>".$newval."</code>, post ID: <code>$post_id</code>)");
				}
			}
		}
	}

	// Last but not least - save the microscope acquisition details as a preset
	if($save_microscope_preset && strlen($save_microscope_preset) > 0){
		$preset_slug = str_replace('-','_',sanitize_title_with_dashes($save_microscope_preset));
		$microscope_keys = ['microscope','guntype','beamenergy','resolution','monochromated',
							'convergence','collection','probesize','beamcurrent',
							'integratetime','readouts','detector'];
		$preset_data = wp_array_slice_assoc($data, $microscope_keys);
		$presets = get_user_meta(get_current_user_id(), 'microscope_presets', true);
		$presets[$preset_slug] = ['name' => $save_microscope_preset, 'data' => $preset_data];
		update_user_meta(get_current_user_id(), 'microscope_presets', $presets );
	}

	// Return the post ID and message
	return array($post_id, $success_msg);
}

function keep_unserializing($input){
  while(is_serialized( $input )) {
    $input = unserialize($input);
  }
  return $input;
}


?>
