<?php
/*
 Code for API to process a Spectra wordpress loop and return the data
*/

$spectra = array();

// Initialise the post
while(have_posts()): the_post();

// Core fields
$results = array(
    'id' => get_the_ID(),
    'title' => get_the_title(),
    'permalink' => get_the_permalink(),
    'author' => array(
        'name' => get_the_author_meta('display_name'),
        'profile_url' => get_author_posts_url(get_the_author_ID()),
        'profile_api_url' => $api_permalink = str_replace('www', '', str_replace('://', '://api.', get_author_posts_url(get_the_author_ID())))
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

// Give just the download URL
if(isset($data['spectrumUpload']['url'])){$results['download_link'] =    $data['spectrumUpload']['url']; }

// Format the metadata
global $spectra_types_text;
if(st_isset($data['spectrumType'])){      $results['type'] =             $spectra_types_text[$data['spectrumType']]; }
if(st_isset($data['spectrumFormula'])){   $results['formula'] =          $data['spectrumFormula']; }
if(count($data['spectrumElement']) == 1){  $results['elements'] =        array($data['spectrumElement']); }
else if(count($data['spectrumElement']) > 1){  $results['elements'] =    $data['spectrumElement']; }
if(st_isset($data['microscope'])){        $results['microscope'] =       $data['microscope']; }
if(nm_isset($data['spectrumMax'])){       $results['max_energy'] =       round($data['spectrumMax'], 2).' eV'; }
if(nm_isset($data['spectrumMin'])){       $results['min_energy'] =       round($data['spectrumMin'], 2).' eV'; }
if(st_isset($data['source_purity'])){     $results['source_purity'] =    $data['source_purity']; }
if(count($data['spectrumEdges']) > 0){    $results['edges'] =            $data['spectrumEdges']; }
if(st_isset($data['microscope'])){        $results['microscope'] =       $data['microscope']; }
if(st_isset($data['guntype'])){           $results['guntype'] =          $data['guntype']; }
if(nm_isset($data['beamenergy'])){        $results['beamenergy'] =       $data['beamenergy'].' kV'; }
if(nm_isset($data['resolution'])){        $results['resolution'] =       $data['resolution'].' eV'; }
if(yn_isset($data['monochromated'])){     $results['monochromated'] =    ($data['monochromated'] ? 'Yes':'No'); }
if(nm_isset($data['stepSize'])){          $results['stepSize'] =         $data['stepSize'].' eV/pixel'; }
if(st_isset($data['acquisition_mode'])){  $results['acquisition_mode'] = $data['acquisition_mode']; }
if(nm_isset($data['convergence'])){       $results['convergence'] =      $data['convergence'].' mrad'; }
if(nm_isset($data['collection'])){        $results['collection'] =       $data['collection'].' mrad'; }
if(nm_isset($data['probesize'])){         $results['probesize'] =        $data['probesize'].' nm^2'; }
if(nm_isset($data['beamcurrent'])){       $results['beamcurrent'] =      $data['beamcurrent']; }
if(nm_isset($data['integratetime'])){     $results['integratetime'] =    $data['integratetime'].' secs'; }
if(nm_isset($data['readouts'])){          $results['readouts'] =         $data['readouts']; }
if(st_isset($data['detector'])){          $results['detector'] =         $data['detector']; }
if(yn_isset($data['darkcurrent'])){       $results['darkcurrent'] =      ($data['darkcurrent'] ? 'Yes':'No'); }
if(yn_isset($data['gainvariation'])){     $results['gainvariation'] =    ($data['gainvariation'] ? 'Yes':'No'); }
if(st_isset($data['calibration'])){       $results['calibration'] =      $data['calibration']; }
if(nm_isset($data['thickness'])){         $results['thickness'] =        $data['thickness'].' t/&lambda;'; }

if(yn_isset($data['deconv_fourier_log']) && $data['deconv_fourier_log']){                       $results['deconvolutions'][] = 'Fourier-log'; }
if(yn_isset($data['deconv_fourier_ratio']) && $data['deconv_fourier_ratio']){                   $results['deconvolutions'][] = 'Fourier-ratio'; }
if(yn_isset($data['deconv_stephens_deconvolution']) && $data['deconv_stephens_deconvolution']){ $results['deconvolutions'][] = "Stephen's deconvolution"; }
if(yn_isset($data['deconv_richardson_lucy']) && $data['deconv_richardson_lucy']){               $results['deconvolutions'][] = 'Richardson-Lucy'; }
if(yn_isset($data['deconv_maximum_entropy']) && $data['deconv_maximum_entropy']){               $results['deconvolutions'][] = 'Maximum-Entropy'; }
if(st_isset($data['deconv_other'])){                                                            $results['deconvolutions'][] = $data['deconv_other']; }

if(st_isset($data['ref_freetext'])){      $results['reference']['freetext'] =$data['ref_freetext']; }
if(st_isset($data['ref_authors'])){       $results['reference']['authors'] = $data['ref_authors']; }
if(st_isset($data['ref_year'])){          $results['reference']['year'] =    $data['ref_year']; }
if(st_isset($data['ref_journal'])){       $results['reference']['journal'] = $data['ref_journal']; }
if(st_isset($data['ref_title'])){         $results['reference']['title'] =   $data['ref_title']; }
if(st_isset($data['ref_volume'])){        $results['reference']['volume'] =  $data['ref_volume']; }
if(st_isset($data['ref_issue'])){         $results['reference']['issue'] =   $data['ref_issue']; }
if(st_isset($data['ref_page'])){          $results['reference']['page'] =    $data['ref_page']; }
if(st_isset($data['ref_doi'])){           $results['reference']['doi'] =     $data['ref_doi']; }
if(st_isset($data['ref_url'])){           $results['reference']['url'] =     $data['ref_url']; }

if(unser_array($data['assoc_spectra'])){
  foreach(unser_array($data['assoc_spectra']) as $assoc_id){
    if(get_post_type($assoc_id) == 'spectra'){
      $assoc_type = get_post_meta($assoc_id, 'spectrumType', true);
      $results['associated_spectra'][] = array(
          'name' => get_the_title($assoc_id),
          'link' => get_permalink($assoc_id),
          'type' => $spectra_types_text[$assoc_type]
      );
    }
  }
}
if(st_isset($data['otherURLs'])){
  $urls = explode("\n", $data['otherURLs']);
  foreach($urls as $line){
    list($url, $text) = explode(" ", $line, 2);
    $text = trim($text);
    $link = array('url' => $url);
    if(strlen($text) > 0){
        $link['title'] = $text;
    }
    $results['other_links'][] = $link;
  }
}

// $results['all_meta'] =  get_post_meta(get_the_ID());
// $results = get_post(get_the_ID());

$spectra[] = $results;

endwhile;
