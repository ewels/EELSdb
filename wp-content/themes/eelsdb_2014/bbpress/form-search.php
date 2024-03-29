<?php

/**
 * Search
 *
 * @package bbPress
 * @subpackage Theme
 */

?>

<form role="search" method="get" id="bbp-search-form" action="<?php bbp_search_url(); ?>" class="form-inline" style="margin-bottom:10px;">
  <div class="form-group form-group-sm">
    <label class="screen-reader-text hidden" for="bbp_search"><?php _e( 'Search for:', 'bbpress' ); ?></label>
    <input type="hidden" name="action" value="bbp-search-request" />
    <input tabindex="<?php bbp_tab_index(); ?>" type="text" class="form-control" value="<?php echo esc_attr( bbp_get_search_terms() ); ?>" name="bbp_search" id="bbp_search" />
  </div>
  <input tabindex="<?php bbp_tab_index(); ?>" class="btn btn-default btn-sm" type="submit" id="bbp_search_submit" value="<?php esc_attr_e( 'Search', 'bbpress' ); ?>" />
</form>
