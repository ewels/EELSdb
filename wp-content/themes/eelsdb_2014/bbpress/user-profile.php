<?php

/**
 * User Profile
 *
 * @package bbPress
 * @subpackage Theme
 */

$user = get_userdata( bbp_get_displayed_user_id() );

?>
	<fieldset>
		<legend>User Profile</legend>
	
		<address>
			<?php if($user->first_name || $user->last_name) echo '<strong>'.$user->first_name . ' ' . $user->last_name.'</strong><br>'; ?>
			<?php echo '<a href="mailto:'.$user->user_email.'">'.$user->user_email.'</a>'; ?><br>
			<?php if($user->user_url) echo '<a href="'.$user->user_url.'" target="_blank">'.$user->user_url.'</a>'; ?><br>
			<?php if($user->phone) echo '<abbr title="Personal Phone Number">Phone:</abbr> '.$user->phone; ?>
		</address>
	
		<address>
			<?php if($user->u_lab) echo '<strong>'.$user->u_lab.'</strong><br>'; ?>
			<?php if($user->u_address) echo $user->u_address.'<br>'; ?>
			<?php if($user->u_city) echo $user->u_city.'<br>'; ?>
			<?php if($user->u_zip) echo $user->u_zip.', '; ?>
			<?php if($user->u_country) echo $user->u_country.'<br>'; ?>
			<?php if($user->u_phone) { ?><abbr title="Lab Phone Number">Phone:</abbr> <?php echo $user->u_phone; ?><br><?php } ?>
			<?php if($user->u_fax) { ?><abbr title="Lab Facsimile Number">Fax:</abbr> <?php echo $user->u_fax; ?><?php } ?>
		</address>
	
		<?php if ( bbp_get_displayed_user_field( 'description' ) ) : ?>
			<p><strong>Biographical Info</strong><br>
			<?php bbp_displayed_user_field( 'description' ); ?></p>
		<?php endif; ?>
		
		<?php if($user->skype || $user->twitter || $user->linkedin || $user->academia_edu || $user->researchgate || $user->orcid || $user->researcherid || $user->facebook || $user->gplus ): ?>
		<p id="profile-links"><strong>External Links</strong><br>
			<?php if($user->skype) { ?>			<a class="label label-primary" href="skype:<?php echo $user->skype; ?>" title="Skype username: <?php echo $user->skype; ?>" data-toggle="tooltip" target="_blank">Skype</a><?php } ?>
			<?php if($user->twitter) { ?>		<a class="label label-primary" href="http://www.twitter.com/<?php echo $user->twitter; ?>" title="Twitter username: <?php echo $user->twitter; ?>" target="_blank">Twitter</a><?php } ?>
			<?php if($user->linkedin) { ?>		<a class="label label-primary" href="<?php echo esc_url($user->linkedin); ?>" target="_blank">LinkedIn</a><?php } ?>
			<?php if($user->academia_edu) { ?>	<a class="label label-primary" href="<?php echo esc_url($user->academia_edu); ?>" target="_blank">Academia.edu</a><?php } ?>
			<?php if($user->researchgate) { ?>	<a class="label label-primary" href="<?php echo esc_url($user->researchgate); ?>" target="_blank">Research Gate</a><?php } ?>
			<?php if($user->google_scholar) { ?><a class="label label-primary" href="<?php echo esc_url($user->google_scholar); ?>" target="_blank">Google Scholar</a><?php } ?>
			<?php if($user->orcid) { ?>			<a class="label label-primary" href="<?php echo esc_url($user->orcid); ?>" target="_blank">ORCiD</a><?php } ?>
			<?php if($user->researcherid) { ?>	<a class="label label-primary" href="<?php echo esc_url($user->researcherid); ?>" target="_blank">ResearcherID</a><?php } ?>
			<?php if($user->facebook) { ?>		<a class="label label-primary" href="<?php echo esc_url($user->facebook); ?>" target="_blank">Facebook</a><?php } ?>
			<?php if($user->gplus) { ?>			<a class="label label-primary" href="<?php echo esc_url($user->gplus); ?>" target="_blank">Google+</a><?php } ?>
		</p>
		<script>
			jQuery(document).ready(function($){
				$('#profile-links a').tooltip();
			});
		</script>
		<?php endif; ?>
	
	</fieldset>
	
	<p>&nbsp;</p>
	
	<fieldset>
		<legend>Forum Activity</legend>
		
		<?php do_action( 'bbp_template_before_user_profile' ); ?>

		<dl class="dl-horizontal">
			<dt>Forum Role</dt>
			<dd><?php echo bbp_get_user_display_role(); ?>
			
			<dt>Topics Started</dt>
			<dd><?php echo bbp_get_user_topic_count_raw(); ?>
			
			<dt>Replies Created</dt>
			<dd><?php echo bbp_get_user_reply_count_raw(); ?>
		</dl>
		<?php do_action( 'bbp_template_after_user_profile' ); ?>
	
	</fieldset>
