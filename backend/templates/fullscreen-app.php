<?php
/**
 * Template Name: GDS Finance Fullscreen
 */
defined('ABSPATH') || exit;

if (!is_user_logged_in()) { auth_redirect(); exit; }
?>
<!DOCTYPE html>
<html <?php language_attributes(); ?>>
<head>
    <meta charset="<?php bloginfo('charset'); ?>">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <?php wp_head(); ?>
    <style>
        html, body { margin:0; padding:0; height:100%; overflow:hidden; }
        #wpadminbar { display:none !important; }
        html { margin-top:0 !important; }
        #gdsfin-root { height:100vh; }
    </style>
</head>
<body>
    <div id="gdsfin-root"></div>
    <?php wp_footer(); ?>
</body>
</html>
