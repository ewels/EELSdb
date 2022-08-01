<?php
/**
 * The template for displaying Comments.
 *
 * The area of the page that contains both current comments
 * and the comment form. The actual display of comments is
 * handled by a callback to bootstrapwp_comment() which is
 * located in the functions.php file.
 *
 * @package WordPress
 * @subpackage BootstrapWP
 */
/* Stolen from https://github.com/rachelbaker/bootstrapwp-Twitter-Bootstrap-for-WordPress
with additional modifications */

function bootstrapwp_comment($comment, $args, $depth) {
	$GLOBALS['comment'] = $comment;
	switch ($comment->comment_type) :
		case 'pingback' :
		case 'trackback' : ?>
			<li class="comment media" id="comment-<?php comment_ID(); ?>">
				<div class="media-body">
					<p>
						<?php _e('Pingback:', 'bootstrapwp'); ?> <?php comment_author_link(); ?>
					</p>
				</div>
			<?php
			break;
		default :
			// Proceed with normal comments.
			global $post;
			$is_author = false;
			if($comment->user_id == $post->post_author){
				$is_author = true;
			}
			?>
			<li class="comment media <?php if($is_author){ echo 'is-author'; } ?>" id="li-comment-<?php comment_ID(); ?>">
					<a href="<?php bbp_user_profile_url($comment->user_id); ?>" class="pull-left">
						<?php echo get_avatar($comment, 64); ?>
					</a>
					<div class="media-body">
						<h4 class="media-heading comment-author vcard">
							<?php
							$author = get_userdata($comment->user_id);
							echo '<a href="'.bbp_get_user_profile_url($comment->user_id).'">'.$author->display_name.'</a>';
							if($is_author){
								echo ' <span class="comment-author-label label label-success pull-right">Spectrum author</span>';
							};
							echo '<span class="comment-date pull-right">'.get_comment_time().', '.get_comment_date().'</span>';
							?>
						</h4>

						<?php if ('0' == $comment->comment_approved){ 
							echo '<p class="comment-awaiting-moderation">Your comment is awaiting moderation.</p>';
						}
						
						echo '<p class="comment-text">'.get_comment_text().'</p>';
                        
						echo '<p class="reply">';
                        // Delete comment if we're the author
                        $seconds_since_posted = current_time('timestamp') - get_comment_time('U');
                        $comment_delete_limit = 60*10; // ten minutes to delete
                        if ( current_user_can('edit_post', $comment->comment_post_ID) ) {
                            if( current_user_can('edit_posts') || $seconds_since_posted < $comment_delete_limit){
                                $url = clean_url(wp_nonce_url( "/wp-admin/comment.php?action=deletecomment&p=$comment->comment_post_ID&c=$comment->comment_ID", "delete-comment_$comment->comment_ID" ));
                                echo '<a href="'.$url.'">Delete Comment</a> &nbsp | &nbsp; ';
                            }
                        }
                        // Reply to comment
						comment_reply_link( array_merge($args, array(
							'reply_text' => 'Reply &raquo;',
							'depth'	  => $depth,
							'max_depth'  => $args['max_depth']
						)));
                        echo '</p>';
                        ?>
					</div>
			<?php
			break;
	endswitch;
}


// Return early no password has been entered for protected posts.
if (post_password_required()) {
	return;
} ?>
<div id="comments" class="comments-area">
	<?php if (have_comments()) : ?>

		<ul class="media-list">
			<?php wp_list_comments(array('callback' => 'bootstrapwp_comment')); ?>
		</ul><!-- /.commentlist -->

		<?php if (get_comment_pages_count() > 1 && get_option('page_comments')) : ?>
			<nav id="comment-nav-below" class="navigation" role="navigation">
				<div class="nav-previous">
					<?php previous_comments_link( _e('&larr; Older Comments', 'bootstrapwp')); ?>
				</div>
				<div class="nav-next">
					<?php next_comments_link(_e('Newer Comments &rarr;', 'bootstrapwp')); ?>
				</div>
			</nav>
		<?php endif; // check for comment navigation ?>

		<?php elseif (!comments_open() && '0' != get_comments_number() && post_type_supports(get_post_type(), 'comments')) : ?>
			<p class="nocomments"><?php _e('Comments are closed.', 'bootstrapwp'); ?></p>
	<?php endif; ?>

	<?php comment_form(); ?>
</div><!-- #comments .comments-area -->


