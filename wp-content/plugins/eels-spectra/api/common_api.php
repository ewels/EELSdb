<?php
/*
* Code to provide a REST API to interact with the EELS Database
*/

//
// First - find out if we're using the api.eelsdb.eu subdomain
//
$is_api = false;
$url_parts = explode('.', $_SERVER['HTTP_HOST']);
if($url_parts[0] == 'api' || ($url_parts[0] == 'www' && $url_parts[1] == 'api')){
  add_action( 'template_redirect', 'eelsdb_api' );
  $is_api = true;
}
$api_routes = array(
    'api_home' => array('url' => 'https://api.eelsdb.eu'),
    'api_documentation' => array('url' => 'https://eelsdb.eu/api/'),
    'browse_news' => array('url' => 'https://api.eelsdb.eu/news/'),
    'news' => array('url' => 'https://api.eelsdb.eu/{post_slug}/'),
    'list_users' => array('url' => 'https://api.eelsdb.eu/registered-users/'),
    'user' => array('url' => 'https://api.eelsdb.eu/author/{user}/'),
    'browse_spectra' => array(
      'url'=>'https://api.eelsdb.eu/spectra/',
      'arguments' => array(
        'type' => '[ coreloss | lowloss | zeroloss | xrayabs ]',
        'title' => 'string',
        'author' => 'string',
        'element' => 'string',
        'formula' => 'string',
        'edge' => array(
          'K',
          'L1',
          'L2,3',
          'M2,3',
          'M4,5',
          'N2,3',
          'N4,5',
          'O2,3',
          'O4,5',
        ),
        'min_energy' => 'float',
        'min_energy_compare' => array(
          'lt',
          'eq',
          'ge',
        ),
        'max_energy' => 'float',
        'max_energy_compare' => array(
          'lt',
          'eq',
          'ge',
        ),
        'resolution' => 'float',
        'resolution_compare' => array(
          'lt',
          'eq',
          'ge',
        ),
        'monochromated' => 'flag',
        'per_page' => 'int',
        'page' => 'int',
        'order' => $meta_keys,
        'order_direction' => array('ASC', 'DESC')
      ),
    ),
    'spectrum' => array('url'=>'https://api.eelsdb.eu/spectra/{spectrum}')
);

function eelsdb_api(){

  // Modify the headers to say that we're sending JSON
  header('Content-Type: application/json; charset=utf-8');
  
  // Log server-side Google Analytics tracking
  // https://github.com/dancameron/server-side-google-analytics
  require_once('ss-ga.class.php');
  ssga_track( 'UA-54316477-1', 'api.eelsdb.eu', 'api'.$_SERVER['REQUEST_URI']);

  // Website homepage - print available paths
  if(is_front_page()){
    // Return a 200 a-ok header
    header('Status: 200 OK');

    // Print the spectra
    global $api_routes;
    print json_encode($api_routes, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES);
    exit;
  }
  
  // News
  if(is_home() || is_singular('post')){
    // Return a 200 a-ok header
    header('Status: 200 OK');
    
    // Get the news
    require_once('api_news.php');
    
    // Flatten if singular
    if(is_singular('post')){ $news = $news[0]; }

    // Print the news
    print json_encode($news, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES);
    exit;
  }
  

  // EELS Spectra
  else if(is_post_type_archive('spectra') || is_singular('spectra')){

      // Check GET arguments
      if(is_post_type_archive('spectra')){
        global $api_routes;
        foreach($_GET as $q => $v){
          if(!array_key_exists($q, $api_routes['browse_spectra']['arguments'])){
            // Print error and exit
            header('Status: 400 Bad Request');
            print json_encode(array(
                'message' => "Query argument '$q' not recognised",
                'documentation_url' => 'https://eelsdb.eu/api/'
            ), JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES);
            exit;
          }
        }
      }
      
      // Return a 200 a-ok header
      header('Status: 200 OK');

      // Get the spectrum data
      require_once('api_spectra.php');
      
      // Flatten if singular
      if(is_singular('spectra')){ $spectra = $spectra[0]; }

      // Print the spectra
      print json_encode($spectra, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES);
      exit;
  }
  
  // List users
  else if(is_page('registered-users') || is_author()){
    
    // Return a 200 a-ok header
    header('Status: 200 OK');

    // Get the spectrum data
    require_once('api_users.php');
    
    // Flatten if singular
    if(is_author()){ $users = $users[0]; }

    // Print the spectra
    print json_encode($users, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES);
    exit;
  }

  // Unrecognised - throw error
  else {

    // Return a 404 header
    header('Status: 404 Not Found');

    // Print error and exit
    print json_encode(array(
        'message' => 'API path not recognised',
        'documentation_url' => 'https://eelsdb.eu/api/'
    ), JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES);
    ssga_track( 'UA-54316477-1', 'api.eelsdb.eu', '/404' );
    exit;

  }

}; // API function
