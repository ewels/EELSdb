<?php
/////////////////////////////////////////////////////
// BROWSE SPECTRA - Archive Setup
// This stuff needs to be called before the template is loaded
/////////////////////////////////////////////////////

// Queue up the browse spectra template if there isn't a file in the theme
// folder called 'archive-spectra.php'
add_filter('archive_template', 'eelsdb_archive_template');
function eelsdb_archive_template ($template) {
  if (is_post_type_archive('spectra') &&
  (!$template || basename($template) != 'archive-spectra.php')) {
    $template = dirname(__FILE__) . '/spectra_browse_template.php';
  }
  return $template;
}

// Change the number of posts per page for specta archive
// Add in any filtering that we need to do
function eelsdb_archive_meta_query ( $query ) {

    global $is_api;
    global $meta_keys;
    global $numeric_meta_keys;

    $filter_types = array(
      'spectrumType' => 'str',
      'spectrumText' => 'str',
      'spectrumAuthor' => 'str',
      'spectrumEdgeType' => 'str',
      'spectrumEnergyMin' => 'num',
      'spectrumEnergyMinOp' => 'str',
      'spectrumEnergyMax' => 'num',
      'spectrumEnergyMaxOp' => 'str',
      'resolutionOp' => 'str',
      'resolution' => 'num',
      'monochromatedFilter' => 'check',
      'spectrumFormula' => 'str',
      'spectrumElements' => 'str'
    );

  // Check that we're actually browsing the spectra
  if( $query->is_main_query() && is_post_type_archive( 'spectra' ) && !is_admin() ) {

    // Front end only
    if(!$is_api){


        // Are we clearing the filters?
        if(isset($_REQUEST['clear_filters']) && $_REQUEST['clear_filters'] == 'all'){
          if(is_user_logged_in()){
            delete_user_meta(get_current_user_id(),'eelsdb_filters');
          } else {
            session_id() || session_start();
            $_SESSION['eelsdb_filters'] = array();
          }
          // Save the posts per page
          $filters = array();
        }

        // Are we setting the filters?
        else if(isset($_POST['set_filters'])){
          foreach($filter_types as $ft => $type){
            if(isset($_POST[$ft]) && $type == 'str'){
              $filters[$ft] = $_POST[$ft];
            } else if(isset($_POST[$ft]) && $type == 'num' && is_numeric($_POST[$ft])){
              $filters[$ft] = $_POST[$ft];
            } else if($type == 'check'){
              if(isset($_POST[$ft])){
                $filters[$ft] = 1;
              } else {
                $filters[$ft] = 0;
              }
            }
          }
        }
        // Not setting - pull them from last time
        else {
          if(is_user_logged_in()){
            $filters = get_user_meta(get_current_user_id(), 'eelsdb_filters')[0];
          } else {
            session_id() || session_start();
            $filters = $_SESSION['eelsdb_filters'];
          }
        }

        // Clearing a single filter element
        if(isset($_REQUEST['clear_filters']) && $_REQUEST['clear_filters'] == 'spectrumElements'){
          $key = array_search($_REQUEST['spectrumElement'], $filters['spectrumElements']);
          if($key !== false) {
            unset($filters['spectrumElements'][$key]);
          }
        }
        // Clearing a single filter
        else if(isset($_REQUEST['clear_filters']) && array_key_exists($_REQUEST['clear_filters'], $filters)){
          unset($filters[$_REQUEST['clear_filters']]);
        }
    }

    // API - map GET requests to filters array
    else {
        $api_commands = array(
          'spectrumType' => 'type',
          'spectrumText' => 'title',
          'spectrumAuthor' => 'author',
          'spectrumEdgeType' => 'edge',
          // elements dealt with separately below
          'spectrumFormula' => 'formula',
          'spectrumEnergyMin' => 'min_energy',
          'spectrumEnergyMinOp' => 'min_energy_compare',
          'spectrumEnergyMax' => 'max_energy',
          'spectrumEnergyMaxOp' => 'max_energy_compare',
          'resolution' => 'resolution',
          'resolutionOp' => 'resolution_compare',
          'monochromatedFilter' => 'monochromated'
        );
        $api_pagination = array(
          'spectraPostsPerPage' => 'per_page',
          'spectraPage' => 'page',
          'spectraSortBy' => 'order',
          'spectraSortByOrder' => 'order_direction',
        );

        // Save filters into $filters
        $filters = array();
        foreach($api_commands as $fkey => $akey){
            if(isset($_GET[$akey]) && strlen($_GET[$akey]) > 0){
                $filters[$fkey] = $_GET[$akey];
            }
        }

        // Save pagination variables into $REQUEST
        foreach($api_pagination as $fkey => $akey){
            if(isset($_GET[$akey]) && strlen($_GET[$akey]) > 0){
                $_REQUEST[$fkey] = $_GET[$akey];
            }
        }

        if(isset($_GET['element']) && is_string($_GET['element']) && strlen($_GET['element']) > 0){
            $filters['spectrumElements'] = array($_GET['element']);
        } else if(isset($_GET['element']) && is_array($_GET['element'])){
            foreach($_GET['element'] as $el){
                if(is_string($el) && strlen($el) > 0){
                    $filters['spectrumElements'][] = $el;
                }
            }
        }
    }



    //
    // Posts per page
    //
    if(isset($_REQUEST['spectraPostsPerPage']) && is_numeric($_REQUEST['spectraPostsPerPage'])){
      if(is_user_logged_in()){
        update_user_meta(get_current_user_id(), 'eelsdb_posts_per_page', $_REQUEST['spectraPostsPerPage']);
      } else {
        session_id() || session_start();
        $_SESSION['eelsdb_posts_per_page'] = $_REQUEST['spectraPostsPerPage'];
      }
      $query->set( 'posts_per_page', $_REQUEST['spectraPostsPerPage']);
    } else {
      if(is_user_logged_in()){
        $pppage = get_user_meta(get_current_user_id(), 'eelsdb_posts_per_page')[0];
      } else {
        session_id() || session_start();
        $pppage = $_SESSION['eelsdb_posts_per_page'];
      }
      if(!is_numeric($pppage)){
        $pppage = 50;
      }
      $query->set( 'posts_per_page', $pppage );
    }
    // Page
    if(isset($_REQUEST['spectraPage']) && is_numeric($_REQUEST['spectraPage'])){
      $query->set( 'paged', $_REQUEST['spectraPage'] );
    }

    //
    // Sort Query
    //
    $spectraSort_orderby = 'meta_value';
    if(isset($_REQUEST['spectraSortBy'])){
      $spectraSort_meta_key = $_REQUEST['spectraSortBy'];
    }
    if(isset($_REQUEST['spectraSortByOrder'])){
      $spectraSort_order = $_REQUEST['spectraSortByOrder'];
    }
    if(in_array($spectraSort_meta_key, $meta_keys)){
      $spectraSort_meta_key = $spectraSort_meta_key;
      $query->set('meta_key', $spectraSort_meta_key);
      if(in_array($spectraSort_meta_key, $numeric_meta_keys)){
        $query->set('orderby', 'meta_value_num');
      } else {
        $query->set('orderby', 'meta_value');
      }
    } else if(in_array($spectraSort_meta_key, ['title', 'author', 'date'])){
      $query->set('orderby', $spectraSort_meta_key);
    } else {
      $query->set('meta_key', 'spectrumFormula');
      $query->set('orderby', 'meta_value');
    }
    if(in_array($spectraSort_order, ['ASC', 'DESC'])){
      $query->set('order', $spectraSort_order);
    } else {
      $query->set('order', 'ASC');
    }


    $meta_query = array();

    //
    // Spectrum Title - query search
    //
    if(isset($filters['spectrumText'])){
      $query->set( 's', $filters['spectrumText']);
    }

    //
    // Spectrum Author - query author
    //
    add_filter('user_search_columns', 'eelsdb_user_search_columns' , 10, 3);
    function eelsdb_user_search_columns($search_columns, $search, $query){
      if(!in_array('display_name', $search_columns)){
        $search_columns[] = 'display_name';
      }
      return $search_columns;
    }
    if(isset($filters['spectrumAuthor'])){
      // Find our author user IDs
      $author_ids = array();
      foreach(explode(',', $filters['spectrumAuthor']) as $search_string){
        $search_string = esc_attr( trim( $search_string ) );
        $users = new WP_User_Query( array(
          'search'         => "*{$search_string}*",
          'search_columns' => array(
            'user_login',
            'user_nicename',
            'user_email',
            'user_url',
          ),
          'meta_query' => array(
            'relation' => 'OR',
            array(
              'key'     => 'first_name',
              'value'   => $search_string,
              'compare' => 'LIKE'
            ),
            array(
              'key'     => 'last_name',
              'value'   => $search_string,
              'compare' => 'LIKE'
            )
          )
        ) );
        $this_search = $users->get_results();
        foreach($this_search as $u){
          $author_ids[] = $u->data->ID;
        }
      }
      if(count($author_ids) > 0){
        $query->set( 'author__in', $author_ids);
      } else {
        $filters['spectrumAuthor'] = '';
      }
    }

    //
    // Posts meta query filters
    //

    // Spectrum Types
    if(isset($filters['spectrumType']) && strlen($filters['spectrumType']) > 0){
      $meta_query[] = array(
        'key' => 'spectrumType',
        'value' => $filters['spectrumType'],
        'compare' => '='
      );
    }

    // Edge Types
    if(isset($filters['spectrumEdgeType']) && strlen($filters['spectrumEdgeType']) > 0){
      $meta_query[] = array(
        'key' => 'spectrumEdges',
        'value' => $filters['spectrumEdgeType'],
        'compare' => 'LIKE'
      );
    }

    // Min and Max Energies
    if(isset($filters['spectrumEnergyMin']) && strlen($filters['spectrumEnergyMin']) > 0){
      if(isset($filters['spectrumEnergyMinOp'])){
        if($filters['spectrumEnergyMinOp'] == 'gt'){ $minEnergyOp = '>='; }
        else if($filters['spectrumEnergyMinOp'] == 'eq'){ $minEnergyOp = '='; }
        else { $minEnergyOp = '<='; }
      } else {
        $minEnergyOp = '<=';
      }
      $meta_query[] = array(
        'key' => 'spectrumMin',
        'value' => $filters['spectrumEnergyMin'],
        'type' => 'decimal',
        'compare' => $minEnergyOp
      );
    }
    if(isset($filters['spectrumEnergyMax']) && strlen($filters['spectrumEnergyMax']) > 0){
      if(isset($filters['spectrumEnergyMaxOp'])){
        if($filters['spectrumEnergyMaxOp'] == 'gt'){ $maxEnergyOp = '>='; }
        else if($filters['spectrumEnergyMaxOp'] == 'eq'){ $maxEnergyOp = '='; }
        else { $maxEnergyOp = '<='; }
      } else {
        $maxEnergyOp = '<=';
      }
      $meta_query[] = array(
        'key' => 'spectrumMax',
        'value' => floatval($filters['spectrumEnergyMax']),
        'type' => 'decimal',
        'compare' => $maxEnergyOp
      );
    }

    // Energy Resolution
    //TODO - This doesn't seem to work properly yet...?
    if(isset($filters['resolution']) && strlen($filters['resolution']) > 0){
      if(isset($filters['resolutionOp'])){
        if($filters['resolutionOp'] == 'gt'){ $resOp = '>='; }
        else if($filters['resolutionOp'] == 'eq'){ $resOp = '='; }
        else { $resOp = '<='; }
      } else {
        $resOp = '<=';
      }
      $meta_query[] = array(
        'key' => 'resolution',
        'value' => floatval($filters['resolution']),
        'type' => 'numeric',
        'compare' => $resOp
      );
    }

    // Monochromated spectra only
    if(isset($filters['monochromatedFilter']) && $filters['monochromatedFilter'] == 1){
      $meta_query[] = array(
        'key' => 'monochromated',
        'value' => 1,
        'compare' => '='
      );
    }

    // Formula Text Search
    if(isset($filters['spectrumFormula']) && strlen($filters['spectrumFormula']) > 0){
      $meta_query[] = array(
        'key' => 'spectrumFormula',
        'value' => $filters['spectrumFormula'],
        'compare' => 'LIKE'
      );
    }

    // Formula Elements
    if(isset($filters['spectrumElements'])){
      foreach($filters['spectrumElements'] as $el){
        $meta_query[] = array(
          'key' => 'spectrumElement',
          'value' => $el,
          'compare' => '='
        );
      }
    }
    if(count($meta_query) > 0){
      $query->set('meta_query', $meta_query);
    }

    // Save these for next time
    if(!$is_api){
        if(isset($filters['spectrumText'])){
            unset($filters['spectrumText']); // don't save the search term
        }
        if(is_user_logged_in()){
          update_user_meta(get_current_user_id(), 'eelsdb_filters', $filters);
        } else {
          session_id() || session_start();
          $_SESSION['eelsdb_filters'] = $filters;
        }
    }
  }
}
add_action( 'pre_get_posts', 'eelsdb_archive_meta_query', 1 );
