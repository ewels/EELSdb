<?php
/*
Template Name: Single EELS DB Spectrum
*/
////////////////////////////////////////////
// EELS DB Spectra Plugin
// spectra_view_spectrum.php
// Theme template for a single spectrum
// These are defaults and will be ignored if
// there is a file called "single-spectra.php"
// in the theme folder..
////////////////////////////////////////////

// Enqueue EELS DB JS
wp_register_script('eelsdb_spectra_view_spectra_js', plugin_dir_url(dirname(__FILE__) ).'js/eelsdb-view-spectra.js', array('jquery') );
wp_enqueue_script( 'eelsdb_spectra_view_spectra_js' );
// Add some CSS
wp_enqueue_style( 'eelsdb_spectra_frontend_css', plugin_dir_url( dirname(__FILE__) ).'css/eelsdb_frontend.css' );

get_header();

// Approve spectrum waiting to be moderated
if(current_user_can('edit_others_posts') && $_GET['approve'] == $post->ID){
  $post->post_status = 'publish';
  if(wp_update_post($post)){
    echo '<div class="alert alert-success" role="alert"><strong>Spectrum approved.</strong> The author of this spectrum has been notified by e-mail.</div>';
  } else {
    echo '<div class="alert alert-danger" role="alert"><strong>Could not approve spectrum.</strong> Something went wrong, sorry..</div>';
  }
}

// Make spectrum private
if(current_user_can('edit_others_posts') && $_GET['make_private'] == $post->ID){
  $post->post_status = 'private';
  if(wp_update_post($post)){
    echo '<div class="alert alert-success" role="alert"><strong>Spectrum set to private.</strong></div>';
  } else {
    echo '<div class="alert alert-danger" role="alert"><strong>Could not make spectrum private.</strong> Something went wrong, sorry..</div>';
  }
}

// Make spectrum public again
if(current_user_can('edit_others_posts') && $_GET['make_public'] == $post->ID){
  $post->post_status = 'publish';
  if(wp_update_post($post)){
    echo '<div class="alert alert-success" role="alert"><strong>Spectrum set to public.</strong></div>';
  } else {
    echo '<div class="alert alert-danger" role="alert"><strong>Could not make spectrum public.</strong> Something went wrong, sorry..</div>';
  }
}

// FAVOURITES
$favourites = get_user_meta(get_current_user_id(), 'eelsdb_favourites');
if(!is_array($favourites)){ $favourites = []; }
if(in_array(get_the_ID(), $favourites)){
  $is_favourite = true;
} else {
  $is_favourite = false;
}

// Make spectrum a favourite
if(is_user_logged_in() && isset($_GET['favourite'])){
  if(!in_array(get_the_ID(), $favourites)){
    add_user_meta(get_current_user_id(), 'eelsdb_favourites', get_the_ID());
    echo '<div class="alert alert-success" role="alert"><strong>Spectrum set as a favourite.</strong> See your <a href="'.get_author_posts_url( get_current_user_id() ).'?favourites">favourite spectra here</a>.</div>';
    $is_favourite = true;
  }
}

// Remove specutrm from favourites
if(is_user_logged_in() && isset($_GET['unfavourite'])){
  if(in_array(get_the_ID(), $favourites)){
    delete_user_meta(get_current_user_id(), 'eelsdb_favourites', get_the_ID());
    echo '<div class="alert alert-success" role="alert"><strong>Spectrum removed as a favourite.</strong></div>';
    $is_favourite = false;
  }
}

// Are we showing an overlay plot?
$overlay = false;
$overlayData = false;
if(is_user_logged_in() && isset($_GET['overlay']) && is_numeric($_GET['overlay'])){
  $overlay = intval($_GET['overlay']);
  $overlayData = get_spectrum_data($overlay);
  $overlay_html_formula = make_formula_html($overlayData['spectrumFormula']);
}


// Get the spectrum meta data
$data = get_spectrum_data($post->ID);

if (have_posts()) {	the_post();

  // SET UP VARIABLES
  global $current_user;
  get_currentuserinfo();
  $html_formula = make_formula_html($data['spectrumFormula']);
  global $spectra_types;

  // AWAITING MODERATION BOX
  if(get_post_status() == 'pending'){ ?>
    <div class="alert alert-warning" role="alert">
      <h2>Spectrum Awaiting Moderation.</h2>
      <p>Note that some parts of this page <em>(for example, the URL)</em> may change when the spectrum is approved by a moderator. Until then, this page is only visible to you and the site administrators. If you would like to get in touch about your spectrum submission, please use the <a href="<?php echo home_url( "contact/" ); ?>">Contact</a> page.</p>
      <?php if(current_user_can('edit_others_posts')){
        echo '<p><a href="'.get_the_permalink().'&approve='.get_the_ID().'" class="btn btn-primary btn-large">Approve Spectrum</a> &nbsp; ';
        echo '<a href="'.get_the_permalink().'&make_private='.get_the_ID().'" class="btn btn-warning">Make Private</a></p>';
      } ?>
    </div>
    <?php
  }

  // PRIVATE SPECTRUM BOX
  if(get_post_status() == 'private'){ ?>
    <div class="alert alert-danger" role="alert">
      <h2>Private Spectrum.</h2>
      <p>This spectrum has been set to private and is only visible to administrators. Click <strong>Publish Spectrum</strong> below to make the spectrum visible to all users.</p>
      <?php if(current_user_can('edit_others_posts')){
        echo '<p><a href="'.get_the_permalink().'?make_public='.get_the_ID().'" class="btn btn-primary btn-large">Publish Spectrum</a></p>';
      } ?>
    </div>
    <?php
  }

  // TITLE AND HEADER
  $the_title = ucwords(get_the_title());
  $the_title = preg_replace('/^Private: /', '', $the_title);
  ?>
  <h1><?php echo $the_title; ?>
    <small>Formula: <span id="spectrum_formula"><?php echo $html_formula; ?></span></small>
    <small><?php echo $spectra_types[$data['spectrumType']]; ?></small>
    <span class="spectrum-buttons pull-right">
      <?php
      // MATERIALS EXPLORER BUTTON
      if(strlen($data['spectrumFormula']) > 0){
        if($me_raw = @file_get_contents('https://www.materialsproject.org/rest/v1/materials/'.$data['spectrumFormula'].'/mids')){
          if($me_json = @json_decode($me_raw)){
            $me_ids = $me_json->response;
          }
        }
      }
      if(count($me_ids) > 0){	?>
        <div class="btn-group">
          <button type="button" class="btn btn-default dropdown-toggle" data-toggle="dropdown">
            View in Materials Explorer <span class="caret"></span>
          </button>
          <ul class="dropdown-menu" role="menu">
            <?php
            foreach($me_ids as $me_id){
              echo '<li><a href="https://www.materialsproject.org/materials/'.$me_id.'/" target="_blank">'.$me_id.'</a></li>';
            }
            ?>
          </ul>
        </div>
        <?php
      }

      // EDIT SPECTRUM BUTTON
      if(current_user_can('edit_others_posts') || $post->post_author == get_current_user_id() ){
        echo 	'<a href="'.$edit_spectrum_url.'?edit='.get_the_ID().'" class="btn btn-sm btn-info" data-toggle="tooltip" title="Edit Spectrum"><span class="glyphicon glyphicon-pencil"></span></a> ';
      }

      // MAKE SPECTRUM PRIVATE
      if(current_user_can('edit_others_posts') && get_post_status() == 'publish'){
        echo '<a href="'.get_the_permalink().'?make_private='.get_the_ID().'" class="btn btn-sm btn-warning" data-toggle="tooltip" title="Make Spectrum Private"><span class="glyphicon glyphicon-lock"></span></a> ';
      }

      // FAVOURITE BUTTON
      if(is_user_logged_in()){
        if(!$is_favourite){
          echo '<a href="'.get_the_permalink().'?favourite" class="btn btn-sm btn-success" data-toggle="tooltip" title="Add this spectrum to my favourites">Add to Favourites</a> ';
        } else {
          echo '<a href="'.get_the_permalink().'?unfavourite" class="btn btn-sm btn-success" data-toggle="tooltip" title="Remove this a spectrum from favourites">Remove from Favourites</a> ';
        }
      }

      // DOWNLOAD MODAL TRIGGER
      ?>
      <button class="btn btn-primary btn-sm" data-toggle="modal" data-target="#download_spectrum_modal" title="Download Spectrum Data">Download</button>
    </span>
  </h1>


  <?php
  // Author page link
  echo '<p class="post_date">Submitted by <a href="'.home_url('forum/users/'.get_the_author_meta('user_nicename').'/').'">'.get_the_author_meta('display_name').'</a>, '.get_the_date().'.</p>';
  if(strlen($data['source_purity']) > 0){
    echo '<p class="lead"><em>Source / Purity:</em> '.ucfirst($data['source_purity']).'</p>';
  }

  // Author Comments
  $excerpt = get_the_excerpt();
  if(strlen(trim($excerpt)) > 0){
    echo '<p><em>Author Comments:</em> '.ucfirst($excerpt).'</p>';
  }

  // Overlay favourite plot dropdown
  if(!$overlay){
    $overlay_dropdown;
    foreach($favourites as $fav){
      $fav_title = get_the_title($fav);
      $fav_data = get_spectrum_data($fav);
      if($fav !== get_the_ID() && strlen($fav_title) > 0){
        $overlay_dropdown[] = '<option value="'.$fav.'">'.$fav_title.': '.$fav_data['spectrumFormula'].'</option>'."\n";
      }
    }
    if(!is_user_logged_in()){
      echo '<div class="pull-right text-muted"><a href="'.home_url('wp-login.php?action=register').'">Register</a> / <a href="'.home_url('wp-login.php').'">log in</a> to set favourite spectra and overlay plots.</div>';
    } else if(count($overlay_dropdown) == 0){
      echo '<div class="pull-right text-muted">Set some other spectras as <a href="'.get_author_posts_url( get_current_user_id() ).'?favourites">favourites</a> to overlay multiple plots</div>';
    } else {
      ?>
      <form class="form-inline pull-right">
        <div class="form-group">
          <label class="control-label" for="overlay_graph_dropdown" style="font-weight:normal;">Select overlay plot:</label>
          <select id="overlay_graph_dropdown" name="overlay" class="form-control input-sm">
            <?php echo implode("\n", $overlay_dropdown); ?>
          </select>
        </div>
        <button type="submit" class="btn btn-sm btn-default">Show</button>
      </form>
      <?php }
    } else {
      echo '<div class="pull-right">';
      echo '<a class="btn btn-sm btn-default" href="#" id="hc_independent_axes">Independent Axes</a> ';
      echo '<a class="btn btn-sm btn-default" href="'.get_the_permalink().'">Remove overlay plot</a>';
      echo '</div>';
    }

    // The Plot
    echo '<div class="clearfix"></div>';
    echo '<div id="eelsdb_spectrum_plot"><div class="plot_loading_msg">loading plot..</div></div>';
    if($data['spectrumType'] == 'lowloss'){
      echo '<p>Chart x axis limited to &gt; 2 eV due to low loss spectrum type. <a href="#" id="remove_x_limit">Click here</a> to remove this limit. You may also';
    } else {
      echo '<p>You can';
    }
    ?>
    <a href="#" id="show_limit_axes">manually set the axis limits</a>.</p>
    <div id="eels_chart_limit_axes" class="well" style="display:none;">
      <form class="form-inline">
        <div class="row">
          <div class="col-sm-2">
            <div class="form-group">
              <label for="eels_limit_x_min">x-min</label>
              <input type="text" class="form-control" id="eels_limit_x_min" placeholder="x minimum" style="width:100px; margin-left:10px;">
            </div>
          </div>
          <div class="col-sm-2">
            <div class="form-group">
              <label for="eels_limit_x_max">x-max</label>
              <input type="text" class="form-control" id="eels_limit_x_max" placeholder="x maximum" style="width:100px; margin-left:10px;">
            </div>
          </div>
          <div class="col-sm-2">
            <div class="form-group">
              <label for="eels_limit_y_min">y-min</label>
              <input type="text" class="form-control" id="eels_limit_y_min" placeholder="y minimum" style="width:100px; margin-left:10px;">
            </div>
          </div>
          <div class="col-sm-2">
            <div class="form-group">
              <label for="eels_limit_y_max">y-max</label>
              <input type="text" class="form-control" id="eels_limit_y_max" placeholder="y maximum" style="width:100px; margin-left:10px;">
            </div>
          </div>
          <div class="col-sm-2">
            <button type="submit" class="btn btn-block btn-primary" id="set_spectra_axes">Set</button>
          </div>
          <div class="col-sm-2">
            <button type="submit" class="btn btn-block btn-default" id="reset_spectra_axes">Auto</button>
          </div>
        </div>
      </form>
    </div>

    <?php
    // Collect the keywords
    $s_keywords = [];
    foreach(wp_get_post_terms(get_the_ID(), 'keywords') as $keyword){
      $s_keywords[] = '<a href="'.get_term_link($keyword).'">'.$keyword->name.'</a>';
    }

    // Collect the deconvolutions
    $deconv = array();
    if(yn_isset($data['deconv_fourier_log']) && $data['deconv_fourier_log']){ $deconv[] = 'Fourier-log'; }
    if(yn_isset($data['deconv_fourier_ratio']) && $data['deconv_fourier_ratio']){ $deconv[] = 'Fourier-ratio'; }
    if(yn_isset($data['deconv_stephens_deconvolution']) && $data['deconv_stephens_deconvolution']){ $deconv[] = "Stephen's deconvolution"; }
    if(yn_isset($data['deconv_richardson_lucy']) && $data['deconv_richardson_lucy']){ $deconv[] = 'Richardson-Lucy'; }
    if(yn_isset($data['deconv_maximum_entropy']) && $data['deconv_maximum_entropy']){ $deconv[] = 'Maximum-Entropy'; }
    if(st_isset($data['deconv_other'])){ $deconv[] = $data['deconv_other']; }

    // Three columns of metadata lists
    echo '<h3>Spectrum Metadata</h3>';
    echo '<div class="row"><div class="col-md-4">';
    echo '<dl class="dl-horizontal">';
    if(st_isset($data['microscope'])){        echo '<dt>Specimen Name</dt><dd>'.$data['microscope'].'</dd>'; }
    if(st_isset($data['spectrumType'])){      echo '<dt>Spectrum Type</dt><dd>'.$spectra_types[$data['spectrumType']].'</dd>'; }
    if(st_isset($data['spectrumFormula'])){   echo '<dt>Specimen Formula</dt><dd>'.$html_formula.'</dd>'; }
    if(nm_isset($data['spectrumMax'])){       echo '<dt>Data Range</dt><dd>'.round($data['spectrumMin'], 2).' eV - '.round($data['spectrumMax'], 2).' eV</dd>'; }
    if(st_isset($data['source_purity'])){     echo '<dt>Source and Purity</dt><dd>'.$data['source_purity'].'</dd>'; }
    if(count($data['spectrumEdges']) > 0){    echo '<dt>Elemental Edges</dt><dd>'.implode(', ', $data['spectrumEdges']).'</dd>'; }
    if(count($s_keywords) > 0){               echo '<dt>Keywords</dt><dd>'.implode(', ',$s_keywords).'</dd>'; }
    if(unser_array($data['assoc_spectra'])){
      echo '<dt>Associated Spectra</dt>';
      foreach(unser_array($data['assoc_spectra']) as $assoc_id){
        if(get_post_type($assoc_id) == 'spectra'){
          $assoc_type = get_post_meta($assoc_id, 'spectrumType', true);
          echo '<dd><small>'.$spectra_types_short[$assoc_type].'</small> <a href="'.get_permalink($assoc_id).'" target="_blank">'.get_the_title($assoc_id).'</a></dd>';
        }
      }
    }
    if(st_isset($data['otherURLs'])){
      $urls = explode("\n", $data['otherURLs']);
      $s = count($urls) > 1 ? 's':'';
      echo "<dt>Alternative URL$s</dt>";
      foreach($urls as $line){
        list($url, $text) = explode(" ", $line, 2);
        $text = trim($text);
        if(strlen($text) == 0) $text = $url;
        echo '<dd><a href="'.$url.'" target="_blank">'.$text.'</a></dd>';
      }
    }
    echo '</dl>';
    echo '</div>';

    echo '<div class="col-md-4">';
    echo '<dl class="dl-horizontal">';
    if(st_isset($data['microscope'])){        echo '<dt>Microscope Name / Model</dt><dd>'.$data['microscope'].'</dd>'; }
    if(st_isset($data['guntype'])){           echo '<dt>Gun Type</dt><dd>'.$data['guntype'].'</dd>'; }
    if(nm_isset($data['beamenergy'])){        echo '<dt>Incident Beam Energy</dt><dd>'.$data['beamenergy'].' kV</dd>'; }
    if(nm_isset($data['resolution'])){        echo '<dt>Resolution</dt><dd>'.$data['resolution'].' eV</dd>'; }
    if(yn_isset($data['monochromated'])){     echo '<dt>Monochromated</dt><dd>'.($data['monochromated'] ? 'Yes':'No').'</dd>'; }
    if(nm_isset($data['stepSize'])){          echo '<dt>Dispersion</dt><dd>'.$data['stepSize'].' eV/pixel'; }
    if(st_isset($data['acquisition_mode'])){  echo '<dt>Acquisition Mode</dt><dd>'.$data['acquisition_mode'].'</dd>'; }
    if(nm_isset($data['convergence'])){       echo '<dt>Convergence Semi-angle</dt><dd>'.$data['convergence'].' mrad</dd>'; }
    if(nm_isset($data['collection'])){        echo '<dt>Collection Semi-angle</dt><dd>'.$data['collection'].' mrad</dd>'; }
    if(nm_isset($data['probesize'])){         echo '<dt>Probe Size</dt><dd>'.$data['probesize'].' nm<sup>2</sup></dd>'; }
    if(nm_isset($data['beamcurrent'])){       echo '<dt>Beam Current</dt><dd>'.$data['beamcurrent'].'</dd>'; }
    if(nm_isset($data['integratetime'])){     echo '<dt>Integration Time</dt><dd>'.$data['integratetime'].' secs</dd>'; }
    if(nm_isset($data['readouts'])){          echo '<dt>Number of Readouts</dt><dd>'.$data['readouts'].'</dd>'; }
    if(st_isset($data['detector'])){          echo '<dt>Detector</dt><dd>'.$data['detector'].'</dd>'; }
    echo '</dl>';
    echo '</div>';

    echo '<div class="col-md-4">';
    echo '<dl class="dl-horizontal">';
    if(yn_isset($data['darkcurrent'])){       echo '<dt>Dark Current Correction</dt><dd>'.($data['darkcurrent'] ? 'Yes':'No').'</dd>'; }
    if(yn_isset($data['gainvariation'])){     echo '<dt>Gain Variation Spectrum</dt><dd>'.($data['gainvariation'] ? 'Yes':'No').'</dd>'; }
    if(st_isset($data['calibration'])){       echo '<dt>Calibration</dt><dd>'.$data['calibration'].'</dd>'; }
    if(nm_isset($data['thickness'])){         echo '<dt>Relative Thickness</dt><dd>'.$data['thickness'].' t/&lambda;</dd>'; }
    if(count($deconv) > 0){                   echo '<dt>Deconvolutions</dt><dd>'.implode(', ', $deconv).'</dd>'; }
    if(st_isset($data['ref_freetext'])){      echo '<dt>Reference</dt><dd>'.$data['ref_freetext'].'</dd>'; }

    $ref_text = '';
    if(st_isset($data['ref_authors'])){ $ref_text .= $data['ref_authors'].' '; }
    if(st_isset($data['ref_year'])){ $ref_text .= '('.$data['ref_year'].'). '; }
    if(st_isset($data['ref_title'])){ $ref_text .= $data['ref_title'].' '; }
    if(st_isset($data['ref_journal'])){ $ref_text .= '<em>'.$data['ref_journal'].'</em> '; }
    if(st_isset($data['ref_volume'])){ $ref_text .= $data['ref_volume']; }
    if(st_isset($data['ref_issue'])){ $ref_text .= ':<strong>'.$data['ref_issue'].'</strong>'; }
    if(st_isset($data['ref_page'])){ $ref_text .= ' '.$data['ref_page']; }
    if(st_isset($ref_text)){                  echo '<dt>Reference</dt><dd>'.$ref_text.'</dd>'; }

    if(st_isset($data['ref_doi'])){           echo '<dt>DOI</dt><dd><a target="_blank" href="http://dx.doi.org/'.$data['ref_doi'].'">'.$data['ref_doi'].'</a></dd>'; }
    if(st_isset($data['ref_url'])){           echo '<dt>Reference URL</dt><dd><a target="_blank" href="'.$data['ref_url'].'">'.$data['ref_url'].'</a></dd>'; }

    echo '</dl>';
    echo '<button class="btn btn-primary btn-lg btn-block" data-toggle="modal" data-target="#download_spectrum_modal">Download Spectrum</button>';
    echo '</div></div>';

    comments_template();

    // echo '<br><pre>'.print_r($data, true).'</pre>';

    ?>

    <!-- DOWNLOAD MODAL -->
    <div id="download_spectrum_modal" class="modal fade">
      <div class="modal-dialog">
        <div class="modal-content">
          <div class="modal-header">
            <button type="button" class="close" data-dismiss="modal" aria-hidden="true">&times;</button>
            <h3 class="modal-title">Download Spectrum</h3>
          </div>
          <div class="modal-body">
            <p>Thank you for using the EELS DB website! Remember, if you use any data obtained from this website
              in any work, you must cite it's original publication.</p>
            <hr>
            <?php
            if(st_isset($data['ref_freetext'])){      echo '<p><em>'.$data['ref_freetext'].'</em></p>'; }
            if(st_isset($ref_text)){                  echo '<p>'.$ref_text.'</p>'; }
            if(st_isset($data['ref_doi'])){           echo '<p>DOI: <a target="_blank" href="http://dx.doi.org/'.$data['ref_doi'].'">'.$data['ref_doi'].'</a></p>'; }
            if(st_isset($data['ref_url'])){           echo '<p><a target="_blank" href="'.$data['ref_url'].'">'.$data['ref_url'].'</a></p>'; }
            
            if(!st_isset($data['ref_freetext']) && !st_isset($ref_text) && !st_isset($data['ref_doi']) && !st_isset($data['ref_url'])){     
              echo '<p><em>No reference found for this data.</em></p>';
            }
            ?>
            <hr>
            <p>Please also cite the publication describing this website:</p>
            <div id="eelsdb-citation-trad" class="eeldb-citation">
              <blockquote style="font-size: 12px;">
                <p>Philip Ewels, Thierry Sikora, Virginie Serin, Chris P. Ewels and Luc Lajaunie.<br>
                &quot;A Complete Overhaul of the Electron Energy-Loss Spectroscopy and X-Ray Absorption Spectroscopy Database: eelsdb.eu.&quot;<br>
                <em>Microscopy and Microanalysis</em>, available on CJO2016. doi:<a href="http://dx.doi.org/10.1017/S1431927616000179" target="_blank">10.1017/S1431927616000179</a>.</p>
              </blockquote>
            </div>
            <div id="eelsdb-citation-bibtex" class="eeldb-citation" style="display:none;">
              <pre>@article{MAM:10195259,
author = {Ewels,Philip and Sikora,Thierry and Serin,Virginie and Ewels,Chris P. and Lajaunie,Luc},
title = {A Complete Overhaul of the Electron Energy-Loss Spectroscopy and X-Ray Absorption Spectroscopy Database: eelsdb.eu},
journal = {Microscopy and Microanalysis},
volume = {FirstView},
month = {2},
year = {2016},
issn = {1435-8115},
pages = {1--8},
numpages = {8},
doi = {10.1017/S1431927616000179},
URL = {http://journals.cambridge.org/article_S1431927616000179},
}</pre>
            </div>
            <p id="eelsdb-citation-switches">
              <a href="#eelsdb-citation-trad" style="text-decoration:underline;">Traditional</a> | 
              <a href="#eelsdb-citation-bibtex">BibTeX</a>
            </p>
          </div>
          <div class="modal-footer">
            <button class="btn btn-default" data-dismiss="modal" aria-hidden="true">Cancel</button>
            <a href="<?php echo $data['spectrumUpload']['url']; ?>" class="btn btn-primary" target="_blank">Download</a>
          </div>
        </div>
      </div>
    </div>

    <script type="text/javascript">
    jQuery(function ($) {
      
      // EELS DB citation switches
      $('#eelsdb-citation-switches a').click(function(e){
        e.preventDefault();
        $('.eeldb-citation').hide();
        $( $(this).attr('href') ).show();
        $('#eelsdb-citation-switches a').css('text-decoration', 'none');
        $(this).css('text-decoration', 'underline');
      });

      <?php // Load the overlay data if we need it
      if($overlay){ ?>
        $.get('<?php echo $overlayData['spectrumUpload']['url']; ?>', function (overlayData) {
          overlayData = parseSpectum(overlayData);
      <?php } ?>

      // Load the data
      $.get('<?php echo $data['spectrumUpload']['url']; ?>', function (data) {
        spectrumData = parseSpectum(data);
        if(spectrumData.length > 0){
          try {
            // Plot the graph
            var spectrum_plot = new Highcharts.Chart({
              chart: {
                renderTo: 'eelsdb_spectrum_plot',
                zoomType: 'xy',
                events: {
                  load: function(){
                    setExtremeLimitInputs(this);
                  },
                  redraw: function(){
                    setExtremeLimitInputs(this);
                  },
                },
              },
              title: {
                text: 'EELS Spectra'
              },
              subtitle: {
                text: document.ontouchstart === undefined ?
                'Click and drag in the plot area to zoom in' :
                'Pinch the chart to zoom in'
              },
              xAxis: {
                <?php if($data['spectrumType'] == 'lowloss') echo "min: 2,\n"; ?>
                title: {
                  text: 'Energy (eV)'
                },
                <?php
                if(count($data['spectrumEdges']) > 0){
                  // Get the element level data
                  $levels = json_decode(file_get_contents(plugin_dir_path( dirname(__FILE__) ).'resources/element_levels.json'), true);
                  $el_names = json_decode(file_get_contents(plugin_dir_path( dirname(__FILE__) ).'resources/element_names.json'), true);
                  echo "plotLines: [";
                  foreach($data['spectrumEdges'] as $edge){
                    $el = explode('_', $edge, 2);
                    if(isset($levels[$el[0]][$el[1]])){
                      $val = $levels[$el[0]][$el[1]];
                      $label = $el_names[$el[0]].', '.$el[1].': '.$val.' eV';
                      echo "{width: 1, color: '#000000', value: $val, label: { text: '$label', rotation:0, verticalAlign: 'bottom', y: -10 }},";
                    }
                  }
                  echo "]";
                }
                ?>
              },
              yAxis: [{ // primary axis
                min: 0,
                title: {
                  useHTML: true,
                  text: 'Counts: <?php the_title(); echo ' ('.$html_formula.')'; ?>',
                  style: {
                    color: '#a11d15'
                  }
                },
                labels: {
                  style: {
                    color: '#a11d15'
                  }
                },
                maxPadding: 0,
              } <?php if($overlay){ ?> , { // secondary axis
                min: 0,
                title: {
                  useHTML: true,
                  text: 'Counts: <?php echo get_the_title($overlay).' ('.$overlay_html_formula.')'; ?>',
                  style: {
                    color: '#b96615',
                    display: 'none'
                  }
                },
                labels: {
                  style: {
                    color: '#b96615'
                  }
                },
                maxPadding: 0,
                visible: false,
              }
              <?php }  // if($overlay){ - secondary axis
                ?>],
                tooltip: {
                  crosshairs: true,
                  shared: true,
                  formatter: function() {
                    var s = '<b>'+ (this.x).toFixed(2) +' eV</b>';
                    $.each(this.points, function(i, point) {
                      s += '<br/>'+ point.series.name +'. Intensity: ' + parseInt(point.y) + ' counts';
                    });
                    return s;
                  },
                },
                legend: {
                  layout: 'vertical',
                  floating: true,
                  verticalAlign: 'top',
                  align: 'right',
                  x: 0,
                  y: 50
                },
                series: [{
                  name: '<?php echo html_entity_decode(get_the_title()).' ('.$data['spectrumFormula'].')'; ?>',
                  type: 'line',
                  color: '#a11d15',
                  marker: {
                    enabled: false
                  },
                  data: spectrumData
                }<?php if($overlay){ ?> , {
                  name: '<?php echo html_entity_decode(get_the_title($overlay)).' ('.$overlayData['spectrumFormula'].')';; ?>',
                  type: 'line',
                  color: '#b96615',
                  marker: {
                    enabled: false
                  },
                  data: overlayData,
                  yAxis: 0
                }
              <?php }
               ?>]
            }); // var spectrum_plot = new Highcharts.Chart({

          } // end of try block
          catch(err){
            $('#eelsdb_spectrum_plot').addClass('plot-error').html('Error: unable to plot data.<br>Please try <a data-toggle="modal" data-target="#download_spectrum_modal" href="#download_spectrum_modal">downloading</a> and plotting.');
            console.log('Error plotting spectrum: '+err.message);
          }


          <?php
          if($data['spectrumType'] == 'lowloss'){ ?>
            // Remove the xlimit on click
            $('#remove_x_limit').click(function(e){
              e.preventDefault();
              var chart_options = spectrum_plot.options;
              chart_options.xAxis[0].min = null;
              spectrum_plot = new Highcharts.Chart(chart_options);
            });
          <?php } // lowloss spectrum ?>

          $('#show_limit_axes').click(function(e){
            e.preventDefault();
            $('#eels_chart_limit_axes').slideToggle();
          });

          $('#set_spectra_axes').click(function(e){
            e.preventDefault();
            spectrum_plot = setPlotLimits(spectrum_plot);
          });
          $('#reset_spectra_axes').click(function(e){
            e.preventDefault();
            $('#eels_limit_x_min').val('');
            $('#eels_limit_x_max').val('');
            $('#eels_limit_y_min').val('');
            $('#eels_limit_y_max').val('');
            spectrum_plot = setPlotLimits(spectrum_plot);
          });

        }
        // No spectrum data loaded
        else {
          $('#eelsdb_spectrum_plot').addClass('plot-error').html('Error: unable to parse data.<br>Please try <a data-toggle="modal" data-target="#download_spectrum_modal" href="#download_spectrum_modal">downloading</a> and plotting.');
        }
      }).fail(function(){
        $('#eelsdb_spectrum_plot').addClass('plot-error').html('Error: unable to load data.');
      }); // End of waiting for spectrum data to load


      <?php if($overlay) { // End of waiting for overlay spectrum data to load
        echo '});';
      } ?>

      // Function to parse the MSA file
      function parseSpectum(data){
        xyData = new Array();
        data = data.trim();
        var lines = data.split('\n');
        var scale = 1; var thisx = 0;
        var datatype = 'XY';
        $.each(lines, function(i, value){
          value = value.trim();
          // Headers
          if(value.substr(0,1) == '#'){
            headers = value.split(/:/, 2);
            if(headers[0].trim() == '#XPERCHAN'){  scale = parseFloat(headers[1].trim());    }
            if(headers[0].trim() == '#OFFSET'){    thisx = parseFloat(headers[1].trim());    }
            if(headers[0].trim() == '#DATATYPE'){  datatype = headers[1].trim(); }
          }
          // Data
          else {
            if(datatype == 'Y'){
              var vals = value.trim().split(/[ ,]+/);
              $.each(vals, function(i, val){
                val = parseFloat(val.trim());
                if(!isNaN(val)){
                  xyData.push([thisx, val]);
                }
                thisx += scale;
              });
            } else {
              var vals = value.trim().split(/[ ,]+/, 2);
              val1 = parseFloat(vals[0]);
              val2 = parseFloat(vals[1]);
              if(!isNaN(val1) && !isNaN(val2)){
                xyData.push([val1, val2]);
              }
            }
          }
        });
        return xyData;
      }

      function setPlotLimits(spectrum_plot){
        var chart_options = spectrum_plot.options;
        if($.isNumeric($('#eels_limit_x_min').val())){ var x_min = $('#eels_limit_x_min').val(); } else { var x_min = null; }
        if($.isNumeric($('#eels_limit_x_max').val())){ var x_max = $('#eels_limit_x_max').val(); } else { var x_max = null; }
        if($.isNumeric($('#eels_limit_y_min').val())){ var y_min = $('#eels_limit_y_min').val(); } else { var y_min = null; }
        if($.isNumeric($('#eels_limit_y_max').val())){ var y_max = $('#eels_limit_y_max').val(); } else { var y_max = null; }
        chart_options.xAxis[0].min = x_min;
        chart_options.xAxis[0].max = x_max;
        chart_options.yAxis[0].min = y_min;
        chart_options.yAxis[0].max = y_max;
        spectrum_plot = new Highcharts.Chart(chart_options);
        return spectrum_plot;
      }

      function setExtremeLimitInputs(thisplot){
        var x_extremes = thisplot.xAxis[0].getExtremes();
        var y_extremes = thisplot.yAxis[0].getExtremes();
        $('#eels_limit_x_min').val(x_extremes.min);
        $('#eels_limit_x_max').val(x_extremes.max);
        $('#eels_limit_y_min').val(y_extremes.min);
        $('#eels_limit_y_max').val(y_extremes.max);
      }
    });
  </script>

<?php


} else {
  echo '<div class="alert alert-error" role="alert"><h2>Error</h2><p>Apologies - we can\'t find that spectrum.</p></div>';
}

get_footer();
