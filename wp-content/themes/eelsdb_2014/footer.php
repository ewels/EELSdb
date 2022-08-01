	<div class="clearfix"></div>
	</div> <!-- /container -->
	
	
	<div class="footer">
		<div class="container">
			<p class="footer-logos">
				<?php
				for ($i = 1; $i <= 8; $i++){
					$src = get_theme_mod('eelsdb_footer_logo_'.$i);
					$link = get_theme_mod('eelsdb_footer_logo_link_'.$i);
					if(!empty($src)){
						if(!empty($link)) echo '<a href="'.$link.'" target="_blank">';
						echo '<img src="'.$src.'" class="footer-logo">';
						if(!empty($link)) echo '</a>';
					}
				}
				?>
			</p>
	  	  	<p><?php echo str_replace('  ',' &nbsp;', get_theme_mod( 'eelsdb_footer_text_setting', '' )); ?></p>
			<p>&nbsp;</p>
			<p><a href="#">Back to top</a></p>
		</div>
	</div>
	<script type="text/javascript">
	jQuery(function ($) {
	  $('[data-toggle="tooltip"]').tooltip()
	});
	</script>
	<?php wp_footer(); ?> 
</body>
</html>
