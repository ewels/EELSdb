<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="utf-8">
	<meta http-equiv="X-UA-Compatible" content="IE=edge">
	<meta name="viewport" content="width=device-width, initial-scale=1">
	<link rel="pingback" href="<?php bloginfo( 'pingback_url' ); ?>" />

	<title><?php bloginfo( 'name' ); wp_title(); ?></title>
	<meta name="description" content="<?php bloginfo('description'); ?>" />
	<meta name="keywords" content="EELS DB, EELSDB, EELS, Electron energy loss spectroscopy, spectra, spectroscopy" />
	<meta name="copyright" content="All site content copyright <?php bloginfo( 'name' ); ?>, <?php echo date('Y'); ?>" />
	<meta name="robots" content="ALL,INDEX,FOLLOW,ARCHIVE" />
	<meta name="revisit-after" content="7 days" />

	<meta name="msapplication-TileColor" content="#da532c">
	<meta name="theme-color" content="#ffffff">

	<!-- Google Fonts -->
	<link href='https://fonts.googleapis.com/css?family=Roboto:400,700,400italic,300' rel='stylesheet' type='text/css'>

	<!-- HTML5 shim and Respond.js IE8 support of HTML5 elements and media queries -->
	<!--[if lt IE 9]>
	  <script src="https://oss.maxcdn.com/libs/html5shiv/3.7.0/html5shiv.js"></script>
	  <script src="https://oss.maxcdn.com/libs/respond.js/1.4.2/respond.min.js"></script>
	<![endif]-->

	<?php wp_head(); ?>
</head>

<body <?php body_class('eelsdb'); ?>>

	<!-- Top fixed navbar -->
	<div class="navbar navbar-default navbar-static-top" role="navigation">
		<div class="container">
			<div class="navbar-header">
				<button type="button" class="navbar-toggle" data-toggle="collapse" data-target=".navbar-collapse">
					<span class="sr-only">Toggle navigation</span>
					<span class="icon-bar"></span>
					<span class="icon-bar"></span>
					<span class="icon-bar"></span>
				</button>
				<a class="navbar-brand hidden-sm" href="<?php echo home_url( '/' ); ?>"><?php bloginfo( 'name' ); ?></a>
			</div>
			<div class="navbar-collapse collapse">
				<?php
				wp_nav_menu( array(
					'theme_location' => 'main-nav',
					'container' => false,
					'items_wrap' => '<ul class="nav navbar-nav">%3$s</ul>',
					'menu_class' => 'nav pull-right',
					'depth' => 1,
					'fallback_cb' => false ) );
				?>
				<div class="hidden-sm hidden-md">
					<?php
					wp_nav_menu( array(
						'theme_location' => 'secondary-nav',
						'container' => false,
						'items_wrap' => '<ul class="nav navbar-nav navbar-right">%3$s</ul>',
						'menu_class' => 'nav pull-right',
						'depth' => 1,
						'fallback_cb' => false ) );
					?>
				</div>
			</div><!--/.nav-collapse -->
		</div><!--/.container-fluid -->
	</div>

	<div class="navbar navbar-default navbar-static-top navbar-secondary-navbar visible-sm visible-md" role="navigation">
		<div class="container">
			<?php
			wp_nav_menu( array(
				'theme_location' => 'secondary-nav',
				'container' => false,
				'items_wrap' => '<ul class="nav navbar-nav navbar-right">%3$s</ul>',
				'menu_class' => 'nav pull-right',
				'depth' => 1,
				'fallback_cb' => false ) );
			?>
		</div>
	</div>

	<div class="container mainpage">
		<?php
		/* Do an annoying message if user hasn't yet filled in their profile */
		if ( is_user_logged_in() ) {
			$current_user = wp_get_current_user();
			if (!isset($current_user->user_lastname) or strlen($current_user->user_lastname) == 0){
				$lab = '';
				$udata = get_userdata($current_user->id);
				if(!isset($udata->u_lab) or strlen($udata->u_lab) == 0){
					$lab = ' or what lab you work in';
				}
				echo '<div class="alert alert-warning" role="alert">
					<p><strong>Hi there '.$current_user->user_login.'!</strong> This is embarassing, I don\'t know your name'.$lab.'.. It would be great if you could <a href="'.bbp_get_user_profile_edit_url(bbp_get_current_user_id()).'">fill out your profile</a>!</p>
				</div>';
			}
		}
		
		/* Do an annoying message if there are spectra to review */
		if(current_user_can('edit_others_posts') && !isset($_GET['approve'])){
			$count_posts = wp_count_posts('spectra');
			if($count_posts->pending > 0){
				// Get links to drafts
				$draft_links = [];
				$drafts = new WP_Query('post_type=spectra&post_status=pending');
				while ( $drafts->have_posts() ) {
					$drafts->the_post();
					$draft_links[] = '<a href="'.get_the_permalink().'">' . get_the_title() . '</a>';
				}
				wp_reset_postdata();
				// print alert
				echo '<div class="alert alert-warning" role="alert">
					<p><strong>There '.($count_posts->pending > 1 ? 'are '.$count_posts->pending.' spectra' : ' is a spectrum').' waiting to be reviewed:</strong> '.implode(', ', $draft_links).'</p>
				</div>';
			}
		}
		?>
