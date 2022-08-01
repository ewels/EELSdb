<?php
/*
 Code for API to list registered EELS DB users
*/

if(is_author()){
  $users_raw = get_queried_object();
} else {
  $users_raw = get_users(array(
  	'meta_key' => 'first_name',
  	'orderby'  => 'meta_var'
  ));
}

$users = array();
foreach($users_raw as $u){
  // print_r($u);
  if(is_author()){
    $uid = $u->ID;
  } else {
    $uid = $u->data->ID;
  }
  $udata = get_userdata($uid);
  $name = get_the_author_meta('first_name', $uid) . ' ' . get_the_author_meta('last_name', $uid);
  if($name = " "){ $name = get_the_author_meta('display_name', $uid); }
  $thisuser = array(
    'id' => $uid,
    'name' => $name,
    'profile_url' => get_author_posts_url($uid),
    'profile_api_url' => str_replace('www', '', str_replace('://', '://api.', get_author_posts_url($uid))),
    'spectra_api_url' => 'https://api.eelsdb.eu/spectra/?author='.get_the_author_meta('nickname', $uid)
  );
  
  $email = get_the_author_meta('email', $uid);
  $laboratory = $udata->u_lab;
  $city = $udata->u_city;
  $country = $udata->u_country;
  $profile_url = home_url('forum/users/'.get_the_author_meta('user_nicename', $uid).'/');
  $spectra_url = get_author_posts_url($uid);
  $num_spectra = intval(count_user_posts($uid , 'spectra'));
  
  if(trim($email)){           $thisuser['email'] = get_the_author_meta('email', $uid); }
  if(trim($laboratory)){      $thisuser['laboratory'] = $udata->u_lab; }
  if(trim($city)){            $thisuser['city'] = $udata->u_city; }
  if(trim($country)){         $thisuser['country'] = $udata->u_country; }
  if(trim($profile_url)){     $thisuser['profile_url'] = home_url('forum/users/'.get_the_author_meta('user_nicename', $uid).'/'); }
  if(trim($spectra_url)){     $thisuser['spectra_url'] = get_author_posts_url($uid); }
  if(trim($num_spectra)){     $thisuser['num_spectra'] = intval(count_user_posts($uid , 'spectra')); }
  
  if($udata->skype)           $thisuser['skype'] = "skype:".$udata->skype;
  if($udata->twitter)         $thisuser['twitter'] = "http://www.twitter.com/".$udata->twitter;
  if($udata->linkedin)        $thisuser['linkedin'] = esc_url($udata->linkedin);
  if($udata->academia_edu)    $thisuser['academia_edu'] = esc_url($udata->academia_edu);
  if($udata->researchgate)    $thisuser['researchgate'] = esc_url($udata->researchgate);
  if($udata->google_scholar)  $thisuser['google_scholar'] = esc_url($udata->google_scholar);
  if($udata->orcid)           $thisuser['orcid'] = esc_url($udata->orcid);
  if($udata->researcherid)    $thisuser['researcherid'] = esc_url($udata->researcherid);
  if($udata->facebook)        $thisuser['facebook'] = esc_url($udata->facebook);
  if($udata->gplus)           $thisuser['gplus'] = esc_url($udata->gplus);

  $users[] = $thisuser;
}

// $users = $udata;