<?php
/*
Theme my login profile page - redirect to the bbpress edit profile page
*/

$current_user = wp_get_current_user();
$url = home_url('/forum/users/'.$current_user->user_login.'/edit/');

?>

<script>window.location = '<?php echo $url; ?>';</script>
