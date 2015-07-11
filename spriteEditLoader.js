/**
 * Add an edit button which loads the sprite editor
 *
 * If spriteaction=edit is in the URL, the editor will be loaded
 * immediately, otherwise it will wait for the button to be clicked.
 * Uses the History API where supported to update the URL, otherwise
 * the URL isn't updated.
 */
if ( $( '#spritedoc' ).length ) {
	mw.loader.using( 'mediawiki.util', function() {
		var $spriteEditTab = $( '#ca-edit' ).clone().attr( 'id', 'ca-spriteedit' )
		var $spriteEditLink = $spriteEditTab.find( 'a' );
		$spriteEditLink.text( 'Edit sprite' ).attr( 'href', mw.util.getUrl( null, { spriteaction: 'edit' } ) )
		$spriteEditTab.insertAfter( '#ca-edit' );

		var loadSpriteEditor = function() {
			$spriteEditTab.add( '#ca-view' ).toggleClass( 'selected' );
			
			importScript( 'MediaWiki:SpriteEdit.js' );
			importStylesheet( 'MediaWiki:SpriteEdit.css' );
		};
		if ( location.search.match( 'spriteaction=edit' ) ) {
			loadSpriteEditor();
		} else {
			var $win = $( window );
			$spriteEditLink.one( 'click', function( e ) {
				if ( window.history && history.pushState ) {
					// Initially add the history so it is not delayed waiting
					// for the editor to load. The editor will handle it from now.
					history.pushState( {}, '', this.href );
				}
				
				loadSpriteEditor();
				$win.off( '.spriteEditLoader' );
				
				e.preventDefault();
			} );
			
			if ( window.history && history.pushState ) {
				// If the page is reloaded while the editor isn't loaded, navigating
				// back to the editor won't work, so an initial navigation check is
				// necessary to load the editor, where it will then monitor navigation
				$win.on( 'popstate.spriteEditLoader', function() {
					if (
						location.search.match( 'spriteaction=edit' ) &&
						!$( 'html' ).hasClass( 'spriteedit-loaded' )
					) {
						loadSpriteEditor();
						$win.off( '.spriteEditLoader' );
					}
				} );
			}
		}
	} );
}
