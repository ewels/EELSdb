<?php

////////////////////////////////////////////
// EELS DB Spectra Plugin
// import_old_db.php
// Script to import old spectra into new system
////////////////////////////////////////////

// Set up Shortcode
add_shortcode('import-old-eels-db', 'eelsdb_import_old_database');

// Shortcode function
function eelsdb_import_old_database ( $atts ) {
	
	return 'disabled';
	exit;
	
	if(!isset($_GET['go'])){
		$output = '<p class="lead">Warning - running this script is seriously risky!</p>';
		$output .= '<p> It manually messes around with the database and has the potential to destroy the whole site. ';
		$output .= 'It is highly recommended that you only run it on a local dev version of the site when everything is backed up..</p>';
		$output .= '<p>Are you ready?</p><p><a href="'.$_SERVER['REQUEST_URI'].'?go" class="btn btn-lg btn-primary">Preview Import</a> &nbsp; ';
		$output .= '<a href="'.$_SERVER['REQUEST_URI'].'?go&import=true" class="btn btn-lg btn-danger">Run Import</a></p>';
		return $output;
	} else {
		error_reporting(E_ALL);
		echo '<p class="lead" id="intro_text">Running the import... See the <a href="#summary">summary</a>.</p></div>';
		echo '<table class="table table-condensed table-striped" style="margin:0 10px;">';
		echo '<thead><tr>
			<th>Old ID</th>
			<th>Old Status</th>
			<th>User Name / E-mail</th>
			<th>Specimen Name</th>
			<th>Spectrum Type</th>
			<th>Data Upload</th>
			<th>Spectrum Min Energy</th>
			<th>Spectrum Max Energy</th>
			<th>Step Size</th>
			<th>Specimen Formula</th>
			<th>Source &amp; Purity</th>
			<th>Author Comments</th>
			<th>Edge</th>
			<th>Microscope Name / Model</th>
			<th>Gun Type</th>
			<th>Incident Beam Engergy</th>
			<th>Resolution</th>
			<th>Monochromated</th>
			<th>Acquisition Mode</th>
			<th>Convergence Semi-angle</th>
			<th>Collection Semi-angle</th>
			<th>Probe Size</th>
			<th>Beam Current</th>
			<th>Integration Time</th>
			<th>Number of Readouts</th>
			<th>Detector</th>
			<th>Dark Current Correction</th>
			<th>Gain Variation Spectrum</th>
			<th>Calibration</th>
			<th>Relative Thickness</th>
			<th>Fourier-log</th>
			<th>Fourier-ratio</th>
			<th>Stephen\'s deconvolution</th>
			<th>Richardson-Lucy</th>
			<th>Maximum-Entropy</th>
			<th>Other Deconvolution</th>
			<th>Free Text Bibliography Field</th>
			<th>Associated Low Loss</th>
			<th>Other URLs</th>
			<th>Submission Date</th>
		</tr>
		<tr>
			<th>..</th>
			<th>..</th>
			<th>New User</th>
			<th><code>post_title</code></th>
			<th><code>spectrumType</code></th>
			<th><code>spectrumUpload</code></th>
			<th><code>spectrumMin</code></th>
			<th><code>spectrumMax</code></th>
			<th><code>stepSize</code></th>
			<th><code>spectrumFormula</code></th>
			<th><code>source_purity</code></th>
			<th><code>spectrumComments</code></th>
			<th><code>spectrumEdges[]</code></th>
			<th><code>microscope</code></th>
			<th><code>guntype</code></th>
			<th><code>beamenergy</code></th>
			<th><code>resolution</code></th>
			<th><code>monochromated</code></th>
			<th><code>acquisition_mode</code></th>
			<th><code>convergence</code></th>
			<th><code>collection</code></th>
			<th><code>probesize</code></th>
			<th><code>beamcurrent</code></th>
			<th><code>integratetime</code></th>
			<th><code>readouts</code></th>
			<th><code>detector</code></th>
			<th><code>darkcurrent</code></th>
			<th><code>gainvariation</code></th>
			<th><code>calibration</code></th>
			<th><code>thickness</code></th>
			<th><code>deconv_fourier_log</code></th>
			<th><code>deconv_fourier_ratio</code></th>
			<th><code>deconv_stephens_deconvolution</code></th>
			<th><code>deconv_richardson_lucy</code></th>
			<th><code>deconv_maximum_entropy</code></th>
			<th><code>deconv_other</code></th>
			<th><code>ref_freetext</code></th>
			<th><code>assoc_lowLoss</code></th>
			<th><code>otherURLs</code></th>
			<th><code>post_date</code></th>
		</tr></thead><tbody>';
		$new_spectra = Array();
		$db_old = new wpdb('eelsdb_51za7ubpc', 'RIIM+L;wTfwm$OSrLE', 'eelsdb_old_spectra', 'localhost');
		$db_old->show_errors();
		$spectra = $db_old->get_results("SELECT * FROM spectrum ORDER BY id ASC");
		// NOT TABLE USERS
		$users_raw = $db_old->get_results("SELECT * FROM sv_users ORDER BY id ASC", ARRAY_A);
		$users = [];
		foreach($users_raw as $user){
			$users[$user['id']] = $user;
		}
		$new_users = [];
		$broken_users = [];
		$broken_spectrum_types = 0;
		$files_found = 0;
		$nomsa_files = 0;
		$broken_levels = 0;
		$broken_darkcurrent = 0;
		$broken_gainvariation = 0;
		$empty_darkcurrent = 0;
		$empty_gainvariation = 0;
		$missing_detectortype = 0;
		$bad_statuses = 0;
        $bad_format_data = 0;
		$assoc_lowloss_ids = Array();
		$edges = $db_old->get_results("SELECT * FROM edgelevel ORDER BY id ASC", ARRAY_N);
        // echo '<pre>'.print_r($edges, true).'</pre>';
		$spectra_types = $db_old->get_results("SELECT * FROM spectrumtype ORDER BY id ASC", ARRAY_N);
		$spectra_statuses = $db_old->get_results("SELECT * FROM spectrumstatus ORDER BY id ASC", ARRAY_N);
		$detectortypes = $db_old->get_results("SELECT * FROM detectortype ORDER BY id ASC", ARRAY_N);
		$modes = $db_old->get_results("SELECT * FROM mode ORDER BY id ASC", ARRAY_N);
		foreach ($spectra as $spectrum) {
			$new_s = Array();
			echo '<tr id="'.$spectrum->id.'">';
		    echo '<td><code>'.$spectrum->id.'</code></td>';
				$new_s['old_id'] = $spectrum->id;
				if($spectrum->statusid == '4'){
					echo '<td>'.$spectra_statuses[$spectrum->statusid-1][1].'</td>';
					$new_s['post_status'] = 'publish';
				} else {
					echo '<td class="danger">'.$spectra_statuses[$spectrum->statusid-1][1].'</td>';
					$new_s['post_status'] = 'private';
					$bad_statuses++;
				}
			if(array_key_exists($spectrum->userid, $users)){
				$user = $users[$spectrum->userid];
				$new_users[$spectrum->userid] = $user;
				echo '<td>'.ucfirst($user['firstname']).' '.ucfirst($user['lastname']).' &lt;'.$user['login'].'&gt;</td>';
				$email_parts = explode("@", $user['login']);
				$userlogin = $email_parts[0];
				$new_s['user']['user_login'] = $userlogin;
				$new_s['user']['user_email'] = $user['email'];
				$new_s['user']['first_name'] = $user['firstname'];
				$new_s['user']['last_name'] = $user['lastname'];
				$new_s['user']['display_name'] = $user['firstname'].' '.$user['lastname'];
				$new_s['user']['user_url'] = $user['url'];
				$new_s['user']['user_registered'] = $user['dtcreate'].' 00:00:00';
				$new_s['user']['u_lab'] = $user['lab'];
				$new_s['user']['u_address'] = $user['adr'];
				$new_s['user']['u_zip'] = $user['zip'];
				$new_s['user']['u_city'] = $user['city'];
				$new_s['user']['u_country'] = $user['country'];
				$new_s['user']['u_phone'] = $user['phone'];
			} else {
				$broken_users[$spectrum->userid] = $spectrum->userid;
				echo '<td class="danger">'.($spectrum->userid-1).'</td>';
			}
		    echo '<td>'.$spectrum->specimenname.'</td>';
			$new_s['post_title'] = $spectrum->specimenname;
			if($spectrum->spectrumtypeid == 1){
				echo '<td>lowloss (<code>'.$spectra_types[$spectrum->spectrumtypeid-1][1].'</code>)</td>';
				$new_s['spectrumType'] = 'lowloss';
			} else if($spectrum->spectrumtypeid == 2){
				echo '<td>coreloss (<code>'.$spectra_types[$spectrum->spectrumtypeid-1][1].'</code>)</td>';
				$new_s['spectrumType'] = 'coreloss';
			} else if($spectrum->spectrumtypeid == 3){
				echo '<td>xrayabs (<code>'.$spectra_types[$spectrum->spectrumtypeid-1][1].'</code>)</td>';
				$new_s['spectrumType'] = 'xrayabs';
			} else {
				$broken_spectrum_types++;
				echo '<td class="danger">'.$spectrum->spectrumtypeid.'</td>';
			}		 
			
			// upload file name
			$the_file = false;   
		    $msafile = realpath(dirname(__FILE__)).'/Data/'.$spectrum->datafilename.'.msa';
				$converted_msafile = realpath(dirname(__FILE__)).'/Data/'.$spectrum->datafilename.'_converted.msa';
		    $rawdatafile = realpath(dirname(__FILE__)).'/Data/'.$spectrum->datafilename;
			$msafile_link = plugins_url( '/Data/'.$spectrum->datafilename.'.msa' , __FILE__ );
			$converted_msafile_link = plugins_url( '/Data/'.$spectrum->datafilename.'_converted.msa' , __FILE__ );
			$rawdatafile_link = plugins_url( '/Data/'.$spectrum->datafilename , __FILE__ );
			if(file_exists($msafile)){
				$files_found++;
				echo '<td>';
                if(!data_looks_right($msafile)){
                    $bad_format_data++;
                }
                echo '<a href="'.$msafile_link.'">'.basename($msafile).'</a> (<code>'.$spectrum->datafilename.'</code>)</td>';
				$new_s['spectrumUpload'] = $msafile;
			} else if(file_exists($converted_msafile)){
				$files_found++;
				echo '<td><a href="'.$converted_msafile_link.'">'.basename($converted_msafile).'</a> (<code>'.$spectrum->datafilename.'</code>)</td>';
				$new_s['spectrumUpload'] = $converted_msafile;
			} else if(file_exists($rawdatafile)){
				$msa_title = $spectrum->specimenformula."_".$spectra_types[$spectrum->spectrumtypeid-1][1]."_".$user['lastname']."_".$user['firstname']."_".$spectrum->id;
				$msa_title = str_replace(' ', '-', $msa_title);
				$msa_title = preg_replace('/[^A-Za-z0-9\-_]/', '', $msa_title);
				$new_fn = convert_data_to_msa($rawdatafile, $msa_title);
				$new_fn_base = basename($new_fn);
				$msafile_link = plugins_url( '/Data/'.$new_fn_base , __FILE__ );
				$msafile = realpath(dirname(__FILE__)).'/Data/'.$new_fn_base;
				if(file_exists($msafile)){
					$files_found++;
					echo '<td class="info"><a href="'.$msafile_link.'">'.basename($msafile).'</a> (<code>'.$spectrum->datafilename.'</code> - converted)</td>';
					$new_s['spectrumUpload'] = $msafile;
				} else {
					$files_found++;
					$nomsa_files++;
					$new_s['spectrumUpload'] = $rawdatafile;
					echo '<td class="warning"><a href="'.$rawdatafile_link.'">'.basename($rawdatafile).'</a> (<code>'.$spectrum->datafilename.'</code>)</td>';
				}
			} else {
				echo '<td class="danger"><code>'.$spectrum->datafilename.'</code></td>';
			}
			
			// get min and max
			list($new_s['spectrumMin'], $new_s['spectrumMax'], $new_s['stepSize']) = find_spectra_min_max($new_s['spectrumUpload']);
		    echo '<td>'.$new_s['spectrumMin'].'</td>'; // MIN
		    echo '<td>'.$new_s['spectrumMax'].'</td>'; // MAX
		    echo '<td>'.$new_s['stepSize'].'</td>'; // RES
				
		    echo '<td>'.$spectrum->specimenformula.'</td>';
			$new_s['spectrumFormula'] = $spectrum->specimenformula;
		    echo '<td>'.$spectrum->sourcepurity.'</td>';
			$new_s['source_purity'] = $spectrum->sourcepurity;
		    $comments = $spectrum->comments.' ';
			if(strlen($spectrum->analystname) > 0){
				$comments .= 'Analyst: '.$spectrum->analystname.'. ';
			}
			if(strlen($spectrum->temperature) > 0){
				$comments .= 'Temperature: '.$spectrum->temperature.'. ';
			}
			if(strlen($spectrum->beamorientation) > 0 && $spectrum->beamorientation !== 'unknown' && $spectrum->beamorientation !== '?'){
				$comments .= 'BEAM/Crystal: '.$spectrum->beamorientation.'. ';
			}
			echo '<td>'.$comments.'</td>';
			$new_s['spectrumComments'] = $comments;
			if(strlen($spectrum->edgeelement) < 1){
				if($new_s['spectrumType'] != 'lowloss'){
					$broken_levels++;
				}
				echo '<td class="warning">N/A (<code>'.$spectrum->edgeelement." - id: ".$spectrum->edgelevelid.'</code>)</td>';
			} else {
                $thisedge = $edges[$spectrum->edgelevelid-1][1];
                if($thisedge == 'L2' or $thisedge == 'L3'){
                    $thisedge = 'L2,3';
                }
                $newlevel = $spectrum->edgeelement."_".$thisedge;
				echo '<td>'.$newlevel.'</td>';
				$new_s['spectrumEdges'][] = $newlevel;
			}
			echo '<td>'.$spectrum->microscope.'</td>';
			$new_s['microscope'] = $spectrum->microscope;
			echo '<td>'.$spectrum->guntype.'</td>';
			$new_s['guntype'] = $spectrum->guntype;
			if($spectrum->incidentbeamenergy < 1){
				$missing_detectortype++;
				echo '<td class="warning">'.($spectrum->incidentbeamenergy * 1000).' (<code>'.$spectrum->incidentbeamenergy.'</code>)</td>';
				$new_s['beamenergy'] = $spectrum->incidentbeamenergy * 1000;
			} else {
				echo '<td>'.$spectrum->incidentbeamenergy.'</td>';
				$new_s['beamenergy'] = $spectrum->incidentbeamenergy;
			}
			echo '<td>'.$spectrum->fwmh.'</td>';
			$new_s['resolution'] = floatval($spectrum->fwmh);
			echo '<td>N/A</td>';
			if($spectrum->modeid > 0 && $spectrum->modeid < 7){
				echo '<td>'.$modes[$spectrum->modeid-1][1].'</td>';
				$new_s['acquisition_mode'] = $modes[$spectrum->modeid-1][1];
			} else {
				echo '<td class="danger">'.$spectrum->spectrumtypeid.'</td>';
			}
			echo '<td>'.$spectrum->convergenceangle.'</td>';
			$new_s['convergence'] = $spectrum->convergenceangle;
			echo '<td>'.$spectrum->collectionangle.'</td>';
			$new_s['collection'] = $spectrum->collectionangle;
			echo '<td>'.$spectrum->probesize.'</td>';
			$new_s['probesize'] = $spectrum->probesize;
			echo '<td>'.$spectrum->beamcurrent.'</td>';
			$new_s['beamcurrent'] = $spectrum->beamcurrent;
			echo '<td>'.$spectrum->integratetime.'</td>';
			$new_s['integratetime'] = $spectrum->integratetime;
			echo '<td>'.$spectrum->readouts.'</td>';
			$new_s['readouts'] = $spectrum->readouts;
			if(array_key_exists($spectrum->detectortypeid-1, $detectortypes)){
				echo '<td>'.$detectortypes[$spectrum->detectortypeid-1][1].': '.$spectrum->detectorname.'</td>';
				$new_s['detector'] = $detectortypes[$spectrum->detectortypeid-1][1].': '.$spectrum->detectorname;
			} else {
				echo '<td class="warning">'.$spectrum->detectorname.'</td>';
				$new_s['detector'] = $spectrum->detectorname;
			}
			if(preg_match('/^yes$/i', $spectrum->darkcurrentcorrected)){
				echo '<td>1 (<code>'.$spectrum->darkcurrentcorrected.'</code>)</td>';
				$new_s['darkcurrent'] = '1';
			} else if(preg_match('/^no$/i', $spectrum->darkcurrentcorrected)){
				echo '<td>0 (<code>'.$spectrum->darkcurrentcorrected.'</code>)</td>';
				$new_s['darkcurrent'] = '0';
			} else if(strlen($spectrum->darkcurrentcorrected) == 0){
				$empty_darkcurrent++;
				echo '<td class="warning">0 (<code>'.$spectrum->darkcurrentcorrected.'</code>)</td>';
				$new_s['darkcurrent'] = '0';
			} else {
				$broken_darkcurrent++;
				echo '<td class="danger">N/A (<code>'.$spectrum->darkcurrentcorrected.'</code>)</td>';
			}
			if(preg_match('/^yes$/i', $spectrum->gaincorrected)){
				echo '<td>1 (<code>'.$spectrum->gaincorrected.'</code>)</td>';
				$new_s['gainvariation'] = '1';
			} else if(preg_match('/^no$/i', $spectrum->gaincorrected)){
				echo '<td>0 (<code>'.$spectrum->gaincorrected.'</code>)</td>';
				$new_s['gainvariation'] = '0';
			} else if(strlen($spectrum->gaincorrected) == 0){
				$empty_gainvariation++;
				echo '<td class="warning">0 (<code>'.$spectrum->gaincorrected.'</code>)</td>';
				$new_s['gainvariation'] = '0';
			} else {
				$broken_gainvariation++;
				echo '<td class="danger">N/A (<code>'.$spectrum->gaincorrected.'</code>)</td>';
			}
			echo '<td class="danger">N/A</td>';
			echo '<td>'.$spectrum->thickness.'</td>';
			$new_s['thickness'] = $spectrum->thickness;
			echo '<td class="danger">N/A</td>';
			echo '<td class="danger">N/A</td>';
			echo '<td class="danger">N/A</td>';
			echo '<td class="danger">N/A</td>';
			echo '<td class="danger">N/A</td>';
			echo '<td class="danger">N/A</td>';
			echo '<td>'.$spectrum->bibreferences.'</td>';
			$new_s['ref_freetext'] = $spectrum->bibreferences;
			if(strlen($spectrum->Associatedlowlossid) > 0 && $spectrum->Associatedlowlossid !== '0'){
				echo '<td><em>Find dynamically after import</em> (<code>'.$spectrum->Associatedlowlossid.'</code>)</td>';
				$assoc_lowloss_ids[$spectrum->id] = $spectrum->Associatedlowlossid;
			} else echo '<td></td>';
			
			// Other URLs
			echo '<td><small><a href="http://pc-web.cemes.fr/eelsdb/index.php?page=displayspec.php&id='.$spectrum->id.'" target="_blank">http://pc-web.cemes.fr/eelsdb/index.php?page=displayspec.php&id='.$spectrum->id.'</a></small></td>';
			$new_s['otherURLs'] = 'http://pc-web.cemes.fr/eelsdb/index.php?page=displayspec.php&id='.$spectrum->id.' Old EELS DB';
			
			// Submission date
			if($spectrum->submissiondate == '0000-00-00'){
				echo '<td class="warning">'.$spectrum->submissiondate.'</td>';
				$new_s['post_date'] = '2005-04-20 00:00:00';
			} else {
				echo '<td>'.$spectrum->submissiondate.'</td>';
				$new_s['post_date'] = $spectrum->submissiondate.' 00:00:00';
			}
			echo "</tr>\n";
			$new_spectra[] = $new_s;
			ob_implicit_flush();
		}
		echo '</tbody></table><div class="container">';
		echo '<div id="summary" class="well">';
		echo '<h2 style="margin-top:0;">Summary Stats</h2>';
		echo '<p class="text-success"><i class="glyphicon glyphicon-ok"></i> &nbsp; <strong>'.count($spectra).'</strong> new spectra to add</p>';
		echo '<p class="text-info"><i class="glyphicon glyphicon-question-sign"></i> &nbsp; <strong>'.$bad_statuses.'</strong> have a status which is not <code>Published</code>.</p>';
		echo '<p class="text-info"><i class="glyphicon glyphicon-question-sign"></i> &nbsp; <strong>'.count($assoc_lowloss_ids).'</strong> spectra with associated low loss spectra</code>.</p>';
		echo '<p><span class="text-success"><i class="glyphicon glyphicon-ok"></i> &nbsp; <strong>'.count($new_users).'</strong> new users to add</span></p>';
		// ', <span class="text-danger"><strong>'.(count($broken_users)).'</strong> not found.</span></p>';
		echo '<p><span class="text-success"><i class="glyphicon glyphicon-ok"></i> &nbsp; <strong>'.$files_found.'</strong> files found</span><br>
            &nbsp; &nbsp; &nbsp; &nbsp; <span class="text-danger"><i class="glyphicon glyphicon-remove"></i> &nbsp; <strong>'.$bad_format_data.'</strong> have bad data format.</span><br>
			&nbsp; &nbsp; &nbsp; &nbsp; <span class="text-info"><i class="glyphicon glyphicon-question-sign"></i> &nbsp; <strong>'.$nomsa_files.'</strong> without a msa file but with raw data</span><br>
		    &nbsp; &nbsp; &nbsp; &nbsp; <span class="text-danger"><i class="glyphicon glyphicon-remove"></i> &nbsp; <strong>'.(count($spectra) - $files_found).'</strong> are missing.</span></p>';
		// echo '<p class="text-danger"><i class="glyphicon glyphicon-remove"></i> &nbsp; <strong>'.$broken_spectrum_types.'</strong> spectra with unrecognised spectrum types.</p>';
		echo '<p class="text-danger"><i class="glyphicon glyphicon-remove"></i> &nbsp; <strong>'.$broken_levels.'</strong> spectra with broken edges.</p>';
		echo '<p class="text-danger"><i class="glyphicon glyphicon-remove"></i> &nbsp; <strong>'.$missing_detectortype.'</strong> spectra with missing detector types.</p>';
		echo '<p><span class="text-info"><i class="glyphicon glyphicon-question-sign"></i> &nbsp; <strong>'.$empty_darkcurrent.'</strong> spectra with empty Dark Current Correction values (assuming No).</span></p>';
		//, <span class="text-danger"><strong>'.$broken_darkcurrent.'</strong> spectra with broken values.</span></p>';
		echo '<p><span class="text-danger"><i class="glyphicon glyphicon-remove"></i> &nbsp; <strong>'.$broken_gainvariation.'</strong> spectra with broken Gain Variation Spectrum</span>, <span class="text-info"><strong>'.$empty_gainvariation.'</strong> spectra with empty Dark Current Correction values (assuming No).</p>';
		echo '<p class="text-info"><i class="glyphicon glyphicon-question-sign"></i> &nbsp; <strong>7</strong> fields not set (<code>calibration</code>, <code>deconv_fourier_log</code>, <code>deconv_fourier_ratio</code>, <code>deconv_stephens_deconvolution</code>, <code>deconv_richardson_lucy</code>, <code>deconv_maximum_entropy</code> and <code>deconv_other</code>).</p>'; 
		echo '</div>';
		
		echo '<pre id="first_record">EXAMPLE DATA FOR IMPORT'."\n\n";
		print_r($new_spectra[3]);
		echo '</pre>';
		
		$insert = false;
		if(isset($_GET['import']) && $_GET['import'] == 'true'){
			$insert = true;
		}
        
		if($insert){
			echo '<pre id="insert_messages">IMPORT MESSAGES'."\n\n";
			$new_ids = Array();
			foreach($new_spectra as $data){
				
				if(!isset($data['spectrumUpload']) || strlen($data['spectrumUpload']) < 3){
					echo ('<strong>Error</strong> - No file name. Skipping..'."\n");
					continue;
				}
				
				// upload file
				$upload = wp_upload_bits(basename($data['spectrumUpload']), null, file_get_contents($data['spectrumUpload']));  
				if(isset($upload['error']) && strlen($upload['error']) !== 0 && $upload['error'] !== 0) {
					echo ('<strong>Error</strong> - There was an error uploading the spectrum file: ' . $upload['error']);
					$data['spectrumUpload'] = '';
				} else {
					$data['spectrumUpload'] = $upload;
				}
				
				// save user
/////////////////TESTING - FAKE EMAIL
// $data['user']['user_email'] = sanitize_title_with_dashes($data['user']['display_name'],'','save').'@tallphil.co.uk';
// $data['user']['user_email'] = 'phil.ewels@scilifelab.se';
				$user_id = username_exists( $data['user']['user_login'] );
				if ( !$user_id and email_exists($data['user']['user_email']) == false ) {
					$data['user']['user_pass'] = wp_generate_password( 12, false );
					$user_id = wp_insert_user( $data['user'] ) ;
					echo '<h1>INSERTED USER - '.$data['user']['user_email'].'</h1>';
				}
				unset($data['user']);
				
				// save post core
				$post_core = Array (
					'post_title'   => $data['post_title'],
					'post_excerpt' => $data['spectrumComments'],
					'post_type'	   => 'spectra',
					'post_status'  => $data['post_status'],
					'post_author'  => $user_id,
					'post_date'    => $data['post_date']
				);
				unset($data['post_title'], $data['spectrumComments'], $data['post_status'], $data['post_date']);
				$post_core['post_name'] = sanitize_title_with_dashes($post_core['post_title'],'','save');
				$post_id = wp_insert_post($post_core);
				
				$new_ids[$data['old_id']] = $post_id;
				unset($data['old_id']);
				
				// add imported keyword
				wp_set_post_terms($post_id, 'imported from old site', 'keywords', false);
				
				// Save elements
				$num_matches = preg_match_all('/([A-Z][a-z]?[a-z]?)/', $data['spectrumFormula'], $formula_split);
				$el_names = json_decode(file_get_contents(plugin_dir_path( __FILE__ ).'/resources/element_names.json'));
				$elements = array();
				foreach($formula_split[0] as $el){
					if(array_key_exists($el, $el_names) && !in_array($el, $elements)){
						$elements[] = $el;
					}
				}
				if(count($elements) > 0){
					foreach($elements as $el){
						add_post_meta($post_id, 'spectrumElement', $el);
					}
				}
				
				// Save meta values
				global $meta_keys;
				foreach($meta_keys as $key){
					if(isset($data[$key])){
						update_post_meta($post_id, $key, $data[$key]);
					} else {
						// echo '<strong>Meta key not set</strong> - '.$key."\n";
					}
				}
				
			}
            
            // Convert associated spectrum IDs into new IDs
            $new_assoc_ids = [];
            foreach($assoc_lowloss_ids as $from => $to){
                $new_assoc_ids[$new_ids[$from]] = $new_ids[$to];
            }
            // echo '<pre>'.print_r($new_assoc_ids, true).'</pre>';
            
            // Save the reciprocal spectra links
            foreach($new_assoc_ids as $from => $to){
                $recip_assoc_ids = get_post_meta($to, 'assoc_spectra', true);
                $recip_assoc_ids[] = $from;
                update_post_meta($to, 'assoc_spectra', $recip_assoc_ids);
                // echo "<pre><strong>$from : $to</strong>\n".print_r(get_post_meta($to, 'assoc_spectra'), true).'</pre>';
            }
            foreach($new_assoc_ids as $to => $from){ // Reverse compliment
                $recip_assoc_ids = get_post_meta($to, 'assoc_spectra', true);
                $recip_assoc_ids[] = $from;
                update_post_meta($to, 'assoc_spectra', $recip_assoc_ids);
                // echo "<pre><strong>$from : $to</strong>\n".print_r(get_post_meta($to, 'assoc_spectra'), true).'</pre>';
            }

			echo '</pre>';
		}
		
		
		echo '<script type="text/javascript">jQuery("#summary, #first_record, #insert_messages").insertAfter("#intro_text");</script>';
	}
	
}


function data_looks_right ($fn){
	if(!file_exists($fn)){
        echo "<strong>File doesn't existr</strong>";
		return false;
	}
	$lines = file($fn);
    $num_lines = 0;
	foreach ($lines as $line) {
		if(substr($line, 0, 1) == '#'){
			continue;
		} else {
			$parts = preg_split('/,/', $line);
            if(count($parts) !== 2){
                echo '<strong>Found '.count($parts).' columns</strong>: <code>'.$line.'</code>';
                return false;
            }
			$energy = trim($parts[0]);
			$count = trim($parts[1]);
            if(!is_numeric($energy) || !is_numeric($count)){
                echo '<strong>Mot a number</strong>: <code>'.$line.'</code>';
                return false;
            }
            $num_lines++;
        }
    }
    if($num_lines < 10){
        echo '<strong>Not enough lines</strong> (only '.$num_lines.')';
        return false;
    }
    return true;
}


function convert_data_to_msa ($fn, $title){
	if(!file_exists($fn)){
		return false;
	}
	$spectrum_min = 999999999999;
	$spectrum_max = -999999999999;
	$xperchan = 0;
	$prev_energy = 0;
	$new_lines = Array();
	$lines = file($fn);
	foreach ($lines as $line) {
		if(substr($line, 0, 1) == '#'){
			continue;
		} else {
			$parts = preg_split('/\s+/', $line);
			$energy = $parts[0];
			$count = $parts[1];
			$new_lines[] = "$energy, $count";
			if($energy < $spectrum_min){
				$spectrum_min = $energy;
			}
			if($energy > $spectrum_max){
				$spectrum_max = $energy;
			}
			$xperchan = $energy - $prev_energy;
			$prev_energy = $energy;
		}
	}
	if($spectrum_min == 999999999999){
		$spectrum_min = '';
	}
	if($spectrum_max == -999999999999){
		$spectrum_max = '';
	}
	$num_lines = count($new_lines);
	
	$new_file = <<<EOT
#FORMAT	     : EMSA/MAS Spectral Data File
#VERSION     : 1.0
#TITLE       : $title
#DATE        : 
#TIME        : 
#OWNER       : eelsdatabase.net
#NPOINTS     : $num_lines
#NCOLUMNS    : 1
#XUNITS      : eV
#YUNITS      : 
#DATATYPE    : XY
#XPERCHAN    : $xperchan
#OFFSET      : $spectrum_min
#SIGNALTYPE  : ELS
#SPECTRUM    : Spectral Data Starts Here
EOT;
		$new_file .= "\n".implode("\n", $new_lines)."\n";
		$new_file .= "#ENDOFDATA   : End Of Data and File\n";
		
		// print "<pre>".$new_file."</pre>";
		
		$new_fn = $fn."_converted.msa";
		
		file_put_contents($new_fn, $new_file);
		return $new_fn;
}

?>