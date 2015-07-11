( function() {
'use strict';

/** "Global" vars (preserved between editing sessions) **/
var $root = $( document.documentElement );
var $win = $( window );
var $doc = $( '#spritedoc' );
var inlineStyle;
var URL = window.URL || window.webkitURL;
var imageEditingSupported = ( function() {
	if (
		window.FileList &&
		window.ArrayBuffer &&
		window.Blob &&
		window.FormData &&
		window.ProgressEvent &&
		URL && URL.revokeObjectURL && URL.createObjectURL &&
		document.createElement( 'canvas' ).getContext
	) {
		return true;
	}
	
	return false;
}() );
var dropSupported = ( function() {
	// If image editing isn't supported, we don't care about dropping any more
	if ( !imageEditingSupported ) {
		return false;
	}
	
	return 'draggable' in $root[0];
}() );
var historySupported = window.history && history.pushState;
// HTML pointer-events is dumb and can't be tested for
// Just check that we're not IE < 11, old Opera has too little usage to bother checking for
var pointerEventsSupported = $.client.profile().name !== 'msie' || $.client.profile().versionBase > 10;
var idsPageId = $doc.data( 'idspage' );
var revisionsApi = new mw.Api( { parameters: {
	action: 'query',
	prop: 'revisions',
	rvprop: 'content',
	utf8: true
} } );


// Handle recreating the editor
$( '#ca-spriteedit' ).find( 'a' ).click( function( e ) {
	// Editor is already loaded, reload the page
	if ( $root.hasClass( 'spriteedit-loaded' ) ) {
		return;
	}
	create();
	e.preventDefault();
} );
if ( historySupported ) {
	$win.on( 'popstate', function() {
		if (
			location.search.match( 'spriteaction=edit' ) &&
			!$root.hasClass( 'spriteedit-loaded' )
		) {
			create( 'history' );
		}
	} );
}


/** Functions **/
/**
 * Entry point for the editor
 *
 * Updates the page if it has been edited since being viewed
 * and creates the editor once ready
 * Is called right at the end of the script, once all other functions
 * are defined.
 *
 * "state" is what triggered the creation (e.g. from history navigation)
 */
var create = function( state ) {
	var modified = {};
	var settings = {};
	var mouse = {
		moved: false,
		x: 0, y: 0
	};
	var sorting = false;
	var oldHtml;
	var spritesheet;
	var changes = [];
	var undoneChanges = [];
	var names = {};
	var loadingImages = [];
	var idsTable, idChanges, sheetData;
	var panels = {};
	var $headingTemplate = $( '<h3>' ).html(
		$( '<span>' )
			.addClass( 'mw-headline spriteedit-new' )
			.attr( 'data-placeholder', 'Type a section name' )
	);
	var $boxTemplate = $( '<li>' ).addClass( 'spritedoc-box spriteedit-new' ).append(
		$( '<div>' ).addClass( 'spritedoc-image' ),
		$( '<ul>' ).addClass( 'spritedoc-names' ).append(
			$( '<li>' ).addClass( 'spritedoc-name' ).html( '<code>' )
		)
	);
	addControls( $headingTemplate, 'heading' );
	addControls( $boxTemplate, 'box' );
	
	$root.addClass( 'spriteedit-loaded' );
	// TODO: Change to "mediawiki.ui.input" on MW1.25 update
	mw.loader.load( 'mediawiki.ui' );
	
	if ( !state && historySupported ) {
		history.pushState( {}, '', mw.util.getUrl( null, { spriteaction: 'edit' } ) );
	}
	if ( state !== 'initial' ) {
		$( '#ca-view' ).add( '#ca-spriteedit' ).toggleClass( 'selected' );
	}
	
	var $sprite = $doc.find( '.sprite' ).first();
	settings.imageWidth = $sprite.width();
	settings.imageHeight = $sprite.height();
	settings.sheet = $doc.data( 'original-url' );
	if ( !settings.sheet ) {
		settings.sheet = $sprite.css( 'background-image' )
			.replace( /^url\(["']?/, '' ).replace( /["']?\)$/, '' );
		$doc.data( 'original-url', settings.sheet );
	}
	settings.sheet += ( settings.sheet.match( /\?/ ) ? '&' : '?' ) + new Date().getTime();
	
	var spritesheetReady = $.Deferred();
	
	spritesheet = new Image();
	spritesheet.onload = function() {
		settings.sheetWidth = this.width;
		settings.sheetHeight = this.height;
		
		// Replace the spritesheet with a fresh uncached one to ensure
		// we don't save over it with an old version
		if ( inlineStyle ) {
			inlineStyle.disabled = true;
		}
		inlineStyle = mw.util.addCSS(
			'#spritedoc .sprite { background-image: url(' + this.src + ') !important }'
		);
		spritesheetReady.resolve();
	};
	spritesheet.src = settings.sheet;
	
	revisionsApi.get( {
		rvprop: 'timestamp',
		pageids: idsPageId
	} ).done( function( data ) {
		var currentTimestamp = fixTimestamp( data.query.pages[idsPageId].revisions[0].timestamp );
		var newContentReady;
		if ( currentTimestamp > $doc.data( 'idstimestamp' ) ) {
			$doc.data( 'idstimestamp', currentTimestamp );
			
			newContentReady = new mw.Api().get( {
				action: 'parse',
				title: mw.config.get( 'wgPageName' ),
				text: $( '<i>' ).html(
					$.parseHTML( $doc.attr( 'data-refreshtext' ) )
				).html(),
				prop: 'text',
				disablepp: true,
				disabletoc: true
			} ).done( function( data ) {
				oldHtml = data.parse.text['*'];
				$doc.html( oldHtml );
			} );
		} else {
			oldHtml = $doc.html();
		}
		
		$.when( spritesheetReady, newContentReady ).done( function() {
			// Make sure the editor wasn't destroyed while we were waiting
			if ( $root.hasClass( 'spriteedit-loaded' ) ) {
				enable();
			}
		} );
	} ).fail( function( code, data ) {
		console.error( code, data );
	} );
	
	// Handle closing the editor on navigation
	if ( historySupported ) {
		$win.on( 'popstate.spriteEdit', function() {
			if (
				!location.search.match( 'spriteaction=edit' ) &&
				$root.hasClass( 'spriteedit-loaded' )
			) {
				close( 'history' );
			}
		} );
	}
	
	
	/**
	 * Create the editor interface
	 *
	 * Makes the necessary HTML changes to the documentation,
	 * creates the extra interface elements, and binds the events.
	 */
	var enable = function() {
		var $content = $doc.closest( '.documentation' );
		var $toolbar;
		
		if ( !$content.length ) {
			$content = $( '#content' );
		}
		
		$root.addClass( 'spriteedit-enabled' );
		if ( imageEditingSupported ) {
			$root.addClass( 'spriteedit-imageeditingenabled' );
		}
		
		$( '.mw-editsection' ).add( '.mw-editsection-like' ).css( 'display', 'none' );
		
		// Store previous element and parent
		// to re-attach to once done.
		var $docPrev = $doc.prev();
		var $docParent = $doc.parent();
		$doc.detach();
		
		$doc.find( '#toc' ).remove();
		
		addControls( $doc.find( 'h3' ), 'heading' );
		
		var $boxes = $doc.find( '.spritedoc-box' );
		$boxes.each( function() {
			var $this = $( this );
			
			var $names = $this.find( '.spritedoc-name' );
			$this.attr( 'data-sort-key', $names.first().text() );
			
			$names.find( 'code' ).each( function() {
				var $code = $( this );
				names[$code.text()] = [ $code ];
			} );
		} );
		addControls( $boxes, 'box' );
		
		// Collapses and expands boxes in each section when sorting
		// sections or boxes, so it's easier to get to the right section
		var collapseBoxes = function( placeholder ) {
			var $this = $( this );
			var isBox = $this.hasClass( 'spritedoc-box' );
			var section = isBox ? $this.closest( '.spritedoc-section' )[0] : placeholder;
			var origPos = this.getBoundingClientRect();
			var origSectionPos = section.getBoundingClientRect();
			var heights = [];
			
			$doc.find( '.spritedoc-boxes' ).each( function() {
				var child = this.firstElementChild;
				if ( child ) {
					if ( $( child ).hasClass( 'spriteedit-ghost' ) ) {
						child = child.nextElementSibling || child;
					}
					heights.push( child.getBoundingClientRect().height );
				} else {
					heights.push( 0 );
				}
			} ).each( function( i ) {
				// Set styling after get loop to avoid layout thrashing
				var height = heights[i];
				if ( !height ) {
					return;
				}
				
				$( this ).css( {
					height: height,
					overflow: 'hidden'
				} );
			} );
			
			// First make sure the section is in the same place relative to the window
			scroll( 0, $win.scrollTop() + section.getBoundingClientRect().top - origSectionPos.top );
			
			// Now if we're sorting boxes, make sure the box remains inside the section
			if ( isBox ) {
				var sectionPos = section.getBoundingClientRect();
				if ( origPos.bottom > sectionPos.bottom ) {
					scroll( 0, $win.scrollTop() + sectionPos.bottom - origPos.bottom );
				}
			}
		};
		var expandBoxes = function() {
			var origPos = this.getBoundingClientRect();
			
			$doc.find( '.spritedoc-boxes' ).css( {
				height: 'auto',
				overflow: 'visible'
			} );
			
			// If we're sorting boxes, scroll so the box is near the cursor
			var $this = $( this );
			if ( $this.hasClass( 'spritedoc-box' ) ) {
				var boxPos = this.getBoundingClientRect();
				scroll( 0, $win.scrollTop() + boxPos.top + boxPos.height / 2 - mouse.y );
				
				// Flash the box so it is obvious where it was sorted to
				$this.css( 'background-color', 'yellow' );
				setTimeout( function() {
					$this.css( 'background-color', '' );
				}, 1000 );
			} else {
				// Otherwise make sure the section is in the same place relative to the window
				scroll( 0, $win.scrollTop() + this.getBoundingClientRect().top - origPos.top );
			}
		};
		makeSortable( {
			selectors: '.spritedoc-section',
			handle: 'h3',
			vertical: true,
			sortStart: collapseBoxes,
			sortEnd: expandBoxes
		} );
		makeSortable( {
			selectors: {
				container: '.spritedoc-section',
				parent: '.spritedoc-boxes',
				elem: '.spritedoc-box'
			},
			autoSort: true,
			sortStart: collapseBoxes,
			sortEnd: expandBoxes
		} );
		makeSortable( {
			selectors: {
				container: '.spritedoc-box',
				parent: '.spritedoc-names',
				elem: '.spritedoc-name'
			},
			autoSort: true
		} );
		
		// Create toolbar
		$toolbar = $( '<div>' ).addClass( 'spriteedit-toolbar' );
		$toolbar.append(
			$( '<span>' ).css( {
				'float': 'right',
				textAlign: 'right'
			} ).append(
				makeButton( 'Save', {
					id: 'spriteedit-save',
					type: 'progressive',
					props: { disabled: true }
				} )
			),
			$( '<span>' ).addClass( 'mw-ui-button-group' ).append(
				makeButton( 'Undo', {
					id: 'spriteedit-undo',
					props: { disabled: true },
					action: function() {
						$( this ).blur();
						
						var hist = changes.pop();
						revert( hist );
						undoneChanges.push( hist );
						$( '#spriteedit-redo' ).prop( 'disabled', false );
					}
				} ),
				makeButton( 'Redo', {
					id: 'spriteedit-redo',
					props: { disabled: true },
					action: function() {
						$( this ).blur();
						
						var hist = undoneChanges.pop();
						$.each( hist, function() {
							change( this.action, this.content, false, true );
						} );
						changes.push( hist );
						
						if ( !undoneChanges.length ) {
							$( this ).prop( 'disabled', true );
						}
						
						$( '#spriteedit-undo' ).add( '#spriteedit-save' ).prop( 'disabled', false );
					}
				} )
			),
			$( '<span>' ).addClass( 'mw-ui-button-group' ).append(
				makeButton( 'New section', { id: 'spriteedit-add-section' } ),
				makeButton( 'New image', { id: 'spriteedit-add-image' } )
			),
			$( '<div>' ).addClass( 'spriteedit-dropzone' ).append(
				$( '<div>' ).text( 'Drop images here' )
			).height( $win.height() / 4 )
		);
		if ( !imageEditingSupported ) {
			$toolbar.find( '#spriteedit-add-image' ).prop( {
				disabled: true,
				title: 'Not supported by your browser.'
			} ).css( 'cursor', 'help' );
		}
		
		
		var contentPadding = {
			left: $content.css( 'padding-left' ),
			right: $content.css( 'padding-right' )
		};
		var contentOffset = $content.offset().left;
		$toolbar.css( {
			paddingLeft: contentPadding.left,
			paddingRight: contentPadding.right,
			marginLeft: '-' + contentPadding.left,
			marginRight: '-' + contentPadding.right,
			left: contentOffset + 1
		} );
		
		var $barContainer = $( '<div>' ).addClass( 'spriteedit-toolbar-container' )
			.append( $toolbar ).prependTo( $doc );
		
		if ( $docPrev.length ) {
			$doc.insertAfter( $docPrev );
		} else {
			$doc.prependTo( $docParent );
		}
		
		// Set height now that everything is re-attached
		$barContainer.height( $toolbar[0].getBoundingClientRect().height );
		
		// Wait until everything else is done so the animation is smooth
		setImmediate( function() {
			var barTop = $barContainer[0].getBoundingClientRect().top;
			if ( barTop > 0 ) {
				$root.addClass( 'spriteedit-smoothscroll' );
				scroll( 0, barTop + $win.scrollTop() + 1 );
			}
		} );
		
		
		/** Bind events **/
		/* Outside interface events */
		$( '#ca-view' ).find( 'a' ).on( 'click.spriteEdit', function( e ) {
			close();
			e.preventDefault();
		} );
		
		
		/* Toolbar events */
		// Manually make the toolbar sticky if position:sticky isn't supported
		if ( !supports( 'position', 'sticky' ) ) {
			var fixedClass = 'spriteedit-toolbar-fixed';
			$win.on( 'scroll.spriteEdit', $.throttle( 50, function() {
				var fixed = $toolbar.hasClass( fixedClass ),
					scrollTop = $win.scrollTop(),
					offset = $barContainer.offset().top;
				if ( !fixed && scrollTop >= offset ) {
					$toolbar.addClass( fixedClass );
				} else if ( fixed && scrollTop < offset ) {
					$toolbar.removeClass( fixedClass );
				}
			} ) );
		}
		
		$( '#spriteedit-add-section' ).on( 'click.spriteEdit', function() {
			$( this ).blur();
			
			var $newHeading = $headingTemplate.clone();
			change( 'insert', {
				$elem: $( '<div>' ).addClass( 'spritedoc-section' ).prepend(
					$newHeading,
					$( '<ul>' ).addClass( 'spritedoc-boxes' )
				),
				index: $( nearestSection() ).index() - 1,
				$parent: $doc
			}, true );
			
			$newHeading.find( '.mw-headline' ).focus();
		} );
		
		$( '#spriteedit-add-image' ).on( 'click.spriteEdit', function() {
			$( '<input type="file">' )
				.attr( {
					accept: 'image/*',
					multiple: true
				} )
				.one( 'change.spriteEdit', function() {
					insertSprites( this.files );
				} ).click();
			
			$( this ).blur();
		} );
		
		// Drag and drop functionality
		if ( dropSupported ) {
			var $dropzone = $toolbar.find( '.spriteedit-dropzone' );
			var endDrop = function() {
				clearTimeout( dragTimeout );
				hideDrag = false;
				showDrag = true;
				clearTimeout( dropTimeout );
				hideDrop = false;
				showDrop = true;
				
				$dropzone.css( 'opacity', 0 ).transitionEnd( function() {
					$dropzone.css( 'display', '' );
				} ).find( 'div' ).css( 'padding', '' );
				$toolbar.css( 'height', '' ).find( 'span' ).css( 'opacity', 1 );
			};
			var dragTimeout, showDrag = true, hideDrag = false;
			$win.on( 'dragenter.spriteEdit', function() {
				if ( showDrag ) {
					$dropzone.css( 'display', 'block' ).off( 'transitionend.spriteEdit' );
					setImmediate( function() {
						$dropzone.css( 'opacity', 1 );
					} );
					$toolbar.find( 'span' ).css( 'opacity', 0.3 );
					showDrag = false;
				}
				
				clearTimeout( dragTimeout );
				hideDrag = false;
			} ).on( 'dragover.spriteEdit', function() {
				hideDrag = false;
			} ).on( 'dragleave.spriteEdit', function() {
				clearTimeout( dragTimeout );
				hideDrag = true;
				dragTimeout = setTimeout( function() {
					if ( hideDrag ) {
						endDrop();
						showDrag = true;
					}
				}, 1 );
			} ).on( 'dragend', endDrop );
			
			var dropTimeout, showDrop = true, hideDrop = false;
			$dropzone.on( 'dragenter.spriteEdit', function( e ) {
				if ( showDrop ) {
					var $dropText = $dropzone.find( 'div' );
					$dropText.css( 'line-height', $dropText.css( 'line-height' ) )
						.off( 'transitionend.spriteEdit' );
					$toolbar.innerHeight( $toolbar.innerHeight() ).off( 'transitionend.spriteEdit' );
					setImmediate( function() {
						$dropText.css( 'line-height', $dropzone.height() + 'px' );
						$toolbar.innerHeight( $dropzone.innerHeight() )
							.find( 'span' ).css( 'opacity', 0 );
					} );
					showDrop = false;
				}
				
				clearTimeout( dropTimeout );
				hideDrop = false;
				e.preventDefault();
			} ).on( 'dragover.spriteEdit', function( e ) {
				clearTimeout( dropTimeout );
				hideDrop = false;
				
				e.preventDefault();
			} ).on( 'drop.spriteEdit', function( e ) {
				insertSprites( e.originalEvent.dataTransfer.files );
				endDrop();
				e.preventDefault();
			} ).on( 'dragleave.spriteEdit', function() {
				clearTimeout( dropTimeout );
				hideDrop = true;
				dropTimeout = setTimeout( function() {
					if ( hideDrop ) {
						var $dropText = $dropzone.find( 'div' );
						var oldLineHeight = $dropText.css( 'line-height' );
						var newLineHeight = $dropText.css( 'line-height', '' ).css( 'line-height' );
						$dropText.css( 'line-height', oldLineHeight ).transitionEnd( function() {
							$dropText.css( 'line-height', '' );
						} );
						var oldHeight = $toolbar.innerHeight();
						var newHeight = $toolbar.css( 'height', '' ).innerHeight();
						$toolbar.innerHeight( oldHeight ).transitionEnd( function() {
							$toolbar.css( 'height', '' );
						} );
						setImmediate( function() {
							$dropText.css( 'line-height', newLineHeight );
							$toolbar.innerHeight( newHeight ).find( 'span' ).css( 'opacity', 0.3 );
						} );
						showDrop = true;
					}
				}, 1 );
			} );
		}
		
		$( '#spriteedit-save' ).on( 'click.spriteEdit', function() {
			var $button = $( this );
			if ( $button.hasClass( 'spriteedit-processing' ) ) {
				return;
			}
			$button.blur().addClass( 'spriteedit-processing' );
			
			// Prevent saving if there are duplicate names
			if ( $doc.find( '.spriteedit-dupe' ).length ) {
				var dupeNamePanel = panels.dupename || panel(
					'dupename',
					'Duplicate names',
					$( '<p>' )
						.text( 'There are duplicate names which must be resolved prior to saving.' ),
					{ right: { text: 'Return', config: {
						type: 'progressive',
						action: function() {
							dupeNamePanel.hide();
						}
					} } }
				);
				$button.removeClass( 'spriteedit-processing' );
				dupeNamePanel.show();
				
				return;
			}
			
			mw.loader.load( 'mediawiki.action.history.diff' );
			
			var summaryPanel = panels.summary || panel(
				'summary',
				'Save your changes',
				$( '<textarea>' ).addClass( 'mw-ui-input' ).prop( {
					placeholder: 'Summarize the changes you made',
					maxlength: 255
				} ),
				{
					left: { text: 'Review changes', config: { id: 'spriteedit-review-changes' } },
					right: { text: 'Save', config: {
						id: 'spriteedit-save-changes',
						type: 'constructive'
					} }
				},
				function() {
					this.$text.find( 'textarea' ).focus();
					this.$actions.find( 'button' )
						.prop( 'disabled', false )
						.removeClass( 'spriteedit-processing' );
				},
				true
			);
			
			if ( modified.sheet ) {
				var sheetCanvas = getCanvas( 'sheet' );
				var lastPos = $doc.data( 'pos' );
				var usedPos = {};
				usedPos[lastPos] = true;
				
				var newImgs = [];
				$doc.find( '.spritedoc-box' ).each( function() {
					var $box = $( this );
					var pos = $box.data( 'pos' );
					if ( pos === undefined ) {
						newImgs.push( $box );
					} else {
						usedPos[pos] = true;
						if ( pos > lastPos ) {
							lastPos = pos;
						}
					}
				} );
				
				if ( newImgs.length ) {
					var unusedPos = [];
					for ( var i = 1; i <= lastPos; i++ ) {
						if ( !usedPos[i] ) {
							unusedPos.push( i );
						}
					}
					
					var origLastPos = lastPos;
					newImgs.forEach( function( $box ) {
						$box.data( 'new-pos', unusedPos.shift() || ++lastPos );
					} );
					
					if ( lastPos !== origLastPos ) {
						var imagesPerRow = settings.sheetWidth / settings.imageWidth;
						settings.sheetHeight = Math.ceil( lastPos / imagesPerRow ) * settings.imageHeight;
						sheetCanvas.resize();
					}
				}
				
				$.when.apply( $, loadingImages ).done( function() {
					sheetCanvas.clear();
					sheetCanvas.ctx.drawImage( spritesheet, 0, 0 );
					
					$doc.find( '.spriteedit-new' ).each( function() {
						var $box = $( this );
						var img = $box.find( 'img' )[0];
						var pos = $box.data( 'pos' );
						if ( pos === undefined ) {
							pos = $box.data( 'new-pos' );
						}
						
						var posPx = posToPx( pos );
						sheetCanvas.ctx.clearRect(
							posPx.left,
							posPx.top,
							settings.imageWidth,
							settings.imageHeight
						);
						sheetCanvas.ctx.drawImage( img, posPx.left, posPx.top );
					} );
					sheetData = sheetCanvas.canvas.toDataURL();
					
					loadingImages = [];
					$button.removeClass( 'spriteedit-processing' );
					summaryPanel.show();
				} );
			} else {
				sheetData = null;
				$button.removeClass( 'spriteedit-processing' );
				summaryPanel.show();
			}
			
			var sectionNum = 0;
			var headingOrder = [];
			var ids = [];
			$doc.find( '.mw-headline, .spritedoc-box' ).each( function() {
				var $this = $( this );
				if ( $this.hasClass( 'mw-headline' ) ) {
					sectionNum++;
					headingOrder.push( luaStringQuote( $this.text() ) + ',' );
					return true;
				}
				
				var pos = $this.data( 'pos' );
				if ( pos === undefined ) {
					pos = $this.data( 'new-pos' );
				}
				$this.find( '.spritedoc-name' ).each( function() {
					var id = $( this ).text();
					ids.push( { sortKey: id.toLowerCase(), id: id, pos: pos, section: sectionNum } );
				} );
			} );
			ids.sort( function( a, b ) {
				return a.sortKey > b.sortKey ? 1 : -1;
			} );
			
			var idsRows = [];
			$.each( ids, function() {
				idsRows.push(
					'[' + luaStringQuote( this.id ) + '] = ' +
					'{ pos = ' + this.pos + ', section = ' + this.section + ' },'
				);
			} );
			
			idsTable = [
				'return {',
				'	sections = {',
				'		' + headingOrder.join( '\n\t\t' ),
				'	},',
				'	ids = {',
				'		' + idsRows.join( '\n\t\t' ),
				'	}',
				'}'
			].join( '\n' );
			
			idChanges = $.Deferred();
			revisionsApi.post( {
				pageids: idsPageId,
				rvprop: '',
				rvdifftotext: idsTable,
				rvlimit: 1
			} ).done( function( data ) {
				idChanges.resolve( makeDiff( data ) );
			} )
				// Don't handle error directly, so it can fail silently unless attempting
				// to view the diff, as this isn't necessary for saving
				.fail( idChanges.reject );
			
			idChanges.done( function( diff ) {
				modified.names = !!diff;
			} );
		} );
		
		
		/* Dialog events */
		$doc.on( 'click.spriteEdit', '#spriteedit-review-changes' , function() {
			var $button = $( this );
			if ( $button.hasClass( 'spriteedit-processing' ) ) {
				return;
			}
			$button.blur().addClass( 'spriteedit-processing' );
			
			var changesPanel = panels.changes || panel(
				'changes',
				'Review your changes',
				[
					$( '<div>' ).addClass( 'spriteedit-sheet-changes' ),
					$( '<div>' ).addClass( 'spriteedit-id-changes' )
				],
				{ right: { text: 'Return to save form', config: {
					id: 'spriteedit-return-save',
					type: 'progressive'
				} } }
			);
			var $changesText = changesPanel.$text;
			
			// Just re-display old content
			if ( $changesText.text() ) {
				$button.removeClass( 'spriteedit-processing' );
				changesPanel.show();
				return;
			}
			
			if ( sheetData ) {
				$changesText.find( '.spriteedit-sheet-changes' ).append(
					$( '<div>' ).text( 'Spritesheet changes' ),
					$( '<div>' ).addClass( 'spriteedit-sheet-diff' ).append(
						$( '<span>' ).addClass( 'spriteedit-old-sheet' ).append(
							$( '<img>' ).attr( 'src', settings.sheet )
						),
						$( '<span>' ).addClass( 'spriteedit-new-sheet' ).append(
							$( '<img>' ).attr( 'src', sheetData )
						)
					)
				);
			}
			
			idChanges.done( function( diff ) {
				if ( diff ) {
					$changesText.find( '.spriteedit-id-changes' ).append(
						$( '<div>' ).text( 'ID changes' ),
						$( '<div>' ).append( diff )
					);
				} else if ( !sheetData ) {
					$changesText.text( 'No changes from current revision.' );
				}
				
				$button.removeClass( 'spriteedit-processing' );
				changesPanel.show();
			} ).fail( handleError );
		} );
		
		$doc.on( 'click.spriteEdit', '#spriteedit-return-save', function() {
			panels.summary.show();
		} );
		
		$doc.on( 'click.spriteEdit', '#spriteedit-save-changes', function() {
			if ( $( this ).hasClass( 'spriteedit-processing' ) ) {
				return;
			}
			$( this ).blur().addClass( 'spriteedit-processing' );
			
			// If the diff is ready, we'll see if there are changes to be saved,
			// otherwise it's likely faster to just save and assume changes
			// were made, than wait for the diff to be ready
			var idDiff = true;
			if ( idChanges.state() === 'resolved' ) {
				idChanges.done( function( data ) {
					idDiff = data;
				} );
			}
			if ( !idDiff && !sheetData ) {
				panel().hide( function() {
					destroy( true );
				} );
				
				return;
			}
			
			var summary = panels.summary.$text.find( 'textarea' ).val();
			saveChanges( summary, idsTable );
		} );
		
		
		/* Edit control events */
		$doc.on( 'click.spriteEdit', '.spriteedit-add-name > button', function() {
			var $names = $( this ).closest( '.spritedoc-box' ).find( '.spritedoc-name' );
			var $item = $( '<li>' ).addClass( 'spritedoc-name' );
			var $name = $( '<code>' ).addClass( 'spriteedit-new' )
				.attr( 'data-placeholder', 'Type a name' );
			addControls( $item.append( $name ), 'name' );
			
			change( 'insert', {
				$elem: $item,
				index: $names.length - 1,
				$parent: $names.first().parent()
			}, true );
			
			$name.focus();
		} );
		
		$doc.on( 'focus.spriteEdit', '[contenteditable]', function() {
			var $this = $( this );
			var text = $this.text();
			$this.attr( 'data-original-text', text );
			
			if ( !changes.length ) {
				$this.one( 'keypress.spriteEdit', function() {
					$( '#spriteedit-save' ).prop( 'disabled', false );
				} );
			}
		} );
		$doc.on( 'blur.spriteEdit', '[contenteditable]', function() {
			var $this = $( this );
			var text = $this.text();
			var trimmedText = $.trim( text );
			var origText = $this.attr( 'data-original-text' );
			$this.removeAttr( 'data-original-text' ).off( 'keypress.spriteEdit' );
			
			if ( text !== trimmedText ) {
				text = trimmedText;
				$this.text( text );
			}
			
			if ( text === '' ) {
				var $remove, $parent;
				if ( $this.hasClass( 'mw-headline' ) ) {
					if ( $doc.find( '.spritedoc-section' ).length === 1 ) {
						change( 'text', {
							$elem: $this,
							oldText: origText,
							text: 'Uncategorized'
						} );
						return;
					} else {
						$remove = $this.closest( '.spritedoc-section' );
						$parent = $doc;
					}
				} else {
					var $names = $this.closest( '.spritedoc-names' );
					if ( $names.find( '.spritedoc-name' ).length > 1 ) {
						$remove = $this.parent();
						$parent = $names;
					} else {
						$remove = $names.parent();
						$parent = $remove.parent();
					}
				}
				
				if ( $this.hasClass( 'spriteedit-new' ) ) {
					// Just pretend it never happened
					$remove.remove();
					change.discard();
					return;
				}
				
				// Restore original text before deleting so undo works
				$this.text( origText );
				
				change( 'delete', {
					$elem: $remove,
					index: $remove.index() - 1,
					$parent: $parent
				} );
				return;
			}
			
			if ( text === origText ) {
				if ( !changes.length ) {
					$( '#spriteedit-save' ).prop( 'disabled', true );
				}
				
				return;
			}
			
			if ( names[text] ) {
				// Wait until after edit change, as it may move the element
				// which the tooltip should be anchored to
				setImmediate( function() {
					tooltip( $this, 'This name already exists.' );
				} );
			}
			
			change( 'edit', {
				$elem: $this,
				oldText: origText,
				text: text
			} );
			
			if ( $this.hasClass( 'spriteedit-new' ) ) {
				$this.removeClass( 'spriteedit-new' ).removeAttr( 'data-placeholder' );
			}
		} );
		$doc.on( 'keypress.spriteEdit', '[contenteditable]', function( e ) {
			// Enter key
			if ( e.which === 13 ) {
				$( this ).blur();
				e.preventDefault();
			}
		} );
		
		if ( imageEditingSupported ) {
			$doc.on( 'click.spriteEdit', '.spritedoc-image', function() {
				var $parent = $( this );
				
				tooltip( $parent, [
					makeButton( 'Replace image', {
						type: 'progressive',
						css: {
							display: 'block',
							width: '100%'
						},
						action: function() {
							$( this ).blur();
							
							$( '<input type="file">' )
								.attr( 'accept', 'image/*' )
								.one( 'change', function() {
									tooltip.hide();
									
									scaleImage( this.files[0] ).done( function( $img ) {
										change( 'replace image', {
											$elem: $img,
											$parent: $parent,
											$oldImg: $parent.find( 'img' )
										} );
									} );
								} ).click();
						}
					} ),
					makeButton( 'Delete image', {
						type: 'destructive',
						css: {
							display: 'block',
							width: '100%'
						},
						action: function() {
							tooltip.hide( function() {
								var $box = $parent.parent();
								change( 'delete', {
									$elem: $box,
									$parent: $box.parent(),
									index: $box.index() - 1
								} );
							} );
						}
					} )
				], true );
			} );
		}
		
		
		/* Window events */
		$win.on( 'resize.spriteEdit', function() {
			var $dialog = $( '.spriteedit-dialog' );
			if ( $dialog.length && $dialog.is( ':visible' ) ) {
				$dialog.css( { width: '', height: '' } );
				$dialog.css( {
					width: $dialog.width(),
					height: $dialog.height()
				} );
			}
		} );
		
		var updateMouse = function( e ) {
			mouse.moved = true;
			mouse.x = e.clientX;
			mouse.y = e.clientY;
		};
		// Only update mouse while sorting or while over a handle
		$doc.on( 'mouseenter.spriteEdit mousemove.spriteEdit', '.spriteedit-handle', function( e ) {
			if ( !sorting ) {
				updateMouse( e );
			}
		} );
		$( document ).on( 'mousemove.spriteEdit', function( e ) {
			if ( sorting ) {
				updateMouse( e );
			}
		} );
		
		// Disable smooth scrolling once scrolling ends so it does not interfere with user scrolling.
		$win.on( 'scroll.spriteEdit', $.debounce( 250, function() {
			$root.removeClass( 'spriteedit-smoothscroll' );
		} ) );
		
		$win.on( 'beforeunload.spriteEdit', function( e ) {
			if ( !$( '#spriteedit-save' ).is( '[disabled]' ) ) {
				e.preventDefault();
			}
		} );
	};
	
	
	/** Editor functions **/
	/**
	 * Closes the editor
	 *
	 * If there are no changes, destroys the editor immediately.
	 * If there are changes, opens a panel asking for confirmation first.
	 *
	 * "state" is what triggered the editor to close (e.g. from history navigation)
	 */
	var close = function( state ) {
		if ( !$root.hasClass( 'spriteedit-enabled' ) || $( '#spriteedit-save' ).is( '[disabled]' ) ) {
			destroy( true, state === 'history' );
		} else {
			var discardPanel = panels.discard || panel(
				'discard',
				'Unsaved changes',
				$( '<p>' ).text( 'Are you sure you wish to discard your changes?' ),
				{ right: [
					{ text: 'Keep editing', config: {
						action: function() {
							discardPanel.hide();
						}
					} },
					{ text: 'Discard changes', config: {
						type: 'destructive',
						action: function() {
							discardPanel.hide( function() {
								destroy( true, state === 'history' );
							} );
						}
					} }
				] }
			);
			discardPanel.show();
		}
	};
	
	/**
	 * Construct a wiki diff from an API request
	 *
	 * "data" is the API response.
	 * Returns a jQuery object containing the diff table, an error message
	 * if something went wrong, or nothing if the diff is empty.
	 */
	var makeDiff = function( data ) {
		if ( !data || !data.query || !data.query.pages ) {
			return 'Something went wrong';
		}
		
		var pages = data.query.pages;
		var page = pages[idsPageId];
		if ( !page ) {
			return 'Failed to retrieve page';
		}
		var diff = page.revisions[0].diff['*'];
		if ( diff === undefined ) {
			return 'Failed to retrieve diff';
		}
		
		if ( !diff.length ) {
			return;
		}
		
		return $( '<table>' ).addClass( 'diff' ).append(
			$( '<col>' ).addClass( 'diff-marker' ),
			$( '<col>' ).addClass( 'diff-content' ),
			$( '<col>' ).addClass( 'diff-marker' ),
			$( '<col>' ).addClass( 'diff-content' ),
			$( '<tbody>' ).html( diff )
		);
	};
	
	/**
	 * Performs a save of the ID changes and/or spritesheet changes
	 *
	 * If there are changes and everything works out, the editor closes, the current
	 * page is purged, the timestamp is updated (for another edit in this session),
	 * and a success message is displayed.
	 * If there aren't changes, the editor will silently close, as if a null edit was performed
	 * (which if the diff wasn't ready in time, there will have been).
	 * In the event of an edit conflict, a manual resolution panel will be displayed.
	 * Otherwise, whatever error occurred will be displayed.
	 *
	 * "summary" is the text from the summary field.
	 * "idsTable" is the stringified lua table containing the ids and sections
	 * "refresh" is a boolean, which when true will cause the sprite documentation
	 * to be reparsed after saving (e.g. in the event of an edit conflict).
	 */
	var saveChanges = function( summary, idsTable, refresh ) {
		var idsEdit;
		if ( modified.names !== false ) {
			idsEdit = new mw.Api().postWithToken( 'edit', {
				action: 'edit',
				nocreate: true,
				pageid: idsPageId,
				text: idsTable,
				basetimestamp: $doc.data( 'idstimestamp' ),
				summary: summary
			} ).done( function( data ) {
				// Null edit, nothing to do here
				if ( data.edit.nochange === '' ) {
					return;
				}
				
				$doc.data( 'idstimestamp', fixTimestamp( data.edit.newtimestamp ) );
				
				// Purge this page so the changes show up immediately
				new mw.Api().get( {
					action: 'purge',
					pageids: mw.config.get( 'wgArticleId' )
				} );
			} ).fail( handleSaveError );
		}
		$.when( idsEdit ).done( function() {
			var sheetEdit;
			if ( sheetData ) {
				var sheetByteString = atob( sheetData.split( ',' )[1] );
				var sheetByteStringLen = sheetByteString.length;
				var buffer = new ArrayBuffer( sheetByteStringLen );
				var intArray = new Uint8Array( buffer );
				for ( var i = 0; i < sheetByteStringLen; i++) {
					intArray[i] = sheetByteString.charCodeAt( i );
				}
				var sheetBytes = new Blob( [buffer], { type: 'image/png' } );
				
				sheetEdit = new mw.Api( {
					ajax: { contentType: 'multipart/form-data' }
				} ).postWithToken( 'edit', {
					action: 'upload',
					ignorewarnings: true,
					comment: summary,
					filename: $doc.data( 'spritesheet' ),
					file: sheetBytes
				} ).fail( handleError );
			}
			$.when( sheetEdit ).done( function() {
				var newContent;
				if ( refresh ) {
					newContent = new mw.Api().get( {
						action: 'parse',
						title: mw.config.get( 'wgPageName' ),
						text: $( '<i>' ).html(
							$.parseHTML( $doc.attr( 'data-refreshtext' ) )
						).html(),
						prop: 'text',
						disablepp: true,
						disabletoc: true
					} );
				}
				
				$.when( newContent ).done( function( data ) {
					panel().hide( function() {
						if ( refresh ) {
							$doc.html( data.parse.text['*'] );
						}
						
						destroy();
						
						mw.hook( 'postEdit' ).fire( { message: 'Your changes were saved.' } );
					} );
				} );
			} );
		} );
	};
	
	/**
	 * Handles special case errors that ocurr when saving (AKA, handleError with edit conflicts)
	 *
	 * If there's an edit conflict, this will be display a barely human-usable edit conflict
	 * panel, where the user may manually merge the raw lua table changes. Sprite edit conflict
	 * merging is not supported (because image uploading doesn't implement edit conflicts, for one).
	 * Otherwise, passes it on to handleError.
	 *
	 * "code" and "data" are the standard variables returned by a mw.Api promise rejection.
	 */
	var handleSaveError = function( code, data ) {
		if ( code !== 'editconflict' ) {
			handleError( code, data );
			return;
		}
		
		var conflictPanel = panels.conflict || panel(
			'conflict',
			'Edit conflict',
			$( '<p>' ).text(
				'An edit conflict has occurred, and was not able to be resolved automatically.'
			),
			{
				left: { text: 'Review changes', config: {
					id: 'review-conflict-changes',
					action: function() {
						if ( $( this ).hasClass( 'spriteedit-processing' ) ) {
							return;
						}
						$( this ).blur().addClass( 'spriteedit-processing' );
						
						var changesPanel = panels.ecchanges || panel(
							'ecchanges',
							'Review your manual changes',
							$( '<div>' ).addClass( 'spriteedit-id-changes' ),
							{ right: { text: 'Return to edit conflict form', config: {
								id: 'spriteedit-return-edit',
								type: 'progressive',
								action: function() {
									conflictPanel.show();
								}
							} } }
						);
						
						revisionsApi.post( {
							pageids: idsPageId,
							rvprop: '',
							rvdifftotext: $( this ).closest( '.spriteedit-dialog-panel' )
								.find( 'textarea:first' ).val(),
							rvlimit: 1
						} ).done( function( data ) {
							changesPanel.clean();
							
							var diff = makeDiff( data );
							if ( !diff ) {
								diff = 'No changes from current revision.';
							}
							changesPanel.$text.find( '.spriteedit-id-changes' ).append( diff );
							changesPanel.show();
						} ).fail( handleError );
					}
				} },
				right: { text: 'Save', config: {
					id: 'save-conflict',
					type: 'constructive',
					action: function() {
						if ( $( this ).hasClass( 'spriteedit-processing' ) ) {
							return;
						}
						$( this ).blur().addClass( 'spriteedit-processing' );
						
						var summary = panels.summary.$text.find( 'textarea' ).val();
						idsTable = conflictPanel.$text.find( 'textarea:first' ).val();
						saveChanges( summary, idsTable, true );
					}
				} }
			},
			function() {
				this.$actions.find( 'button' ).removeClass( 'spriteedit-processing' );
			}
		);
		
		var idsDiff = revisionsApi.post( {
			pageids: idsPageId,
			rvprop: '',
			rvdifftotext: idsTable,
			rvlimit: 1
		} ).fail( handleError );
		revisionsApi.get( { pageids: idsPageId } ).done( function( data ) {
			var opt = mw.user.options.get( [ 'rows', 'cols' ] );
			var $textbox = $( '<textarea>' ).addClass( 'mw-ui-input' ).prop( {
				rows: opt.rows,
				cols: opt.cols
			} );
			
			var $curText = $( '<div>' ).append(
				$textbox.clone().val( data.query.pages[idsPageId].revisions[0]['*'] )
			);
			var $oldText = $( '<div>' ).append(
				$textbox.clone().prop( 'readonly', true ).val( idsTable )
			);
			
			idsDiff.done( function( data ) {
				var $diff = $( '<div>' ).append( makeDiff( data ) );
				
				conflictPanel.$text
					.append( $( '<p>' ).text( 'Current text' ) )
					.append( $curText )
					.append( $diff )
					.append( $( '<p>' ).text( 'Your text' ) )
					.append( $oldText );
				
				conflictPanel.show();
			} );
		} ).fail( handleError );
	};
	
	/**
	 * Converts a position to pixel co-ordinates on the sheet
	 */
	var posToPx = function( pos ) {
		pos -= 1;
		var imagesPerRow = settings.sheetWidth / settings.imageWidth;
		return {
			left: pos % imagesPerRow * settings.imageWidth,
			top: Math.floor( pos / imagesPerRow ) * settings.imageHeight
		};
	};
	
	/**
	 * Inserts new images into the editor
	 *
	 * A box is created for the new image, with the name set to the file's name (minus extension).
	 * The box is inserted into the nearest section and then sorted to the correct location.
	 * Any file that doesn't match the image/* mime type is ignored.
	 *
	 * "files" is a "FileList" (or an array of "File" objects) from a file input or dropzone.
	 */
	var insertSprites = function( files ) {
		var $parent = $( nearestSection() ).find( '.spritedoc-boxes' );
		$.each( files, function() {
			if ( !this.type.match( /^image\// ) ) {
				return;
			}
			
			var $newBox = $boxTemplate.clone();
			$newBox.find( 'code' ).text( $.trim( this.name ).replace( /\.[^\.]+$/, '' ) );
			scaleImage( this ).done( function( $img ) {
				$newBox.find( '.spritedoc-image' ).html( $img );
			} );
			
			var name = $newBox.find( '.spritedoc-name' ).text();
			$newBox.attr( 'data-sort-key', name );
			
			var index = getAlphaIndex( name, undefined, $parent );
			change( 'insert', {
				$elem: $newBox,
				index: index - 1,
				$parent: $parent
			} );
		} );
		
		if ( !modified.sheet && $doc.find( '.spriteedit-new' ).length ) {
			modified.sheet = true;
		}
	};
	
	/**
	 * Constructs (or retrieves) a canvas for a particular purpose
	 *
	 * Either for image scaling, or spritesheet creation.
	 *
	 * Returns an object containing the canvas, its context,
	 * and some convenience functions for clearing the canvas
	 * and for updating its dimensions.
	 *
	 * "type" is the canvas type ("image" or "sheet").
	 */
	var getCanvas = ( function() {
		var canvases = {};
		return function( type ) {
			if ( canvases[type] ) {
				return canvases[type];
			}
			
			var $canvas = $( '<canvas>' ).attr( {
				width: settings[type + 'Width'],
				height: settings[type + 'Height']
			} ).appendTo( $doc );
			var canvas = $canvas[0];
			var ctx = canvas.getContext( '2d' );
			
			var funcs = {
				canvas: canvas,
				ctx: ctx,
				resize: function() {
					$canvas.attr( {
						width: settings[type + 'Width'],
						height: settings[type + 'Height']
					} );
				},
				clear: function() {
					ctx.clearRect( 0, 0, canvas.width, canvas.height );
				}
			};
			canvases[type] = funcs;
			return funcs;
		};
	}() );
	
	/**
	 * Scales an image down to the correct size (if necessary)
	 *
	 * Performs only a basic low quality scaling, ignoring the original image's
	 * aspect ratio.
	 * Also performs a "scale" if the image isn't a png, in essence converting it to one.
	 *
	 * Returns a promise which will contain a jQuery object containing a new image element
	 * the url of which is either a object URL or data URL of the scaled image.
	 */
	var scaleImage = ( function() {
		var scaler;
		return function( file ) {
			var deferred = $.Deferred();
			var img = new Image();
			img.onload = function() {
				if (
					file.type === 'image/png' &&
					img.width === settings.imageWidth && img.height === settings.imageHeight
				) {
					// No scaling necessary
					deferred.resolve( $( img ) );
					return;
				}
				
				if ( !scaler ) {
					scaler = getCanvas( 'image' );
				}
				scaler.clear();
				scaler.ctx.drawImage( img, 0, 0, settings.imageWidth, settings.imageHeight );
				
				URL.revokeObjectURL( img.src );
				
				var scaledImg = new Image();
				scaledImg.onload = function() {
					deferred.resolve( $( scaledImg ) );
				};
				scaledImg.src = scaler.canvas.toDataURL();
			};
			img.src = URL.createObjectURL( file );
			
			loadingImages.push( deferred.promise() );
			return deferred.promise();
		};
	}() );
	
	/**
	 * Creates panels to display in a dialog window
	 *
	 * If this is the first panel, the dialog window is created.
	 * Panels are stored in the "panels" object, which should be checked for
	 * for panel id prior to calling this function to create a new panel,
	 * so duplicates are not made.
	 * E.g: `var myPanel = panels.myPanel || panel( 'myPanel', ... );`
	 *
	 * Returns the panel object for the new panel (or the currently displayed
	 * panel if called with no arguments).
	 * The panel object contains jQuery objects of the panel's parts, and methods
	 * for controlling the panel/dialog window.
	 */
	var panel = function( id, title, content, actions, onShow, cached ) {
		var $overlay, $dialog = $( '.spriteedit-dialog' );
		if ( !id ) {
			return panels[$dialog.data( 'active-panel' )];
		}
		
		var thisPanel = panels[id];
		if ( thisPanel ) {
			return thisPanel;
		}
		
		if ( !$dialog.length ) {
			$overlay = $( '<div>' ).addClass( 'spriteedit-dialog-overlay' ).css( 'display', 'none' );
			$dialog = $( '<div>' ).addClass( 'spriteedit-dialog' ).append(
				makeButton( '×', {
					id: 'spriteedit-dialog-close',
					props: { title: 'Close' },
					action: function() {
						panel().hide();
					}
				} )
			).appendTo( $overlay );
		}
		
		if ( content && !$.isArray( content ) ) {
			content = [ content ];
		}
		
		var $panel = $( '<div>' )
			.prop( 'id', 'spriteedit-dialog-' + id )
			.addClass( 'spriteedit-dialog-panel' );
		
		var $title = $( '<div>' ).addClass( 'spriteedit-dialog-title' ).text( title ).appendTo( $panel );
		
		var $text = $( '<div>' ).addClass( 'spriteedit-dialog-text' ).appendTo( $panel );
		
		if ( content ) {
			$text.append( content );
			
			// Keep content as the inital HTML for resetting
			content = $text.html();
		}
		
		var $actions;
		if ( actions ) {
			$actions = $( '<div>' ).addClass( 'spriteedit-dialog-actions' ).appendTo( $panel );
			var $leftActions = $( '<span>' ).appendTo( $actions );
			var $rightActions = $( '<span>' ).css( 'float', 'right' ).appendTo( $actions );
			var addButtons = function( buttons, right ) {
				if ( !buttons ) {
					return;
				}
				
				var $area = right ? $rightActions : $leftActions;
				if ( !$.isArray( buttons ) ) {
					buttons = [ buttons ];
				}
				$.each( buttons, function() {
					$area.append( makeButton( this.text, this.config ) );
				} );
			};
			
			addButtons( actions.left );
			addButtons( actions.right, true );
		}
		
		$dialog.append( $panel );
		
		if ( $overlay ) {
			$doc.append( $overlay );
		} else {
			$overlay = $dialog.parent();
		}
		
		$overlay.show();
		var titleHeight = $title.innerHeight();
		var actionsHeight;
		if ( actions ) {
			actionsHeight = $actions.innerHeight();
		}
		$panel.css( {
			paddingTop: titleHeight,
			paddingBottom: actionsHeight
		} );
		$title.css( 'margin-top', -titleHeight );
		if ( actions ) {
			$actions.css( 'margin-bottom', -actionsHeight );
		}
		if ( $overlay.css( 'opacity' ) === '0' ) {
			$overlay.hide();
		}
		$panel.hide();
		
		thisPanel = panels[id] = {
			$panel: $panel,
			$title: $title,
			$text: $text,
			$actions: $actions,
			show: function( callback ) {
				$dialog.css( { width: '', height: '' } );
				
				var prevPanel;
				if ( $overlay.css( 'opacity' ) === '1' ) {
					prevPanel = panel();
					// Remember to cleanup previous panel when the dialog is closed
					if ( prevPanel && !prevPanel.cached ) {
						prevPanel.cleanup = true;
					}
				}
				
				var oldRect;
				if ( prevPanel ) {
					oldRect = $dialog[0].getBoundingClientRect();
					prevPanel.$panel.hide();
				}
				$overlay.css( 'display', '' );
				$panel.css( 'display', '' );
				var newRect = $dialog[0].getBoundingClientRect();
				
				$dialog.transitionEnd( function() {
					if ( onShow ) {
						onShow.call( thisPanel );
					}
					if ( callback ) {
						callback.call( thisPanel );
					}
				} );
				
				if ( prevPanel ) {
					if ( oldRect.width === newRect.width && oldRect.height === newRect.height ) {
						// No transition to be made
						$dialog.css( {
							width: newRect.width,
							height: newRect.height
						} );
						
						$dialog.trigger( 'transitionend' );
					} else {
						$panel.css( 'display', 'none' );
						$dialog.css( {
							width: oldRect.width,
							height: oldRect.height
						} );
						setImmediate( function() {
							$dialog.css( {
								width: newRect.width,
								height: newRect.height
							} );
						} );
						
						$dialog.transitionEnd( function() {
							panelShown = true;
							$panel.css( 'display', '' );
						} );
						
						// Make sure the panel gets displayed
						var panelShown;
						setTimeout( function() {
							if ( panelShown ) {
								return;
							}
							
							$dialog.trigger( 'transitionend' );
						}, 1000 );
					}
				} else {
					setImmediate( function() {
						$overlay.css( 'opacity', 1 );
						$dialog
							.addClass( 'spriteedit-elastic' )
							.css( 'transform', 'scale(1)' )
							.transitionEnd( function() {
								$dialog.removeClass( 'spriteedit-elastic' );
							} );
					} );
				}
				
				$dialog.data( 'active-panel', id );
				
				return this;
			},
			hide: function( callback ) {
				if ( !$overlay.is( ':visible' ) ) {
					return this;
				}
				
				$dialog.css( 'transform', 'scale(0)' );
				$overlay.css( 'opacity', 0 ).transitionEnd( function() {
					// Reset scrollbar BEFORE hiding
					$text.scrollLeft( 0 );
					$text.scrollTop( 0 );
					
					$overlay.css( 'display', 'none' );
					thisPanel.$panel.css( 'display', 'none' );
					
					if ( !cached ) {
						thisPanel.cleanup = true;
					}
					$.each( panels, function() {
						if ( this.cleanup ) {
							this.clean();
						}
					} );
					
					if ( callback ) {
						callback.call( thisPanel );
					}
				} );
				
				return this;
			},
			clean: function() {
				$text.empty();
				
				if ( content ) {
					$text.append( content );
				}
				
				thisPanel.cleanup = false;
			},
			onShow: onShow,
			cached: cached
		};
		return thisPanel;
	};
	
	/**
	 * Creates a simple tooltip
	 *
	 * Used to create a small tooltip anchored to an element.
	 * Only a single tooltip can exist at a time (opening a new one will close the old)
	 * and clicking anywhere but the tooltip itself will close it.
	 *
	 * In the main function:
	 * "$elem" is a jQuery object which the tooltip should be anchored to.
	 * "content" is the content to go in the tooltip, and can be in whatever format can
	 * go into jQuery().append (jQuery objects, elements, HTML strings, etc.).
	 * "horizontal" is a boolean determining if the tooltip should open horizontally or vertically
	 * relative to its anchor.
	 * "callback" is a function called once the tooltip finishes its opening animation.
	 *
	 * In the tooltip.hide function:
	 * "callback" is a function called once the tooltip finishes its closing animation.
	 */
	var tooltip = ( function() {
		var $tooltip = $(), $anchor = $();
		
		$win.click( function( e ) {
			if (
				e.which === 1 &&
				$tooltip.length && !$tooltip.has( e.target ).length &&
				$tooltip.css( 'opacity' ) === '1'
			) {
				func.hide();
			}
		} );
		
		var func = function( $elem, content, horizontal, callback ) {
			if ( $tooltip.length ) {
				if ( $elem.is( $anchor ) ) {
					func.hide();
					return;
				}
				
				func.hide();
			}
			
			$anchor = $elem;
			$tooltip = $( '<div>' ).addClass( 'spriteedit-tooltip' ).append(
				$( '<div>' ).addClass( 'spriteedit-tooltip-text' ).append( content ),
				$( '<div>' ).addClass( 'spriteedit-tooltip-arrow' )
			).appendTo( $doc );
			
			var anchorPos = $anchor.offset();
			var docPos = $doc.offset();
			if ( horizontal ) {
				$tooltip.addClass( 'spriteedit-tooltip-horizontal' ).css( {
					top: anchorPos.top - docPos.top + $anchor.outerHeight() / 2,
					left: anchorPos.left - docPos.left - $tooltip.outerWidth()
				} );
			} else {
				$tooltip.css( {
					top: anchorPos.top - docPos.top - $tooltip.outerHeight(),
					left: anchorPos.left - docPos.left + $anchor.outerWidth() / 2
				} );
			}
			
			$tooltip.addClass( 'spriteedit-elastic' ).css( {
				opacity: 1,
				transform: 'scale(1)'
			} ).transitionEnd( function() {
				$( this ).removeClass( 'spriteedit-elastic' );
				
				if ( callback ) {
					callback.call( this );
				}
			} );
		};
		func.hide = function( callback ) {
			if ( !$tooltip.length ) {
				return;
			}
			
			$tooltip.off( 'transitionend.spriteEdit' ).css( {
				opacity: 0,
				transform: 'scale(0)'
			} ).transitionEnd( function() {
				$( this ).remove();
				
				if ( callback ) {
					callback.call( this );
				}
			} );
			
			$tooltip = $anchor = $();
		};
		
		return func;
	}() );
	
	/**
	 * Makes a set of elements sortable by dragging them
	 *
	 * The elements can either be dragged around to be sorted within or between
	 * each set manually or can be sorted in each set automatically, with dragging
	 * only being used to move them between sets.
	 *
	 * The "options" object contains:
	 * "selectors" is a string containing the selector of the set of elements to enable sorting,
	 * or an object containing containing additional selections to define the sortable element's parent
	 * and the sortable elements container (which elements can be sorted between).
	 * "handle" is a string containing the selector to find the element which the handle is a child of,
	 * in relation to the sortable element. Set if the handle is not a direct child of the sortable
	 * element.
	 * "vertical" is a boolean determining if the elements should only be able to be moved vertically.
	 * "autoSort" is a boolean determining if the elements should be sorted within their container
	 * automatically, only allowing elements to be manually moved between containers.
	 * "sortStart" is a callback function called after the placeholder and ghost elements are created,
	 * but prior to sorting actually beginning. "this" is set to the ghost element, and the first
	 * argument is set to the placeholder element if there is one.
	 * "sortEnd" is a callback function called after the element has been sorted, but prior to the
	 * placeholder and ghost elements being destroyed. Variables are set the same as "sortStart".
	 */
	var makeSortable = function( options ) {
		var selectors = options.selectors;
		var handle = options.handle || '';
		var vertical = options.vertical;
		var autoSort = options.autoSort;
		var selector = selectors;
		var $ghost = $(), $placeholder = $(), $hover = $(), $hoverParent = $();
		if ( typeof selectors !== 'string' ) {
			selector = selectors.parent + ' > ' + selectors.elem;
		}
		
		if ( pointerEventsSupported ) {
			if ( autoSort ) {
				$doc.on( 'mouseenter.spriteEdit', selectors.container, function() {
					if ( $ghost.length ) {
						$hoverParent = $( this ).css( 'outline', '1px dashed #000' );
					}
				} ).on( 'mouseleave.spriteEdit', selectors.container, function() {
					if ( $ghost.length ) {
						$hoverParent.css( 'outline', '' );
						$hoverParent = $();
					}
				} );
			} else {
				$doc.on( 'mouseenter.spriteEdit', selector, function() {
					if ( $ghost.length && !$( this ).is( $placeholder ) ) {
						$hover = $( this );
					}
				} ).on( 'mouseleave.spriteEdit', selector, function() {
					if ( $ghost.length ) {
						$hover = $();
					}
				} );
			}
		}
		
		$doc.on( 'mousedown.spriteEdit', selector + ' ' + handle + ' > .spriteedit-handle', function( e ) {
			if ( e.which !== 1 ) {
				return;
			}
			
			if ( handle ) {
				$ghost = $( this ).closest( selector );
			} else {
				$ghost = $( this ).parent();
			}
			
			if ( $ghost.find( '.spriteedit-new' ).length && $.trim( $ghost.text() ) === '' ) {
				$ghost = $();
				return;
			}
			
			tooltip.hide();
			
			// Keep the documentation from getting smaller to allow for overscroll
			$doc.css( 'min-height', $doc[0].getBoundingClientRect().height );
			
			var ghostElem = $ghost[0];
			
			if ( !autoSort ) {
				// We don't want to clone all the content, just the parent element
				$placeholder = $( '<' + ghostElem.nodeName + '>' )
					.addClass( ghostElem.className + ' spriteedit-placeholder' )
					.insertAfter( $ghost );
			}
			
			// Calculate cursor offset percentage to apply
			// after the ghost is resized to its correct size
			var ghostRect = ghostElem.getBoundingClientRect();
			var cursorOffset = {
				top: ( ghostRect.top - e.clientY ) / ghostRect.height,
				left: ( ghostRect.left - e.clientX ) / ghostRect.width
			};
			
			$ghost.addClass( 'spriteedit-ghost' ).css( {
				top: e.clientY,
				left: e.clientX
			} );
			
			// Apply offsets
			var newGhostRect = ghostElem.getBoundingClientRect();
			$ghost.css( {
				marginTop: newGhostRect.height * cursorOffset.top,
				marginLeft: newGhostRect.width * cursorOffset.left
			} );
			
			if ( options.sortStart ) {
				options.sortStart.call( ghostElem, $placeholder[0] );
			}
			
			// Must be set after callback for collapsing.
			if ( !autoSort ) {
				$placeholder.css( 'min-height', ghostElem.getBoundingClientRect().height );
			}
			
			$ghost.parent().mouseenter();
			
			// HACK: Fix IE8 selecting things while dragging
			$( document ).on( 'selectstart', function( e ) {
				e.preventDefault();
			} );
			
			sorting = true;
			$root.addClass( 'spriteedit-sorting' );
			
			requestAnimationFrame( mouseMove );
			
			e.preventDefault();
		} );
		
		var mouseMove = function() {
			if ( !$ghost.length ) {
				return;
			}
			requestAnimationFrame( mouseMove );
			
			if ( !mouse.moved ) {
				return;
			}
			mouse.moved = false;
			
			var pos = { top: mouse.y };
			if ( !vertical ) {
				pos.left = mouse.x;
			}
			$ghost.css( pos );
			
			if ( !pointerEventsSupported ) {
				// Emulate pointer-events:none
				$ghost.css( 'visibility', 'hidden' );
				var $nearest = $( document.elementFromPoint( mouse.x, mouse.y ) );
				if ( autoSort ) {
					$hoverParent.css( 'outline', '' );
					$hoverParent = $nearest.closest( selectors.container );
					$hoverParent.css( 'outline', '1px dashed #000' );
				} else {
					$hover = $nearest.closest( selector );
				}
				$ghost.css( 'visibility', '' );
			}
			
			if ( $hover.length ) {
				var side = 'Before';
				if ( $hover.index() > $placeholder.index() ) {
					side = 'After';
				}
				$placeholder['insert' + side]( $hover );
				$hover = $();
			}
		};
		
		$( document ).on( 'mouseup.spriteEdit', function( e ) {
			if ( e.which !== 1 || !$ghost.length ) {
				return;
			}
			
			var index = -1;
			if ( autoSort ) {
				if ( $hoverParent.length && !$ghost.closest( selectors.container ).is( $hoverParent ) ) {
					var text = $ghost.attr( 'data-sort-key' ) || $ghost.text();
					index = getAlphaIndex( text, undefined, $hoverParent.find( selectors.parent ) );
				}
			} else {
				index = $placeholder.index();
			}
			
			if (
				index > -1 && (
					index - 1 !== $ghost.index() ||
					autoSort && $hoverParent.length &&
					!$ghost.closest( selectors.container ).is( $hoverParent )
				)
			) {
				// If the last name is moved, delete its box
				if ( $ghost.hasClass( 'spritedoc-name' ) && !$ghost.siblings().length ) {
					var $box = $ghost.closest( selectors.container );
					change( 'delete', {
						$elem: $box,
						index: $box.index() - 1,
						$parent: $box.parent()
					}, true );
				}
				
				change( 'insert', {
					$elem: $ghost,
					oldIndex: $ghost.index() - 1,
					$oldParent: $ghost.parent(),
					index: index - 1,
					$parent: $hoverParent.length && $hoverParent.find( selectors.parent ) ||
						$placeholder.parent()
				} );
			}
			
			$ghost.removeAttr( 'style' ).removeClass( 'spriteedit-ghost' );
			$hoverParent.css( 'outline', '' );
			$doc.css( 'min-height', '' );
			
			if ( options.sortEnd ) {
				options.sortEnd.call( $ghost[0], $placeholder[0] );
			}
			
			$placeholder.remove();
			$ghost = $placeholder = $hover = $hoverParent = $();
			
			// Remove IE8 hack
			$( document ).off( 'selectstart' );
			
			sorting = false;
			$root.removeClass( 'spriteedit-sorting' );
		} );
	};
	
	/**
	 * Allows repeatable changes to be performed, which can be undone and redone
	 *
	 * The main function performs a change of a particular type.
	 * "action" is the type of change this is:
	 * * "edit" is changes to text (anything contentEditable)
	 * * "insert" is any element being inserted, either fresh from the aether or taken
	 *   from somewhere else in the document.
	 * * "delete" is any element being removed from the document.
	 * * "replace image" is when an image is replaced with a new image.
	 * * "reset image" is when an image is reset to the original image in the sprite sheet.
	 * "content" is an object containing anything necessary to describe the change, including
	 * details to revert the change.
	 * "queueChange" is a boolean determining if the change should be queued rather than committed
	 * to history immediately. This allows multiple changes to be grouped as one history event. Note
	 * that making a change which isn't queued will commit any currently queued changes to history
	 * along with itself.
	 * "oldChange" is a boolean determining if this change shouldn't be queued. Intended mainly for
	 * undoing/redoing.
	 *
	 * The change.commit function allows queued changes to be committed to history.
	 * The change.discard function allows queued changes to be discarded, although the changes
	 * are not reverted.
	 */
	var change = ( function() {
		var queue = [];
		var func = function( action, content, queueChange, oldChange ) {
			switch ( action ) {
				case 'edit':
					if ( oldChange ) {
						content.$elem.text( content.text );
					}
					
					if ( content.$elem.parent().hasClass( 'spritedoc-name' ) ) {
						updateName( content.oldText, content.text, content.$elem );
					}
				break;
				
				case 'insert':
					var moved = content.$elem.parent().length;
					var isBox = content.$elem.hasClass( 'spritedoc-box' );
					var $oldBox = !isBox && content.$elem.closest( '.spritedoc-box' );
					
					if ( content.index === -1 ) {
						content.$parent.prepend( content.$elem );
					} else {
						content.$parent.children().eq( content.index ).after( content.$elem );
					}
					
					if ( !moved && isBox ) {
						content.$elem.find( '.spritedoc-name' ).find( 'code' ).each( function() {
							updateName( undefined, $( this ).text(), $( this ) );
						} );
					} else if ( content.$elem.hasClass( 'spritedoc-name' ) ) {
						if ( moved ) {
							var $box = content.$elem.closest( '.spritedoc-box' );
							if ( !$box.is( $oldBox ) ) {
								updateBoxSorting( $oldBox );
							}
							updateBoxSorting( $box );
						} else {
							var $code = content.$elem.find( 'code' );
							updateName( undefined, $code.text(), $code );
						}
					}
					
					setImmediate( function() {
						scrollIntoView( content.$elem );
					} );
				break;
				
				case 'delete':
					var isBox = content.$elem.hasClass( 'spritedoc-box' );
					var $box = !isBox && content.$elem.closest( '.spritedoc-box' );
					
					content.$elem.detach();
					
					if ( isBox ) {
						content.$elem.find( '.spritedoc-name' ).find( 'code' ).each( function() {
							updateName( $( this ).text(), undefined, $( this ) );
						} );
					} else if ( content.$elem.hasClass( 'spritedoc-name' ) ) {
						var $code = content.$elem.find( 'code' );
						updateName( $code.text(), undefined, $code );
						updateBoxSorting( $box );
					}
				break;
				
				case 'replace image':
					var $box = content.$parent.parent();
					if ( content.$oldImg && content.$oldImg.length ) {
						content.$oldImg.detach();
					} else {
						$box.addClass( 'spriteedit-new' );
						content.$parent.children().css( 'display', 'none' );
					}
					content.$parent.append( content.$elem );
					modified.sheet = true;
				break;
				
				case 'reset image':
					content.$elem.detach();
					content.$parent.children().css( 'display', '' );
					content.$parent.parent().removeClass( 'spriteedit-new' );
					
					if ( !$doc.find( '.spriteedit-new' ).length ) {
						modified.sheet = false;
					}
				break;
			}
			
			var hist = { action: action, content: content };
			if ( !oldChange ) {
				queue.push( hist );
				if ( !queueChange ) {
					func.commit();
				}
			}
			
			// Preemptively enable the save button
			$( '#spriteedit-save' ).prop( 'disabled', false );
		};
		func.commit = function() {
			addHistory( queue );
			
			func.discard();
		};
		func.discard = function() {
			queue = [];
			
			if ( !changes.length ) {
				$( '#spriteedit-save' ).prop( 'disabled', true );
			}
		};
		
		return func;
	}() );
	
	/**
	 * Adds a change to history
	 *
	 * Handles enabling the save and undo button, disabling the redo button,
	 * releasing undone object URLs, and deleting the undone changes.
	 */
	var addHistory = function( actions ) {
		changes.push( actions );
		
		if ( undoneChanges.length ) {
			// Release now unusable image URLs
			$.each( undoneChanges, function() {
				if ( this.action === 'replace image' ) {
					URL.revokeObjectURL( this.content.$elem.attr( 'src' ) );
				}
			} );
			
			undoneChanges = [];
			
			$( '#spriteedit-redo' ).prop( 'disabled', true );
		}
		
		$( '#spriteedit-undo' ).add( '#spriteedit-save' ).prop( 'disabled', false );
	};
	
	/**
	 * Reverts a change
	 *
	 * Takes a previously stored history entry and performs the necessary change
	 * to revert it.
	 */
	var revert = function( hist ) {
		// Invert the history entry's changes to revert it
		var i = hist.length, histChange, content;
		while ( i-- ) {
			histChange = hist[i];
			content = histChange.content;
			switch( histChange.action ) {
				case 'edit':
					change( 'edit', {
						$elem: content.$elem,
						text: content.oldText,
						oldText: content.text
					}, false, true );
				break;
				
				case 'insert':
					if ( content.$oldParent ) {
						change( 'insert', {
							$elem: content.$elem,
							index: content.oldIndex,
							$parent: content.$oldParent
						}, false, true );
					} else {
						change( 'delete', {
							$elem: content.$elem,
							$parent: content.$parent
						}, false, true );
					}
				break;
				
				case 'delete':
					change( 'insert', {
						$elem: content.$elem,
						index: content.index,
						$parent: content.$parent
					}, false, true );
				break;
				
				case 'replace image':
					if ( content.$oldImg.length ) {
						change( 'replace image', {
							$elem: content.$oldImg,
							$parent: content.$parent,
							$oldImg: content.$elem
						}, false, true );
					} else {
						change( 'reset image', content, false, true );
					}
				break;
				
				case 'reset image':
					change( 'replace image', content, false, true );
				break;
			}
		}
		
		if ( !changes.length ) {
			$( '#spriteedit-undo' ).add( '#spriteedit-save' ).prop( 'disabled', true );
		}
	};
	
	/**
	 * Updates the list of names for duplicate detection
	 *
	 * Also sorts the names and box if necessary.
	 */
	var updateName = function( oldText, newText, $elem ) {
		if ( oldText ) {
			var oldNames = names[oldText];
			if ( oldNames.length === 1 ) {
				delete names[oldText];
			} else {
				$.each( oldNames, function( i ) {
					if ( $elem.is( this ) ) {
						oldNames.splice( i, 1 );
						return false;
					}
				} );
				if ( oldNames.length === 1 ) {
					oldNames[0].removeClass( 'spriteedit-dupe' );
				}
			}
		}
		
		var $item = $elem.parent();
		var oldIndex = $item.index();
		if ( newText ) {
			var newNames = names[newText];
			if ( !newNames ) {
				newNames = names[newText] = [];
				$elem.removeClass( 'spriteedit-dupe' );
			} else {
				if ( newNames.length === 1 ) {
					newNames[0].addClass( 'spriteedit-dupe' );
				}
				$elem.addClass( 'spriteedit-dupe' );
			}
			newNames.push( $elem );
			
			var $parent = $item.parent();
			var index = getAlphaIndex( newText, $item );
			if ( index !== oldIndex ) {
				change( 'insert', {
					$elem: $item,
					oldIndex: oldIndex - 1,
					$oldParent: $parent,
					index: index - 1,
					$parent: $parent
				}, false, true );
			} else if ( index === 0 ) {
				updateBoxSorting( $item.closest( '.spritedoc-box' ) );
			}
		}
	};
	
	/**
	 * Update's the box's sort key and sorts it.
	 */
	var updateBoxSorting = function( $box ) {
		var name = $box.find( '.spritedoc-name' ).first().text();
		var oldName = $box.attr( 'data-sort-key' );
		if ( name === oldName ) {
			return;
		}
		
		$box.attr( 'data-sort-key', name );
		
		var $parent = $box.parent();
		var oldIndex = $box.index();
		var index = getAlphaIndex( name, $box );
		if ( index !== oldIndex ) {
			change( 'insert', {
				$elem: $box,
				oldIndex: oldIndex - 1,
				$oldParent: $parent,
				index: index - 1,
				$parent: $parent
			}, false, true );
		}
	};
	
	/**
	 * Handles generic API errors
	 *
	 * Just uselessly displays whatever error the API returns.
	 * Hopefully the user can retry whatever they were doing.
	 *
	 * "code" and "data" are the standard variables returned by a mw.Api promise rejection.
	 */
	var handleError = function( code, data ) {
		var errorPanel = panels.error || panel(
			'error',
			'Error'
		);
		
		var errorText;
		if ( code === 'http' ) {
			if ( data.textStatus === 'error' ) {
				errorText = 'Connection error';
			} else {
				errorText = 'HTTP error: ' + data.textStatus;
			}
		} else {
			errorText = 'API error: ' + data.error.info;
		}
		errorPanel.$text.text( errorText );
		
		errorPanel.show();
	};
	
	/**
	 * Destroys the editor
	 *
	 * Removes any controls, and unbinds all events in the spriteEdit namespace, and releases
	 * object URLs.
	 *
	 * "restore" is a boolean determining if the documentation should be restored to how it was
	 * prior to opening the editor.
	 * "leaveUrl" is a boolean determining if a the page URL shouldn't be updated to remove the
	 * spriteedit action. Used for when the editor is destroyed due to history navigation.
	 */
	var destroy = function( restore, leaveUrl ) {
		$win.add( document ).off( '.spriteEdit' );
		
		if ( !leaveUrl ) {
			if ( historySupported ) {
				history.pushState( {}, '', mw.util.getUrl() );
			} else if ( location.search.match( 'spriteaction=edit' ) ) {
				location = mw.util.getUrl();
			}
		}
		
		$root.removeClass( 'spriteedit-loaded spriteedit-enabled spriteedit-imageeditingenabled' );
		
		var $viewTab = $( '#ca-view' );
		$viewTab.add( '#ca-spriteedit' ).toggleClass( 'selected' );
		
		$doc.add( $viewTab.find( 'a' ) ).off( '.spriteEdit' );
		
		$( '.mw-editsection' ).add( '.mw-editsection-like' ).css( 'display', '' );
		
		// Release old image URL references
		if ( modified.sheet ) {
			$.each( changes, function() {
				if ( this.action === 'replace image' ) {
					URL.revokeObjectURL( this.content.$oldImg.attr( 'src' ) );
				}
			} );
		}
		
		if ( restore ) {
			// Release current image URL references
			if ( modified.sheet ) {
				$doc.find( '.spritedoc-image' ).find( 'img' ).each( function() {
					URL.revokeObjectURL( this.src );
				} );
			}
			
			$doc.html( oldHtml );
			return;
		}
		
		$doc.find( '.mw-headline' ).add( $doc.find( '.spritedoc-name' ).find( 'code' ) )
			.removeAttr( 'contenteditable' );
		
		$.each( [
			'.spriteedit-toolbar-container',
			'.spriteedit-handle',
			'.spriteedit-add-name',
			'.spriteedit-tooltip',
			'.spriteedit-dialog-overlay'
		], function() {
			$( this ).remove();
		} );
		
		$( '.spriteedit-new' ).removeClass( '.spriteedit-new' ).each( function() {
			var newPos = $( this ).data( 'new-pos' );
			if ( newPos !== undefined ) {
				$( this ).data( 'pos', newPos ).removeData( 'new-pos' );
			}
		} );
	};
};

/** Utility functions **/
/**
 * Allows calling a function when a main transition ends
 *
 * This only listens to transitions that happen on the element this is
 * called on, ignoring transitions bubbling from its children.
 * Additionally, if the browser doesn't support transitions, the callback
 * will be called immediately.
 *
 * The callback is passed along the "this" and "event" object from the event.
 */
$.fn.transitionEnd = function( callback ) {
	if ( supports( 'transition' ) ) {
		this.on( 'transitionend.spriteEdit', function( e ) {
			var $elem = $( this );
			if ( !$elem.is( e.target ) ) {
				return;
			}
			
			callback.call( this, e );
			
			$elem.off( 'transitionend.spriteEdit' );
		} );
	} else {
		callback.call( this );
	}
	
	return this;
};

/**
 * Returns the index to move an element to to sort it alphabetically, ignoring case
 *
 * "text" is the string to sort by.
 * "$elem" is the jQuery object which is to be sorted
 * "$parent" is the jQuery object which is the parent of the elements which "text" will be sorted by.
 *
 * Use "$elem" when sorting an element by its siblings.
 * Use "$parent" when sorting an element in a different container.
 */
var getAlphaIndex = function( text, $elem, $parent ) {
	var index;
	var $items = $parent && $parent.children() || $elem.siblings();
	$items.each( function() {
		var $this = $( this );
		var compare = $this.attr( 'data-sort-key' ) || $this.text();
		if ( text.toLowerCase() < compare.toLowerCase() ) {
			index = $this.index();
			return false;
		}
	} );
	if ( index === undefined ) {
		if ( $items.length ) {
			index = $items.length;
			if ( !$parent ) {
				index++;
			}
		} else {
			index = 0;
		}
	}
	
	// Account for trying to sort the element after itself
	if ( !$parent && index - 1 === $elem.index() ) {
		index--;
	}
	
	return index;
};

/**
 * Attempts to scroll an element into view
 *
 * Takes into account the portion of window obscured by the toolbar.
 * Flashes the element's background yellow for a moment to bring it to attention.
 *
 * "$elem" is the jQuery object to scroll to.
 * "instant" is a boolean determining if the scrolling should be instant, instead of smooth
 * (if the browser supports smooth scrolling in the first place, that is).
 */
var scrollIntoView = function( $elem, instant ) {
	var elemRect = $elem[0].getBoundingClientRect();
	var scrollPos;
	if ( elemRect.top < 65 ) {
		scrollPos = elemRect.top + $win.scrollTop() - 65;
	} else {
		var winHeight = $win.height() - 40;
		if ( elemRect.height > winHeight || elemRect.bottom < winHeight ) {
			return;
		}
		scrollPos = elemRect.bottom + $win.scrollTop() - winHeight;
	}
	
	if ( !instant ) {
		$root.addClass( 'spriteedit-smoothscroll' );
	}
	
	scroll( 0, scrollPos );
	$elem.css( 'background-color', 'yellow' );
	setTimeout( function() {
		$elem.css( 'background-color', '' );
	}, 1000 );
};

/**
 * Picks the section which is probably the section the user wants to put things
 *
 * Mainly based on the section closest to the top of the screen,
 * but prefers elements which are not at all going off the screen
 * (accounting for the space taken up by the toolbar).
 *
 * Returns the section element
 */
var nearestSection = function() {
	var offscreen, prox, elem;
	$doc.find( '.spritedoc-section' ).each( function() {
		var curPos = this.getBoundingClientRect().top - 35;
		var curProx = Math.abs( curPos );
		if ( prox && curProx > prox ) {
			// Prefer on-screen section, even if it is further from the top
			if ( offscreen ) {
				elem = this;
			}
			
			return false;
		}
		
		offscreen = curPos < 0;
		prox = curProx;
		elem = this;
	} );
	
	return elem;
};

/**
 * Converts the extended ISO timestamp returned by the API
 * into the basic version used by the rest of MediaWiki
 *
 * YYYY-MM-DDTHH:MM:SSZ -> YYYYMMDDHHMMSS
 */
var fixTimestamp = function( timestamp ) {
	return timestamp.replace( /[\-T:Z]/g, '' );
};

/**
 * Quote a string for lua table
 *
 * Uses either ' or " as the delimiter (depending on which is least used in the string),
 * then escapes \ and the chosen delimiter within the string.
 */
var luaStringQuote = function( str ) {
	var quotes = ( str.match( /"/g ) || [] ).length;
	var apostrophies = ( str.match( /'/g ) || [] ).length;
	var delim = "'";
	var delimRegex = /'/g;
	if ( apostrophies > quotes ) {
		delim = '"';
		delimRegex = /"/g;
	}
	
	return delim + str.replace( /\\/g, '\\\\' ).replace( delimRegex, '\\' + delim ) + delim;
};

/**
 * Add various types of in-page controls to a set of elements
 *
 * "$elems" is a jQuery object containing the elements to add controls to.
 * "type" is the type of controls to add.
 */
var addControls = function( $elems, type ) {
	switch ( type ) {
		case 'heading':
			$elems.prepend( $( '<span>' ).addClass( 'spriteedit-handle' ) )
				.find( '.mw-headline' ).attr( 'contenteditable', true );
		break;
		case 'box':
			$elems.prepend(
				$( '<span>' ).addClass( 'spriteedit-handle' ),
				$( '<span>' ).addClass( 'spriteedit-add-name' ).append(
					makeButton( 'New name', { type: 'progressive' } )
				)
			);
			addControls( $elems.find( '.spritedoc-name' ), 'name' );
		break;
		case 'name':
			$elems.prepend( $( '<span>' ).addClass( 'spriteedit-handle' ) )
				.find( 'code' ).attr( 'contenteditable', true );
		break;
	}
};

/**
 * Create a MW UI button element
 *
 * "text" is the string displayed on the button.
 * "config" is an object defining various properties of the button:
 * * "type" is a string or array of strings defining the MW UI types
 *   this button should be (e.g.: progressive, destructive, constructive, quiet).
 * * "id" is the id attribute applied to the button.
 * * "props" is an object of properties applied to the button.
 * * "css" is the inline styling applied to the button.
 * * "action" is a function called when the button is clicked.
 */
var makeButton = function( text, config ) {
	var $button = $( '<button>' ).addClass( 'mw-ui-button' );
	var type = config.type || [];
	
	if ( !$.isArray( type ) ) {
		type = [ type ];
	}
	$.each( type, function() {
		$button.addClass( 'mw-ui-' + this );
	} );
	
	if ( config.id ) {
		$button.prop( 'id', config.id );
	}
	
	$button
		.prop( config.props || {} )
		.css( config.css || {} )
		.text( text )
		.click( config.action );
	
	return $button;
};

/**
 * Check if a CSS property or value is supported by the browser
 */
var supports = function( prop, val ) {
	if ( !val ) {
		return prop in $root[0].style;
	}
	
	if ( window.CSS && CSS.supports ) {
		return CSS.supports( prop, val );
	}
	if ( window.supportsCSS ) {
		return supportsCSS( prop, val );
	}
	
	var camelProp = prop.replace( /-([a-z]|[0-9])/ig, function( _, chr ) {
		return chr.toUpperCase();
	} );
	var elStyle = document.createElement( 'i' ).style;
	elStyle.cssText = prop + ':' + val;
	return elStyle[camelProp] !== '';
};


/** Polyfills **/
// requestAnimationFrame
( function() {
	var vendors = [ 'webkit', 'moz' ];
	for ( var i = 0; i < vendors.length && !window.requestAnimationFrame; ++i ) {
		var vp = vendors[i];
		window.requestAnimationFrame = window[vp + 'RequestAnimationFrame'];
		window.cancelAnimationFrame = window[vp + 'CancelAnimationFrame'] ||
			window[vp + 'CancelRequestAnimationFrame'];
	}
	if ( !window.requestAnimationFrame || !window.cancelAnimationFrame ) {
		var lastTime = 0;
		window.requestAnimationFrame = function( callback ) {
			var now = +new Date();
			var nextTime = Math.max( lastTime + 16, now );
			return setTimeout(
				function() { callback( lastTime = nextTime ); },
				nextTime - now
			);
		};
		window.cancelAnimationFrame = clearTimeout;
	}
}() );

// setImmediate
(function (global, undefined) {
	if (global.setImmediate) {
		return;
	}

	var nextHandle = 1; // Spec says greater than zero
	var tasksByHandle = {};
	var currentlyRunningATask = false;
	var doc = global.document;
	var setImmediate;

	function addFromSetImmediateArguments(args) {
		tasksByHandle[nextHandle] = partiallyApplied.apply(undefined, args);
		return nextHandle++;
	}

	// This function accepts the same arguments as setImmediate, but
	// returns a function that requires no arguments.
	function partiallyApplied(handler) {
		var args = [].slice.call(arguments, 1);
		return function() {
			if (typeof handler === "function") {
				handler.apply(undefined, args);
			} else {
				(new Function("" + handler))();
			}
		};
	}

	function runIfPresent(handle) {
		// From the spec: "Wait until any invocations of this algorithm started before this one have completed."
		// So if we're currently running a task, we'll need to delay this invocation.
		if (currentlyRunningATask) {
			// Delay by doing a setTimeout. setImmediate was tried instead, but in Firefox 7 it generated a
			// "too much recursion" error.
			setTimeout(partiallyApplied(runIfPresent, handle), 0);
		} else {
			var task = tasksByHandle[handle];
			if (task) {
				currentlyRunningATask = true;
				try {
					task();
				} finally {
					clearImmediate(handle);
					currentlyRunningATask = false;
				}
			}
		}
	}

	function clearImmediate(handle) {
		delete tasksByHandle[handle];
	}

	function installNextTickImplementation() {
		setImmediate = function() {
			var handle = addFromSetImmediateArguments(arguments);
			process.nextTick(partiallyApplied(runIfPresent, handle));
			return handle;
		};
	}

	function canUsePostMessage() {
		// The test against `importScripts` prevents this implementation from being installed inside a web worker,
		// where `global.postMessage` means something completely different and can't be used for this purpose.
		if (global.postMessage && !global.importScripts) {
			var postMessageIsAsynchronous = true;
			var oldOnMessage = global.onmessage;
			global.onmessage = function() {
				postMessageIsAsynchronous = false;
			};
			global.postMessage("", "*");
			global.onmessage = oldOnMessage;
			return postMessageIsAsynchronous;
		}
	}

	function installPostMessageImplementation() {
		// Installs an event handler on `global` for the `message` event: see
		// * https://developer.mozilla.org/en/DOM/window.postMessage
		// * http://www.whatwg.org/specs/web-apps/current-work/multipage/comms.html#crossDocumentMessages

		var messagePrefix = "setImmediate$" + Math.random() + "$";
		var onGlobalMessage = function(event) {
			if (event.source === global &&
				typeof event.data === "string" &&
				event.data.indexOf(messagePrefix) === 0) {
				runIfPresent(+event.data.slice(messagePrefix.length));
			}
		};

		if (global.addEventListener) {
			global.addEventListener("message", onGlobalMessage, false);
		} else {
			global.attachEvent("onmessage", onGlobalMessage);
		}

		setImmediate = function() {
			var handle = addFromSetImmediateArguments(arguments);
			global.postMessage(messagePrefix + handle, "*");
			return handle;
		};
	}

	function installMessageChannelImplementation() {
		var channel = new MessageChannel();
		channel.port1.onmessage = function(event) {
			var handle = event.data;
			runIfPresent(handle);
		};

		setImmediate = function() {
			var handle = addFromSetImmediateArguments(arguments);
			channel.port2.postMessage(handle);
			return handle;
		};
	}

	function installReadyStateChangeImplementation() {
		var html = doc.documentElement;
		setImmediate = function() {
			var handle = addFromSetImmediateArguments(arguments);
			// Create a <script> element; its readystatechange event will be fired asynchronously once it is inserted
			// into the document. Do so, thus queuing up the task. Remember to clean up once it's been called.
			var script = doc.createElement("script");
			script.onreadystatechange = function () {
				runIfPresent(handle);
				script.onreadystatechange = null;
				html.removeChild(script);
				script = null;
			};
			html.appendChild(script);
			return handle;
		};
	}

	function installSetTimeoutImplementation() {
		setImmediate = function() {
			var handle = addFromSetImmediateArguments(arguments);
			setTimeout(partiallyApplied(runIfPresent, handle), 0);
			return handle;
		};
	}

	// If supported, we should attach to the prototype of global, since that is where setTimeout et al. live.
	var attachTo = Object.getPrototypeOf && Object.getPrototypeOf(global);
	attachTo = attachTo && attachTo.setTimeout ? attachTo : global;

	// Don't get fooled by e.g. browserify environments.
	if ({}.toString.call(global.process) === "[object process]") {
		// For Node.js before 0.9
		installNextTickImplementation();

	} else if (canUsePostMessage()) {
		// For non-IE10 modern browsers
		installPostMessageImplementation();

	} else if (global.MessageChannel) {
		// For web workers, where supported
		installMessageChannelImplementation();

	} else if (doc && "onreadystatechange" in doc.createElement("script")) {
		// For IE 6–8
		installReadyStateChangeImplementation();

	} else {
		// For older browsers
		installSetTimeoutImplementation();
	}

	attachTo.setImmediate = setImmediate;
	attachTo.clearImmediate = clearImmediate;
}(window));

// Add width and height to Element.getBoundingClientRect() in IE < 8
if ( window.TextRectangle && !TextRectangle.prototype.width ) {
	Object.defineProperty( TextRectangle.prototype, 'width', {
		get: function() { return this.right - this.left; }
	} );
	Object.defineProperty( TextRectangle.prototype, 'height', {
		get: function() { return this.bottom - this.top; }
	} );
}

// Element.firstElementChild and Element.nextElementSibling
if ( !( 'firstElementChild' in $root[0] ) ) {
	Object.defineProperty( Element.prototype, 'firstElementChild', {
		get: function() {
			var el = this.firstChild;
			while ( el ) {
				if ( el.nodeType === 1 ) {
					return el;
				}
				el = el.nextSibling;
			}
			return null;
		}
	} );
	
	Object.defineProperty( Element.prototype, 'nextElementSibling', {
		get: function() {
			var el = this.nextSibling;
			while ( el ) {
				if ( el.nodeType === 1 ) {
					return el;
				}
				el = el.nextSibling;
			}
			return null;
		}
	} );
}


// Finally start the editor
mw.loader.using( [
	'mediawiki.util',
	'mediawiki.api',
	'user.options',
	'jquery.throttle-debounce'
], function() {
	create( 'initial' );
} );


}() );
