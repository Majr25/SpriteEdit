( function() {
'use strict';

/** "Global" vars (preserved between editing sessions) **/
var i18n = {
	blockedNotice: 'You cannot edit this sprite as you are blocked.',
	blockedReason: 'Reason: $1',
	browserActionNotSupported: 'Not supported by your browser.',
	changesSavedNotice: 'Your changes were saved.',
	controlNewName: 'New name',
	ctxDeleteImage: 'Delete',
	ctxDownloadImage: 'Download',
	ctxReplaceImage: 'Replace',
	diffError: 'Failed to retrieve diff',
	diffErrorMissingPage: 'Failed to retrieve page',
	dupeName: 'This name already exists.',
	dupeNamesNotice: 'There are duplicate names which must be resolved prior to saving.',
	errorApi: 'API error',
	errorConnection: 'Connection error',
	errorConnectionText: 'Check your internet connection',
	errorGeneric: 'Error',
	errorHttp: 'HTTP error',
	genericError: 'Something went wrong',
	luaKeyDeprecated: 'deprecated',
	luaKeyId: 'id',
	luaKeyIds: 'ids',
	luaKeyPos: 'pos',
	luaKeySection: 'section',
	luaKeySections: 'sections',
	namePlaceholder: 'Type a name',
	noPermissionNotice: 'You do not have permission to edit this sprite.',
	panelChangesIdTitle: 'ID changes',
	panelChangesNoDiffFromCur: 'No changes from current revision.',
	panelChangesSheetTitle: 'Spritesheet changes',
	panelChangesTitle: 'Review your changes',
	panelCloseTip: 'Close',
	panelConflictCurText: 'Current text',
	panelConflictReview: 'Review changes',
	panelConflictSave: 'Save',
	panelConflictText: 'An edit conflict has occurred, and was not able to be resolved automatically.',
	panelConflictTitle: 'Edit conflict',
	panelConflictYourText: 'Your text',
	panelDiscardContinue: 'Keep editing',
	panelDiscardDiscard: 'Discard changes',
	panelDiscardText: 'Are you sure you wish to discard your changes?',
	panelDiscardTitle: 'Unsaved changes',
	panelEcchangesReturn: 'Return to edit conflict form',
	panelEcchangesTitle: 'Review your manual changes',
	sectionPlaceholder: 'Type a section name',
	sectionUncategorized: 'Uncategorized',
	titleEditing: 'Sprite editing $1',
	toolbarNewImage: 'New image',
	toolbarNewSection: 'New section',
	toolbarRedo: 'Redo',
	toolbarReviewChanges: 'Review changes',
	toolbarSave: 'Save',
	toolbarSummaryPlaceholder: 'Summarize the changes you made',
	toolbarSummaryLabelTip: 'The number of bytes remaining',
	toolbarToolDeprecate: 'Deprecate',
	toolbarToolDeprecateTip: 'Toggle names as deprecated',
	toolbarTools: 'Tools',
	toolbarUndo: 'Undo',
};
var $root = $( document.documentElement );
var $win = $( window );
var $doc = $( '#spritedoc' );
var inlineStyle;
var URL = window.URL || window.webkitURL;
var imageEditingSupported = !!( window.FileList &&
	window.ArrayBuffer &&
	window.Blob &&
	window.FormData &&
	window.ProgressEvent &&
	URL && URL.revokeObjectURL && URL.createObjectURL &&
	document.createElement( 'canvas' ).getContext );
var dropSupported = 'draggable' in $root[0];
var historySupported = window.history && history.pushState;
// HTML pointer-events is dumb and can't be tested for
// Just check that we're not IE < 11, old Opera has too little usage to bother checking for
var pointerEventsSupported = $.client.profile().name !== 'msie' || $.client.profile().versionBase > 10;
var idsPageId = $doc.data( 'idspage' );
var originalTitle = document.title;


// Start loading OOUI's icons in the background
mw.loader.load( [ 'oojs-ui.styles.icons-content', 'oojs-ui.styles.icons-editing-advanced', 'oojs-ui.styles.icons-media', 'oojs-ui.styles.icons-moderation' ] );

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
			location.search.match( '[?&]spriteaction=edit' ) &&
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
	var preventClose;
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
	var usedNames = {};
	var loadingImages = [];
	var panels = {};
	var canTag = null;
	
	// Update the title to say we're editing
	document.title = i18n.titleEditing.replace( /\$1/g, originalTitle );
	
	var revisionsApi = new mw.Api( { parameters: {
		action: 'query',
		prop: 'revisions',
		rvprop: 'content',
		utf8: true,
	} } );
	var parseApi = new mw.Api( { parameters: {
		action: 'parse',
		prop: 'text',
		disablepp: true,
		disabletoc: true,
		utf8: true,
	} } );
	var $headingTemplate = $( '<h3>' ).html(
		$( '<span>' )
			.addClass( 'mw-headline spriteedit-new' )
			.attr( 'data-placeholder', i18n.sectionPlaceholder )
	);
	var $boxTemplate = $( '<li>' ).addClass( 'spritedoc-box spriteedit-new' ).append(
		$( '<div>' ).addClass( 'spritedoc-image' ),
		$( '<ul>' ).addClass( 'spritedoc-names' ).append(
			$( '<li>' ).addClass( 'spritedoc-name' ).html( '<code>' )
		)
	);
	addControls( $headingTemplate, 'heading' );
	addControls( $boxTemplate, 'box' );
	
	// Pre-load modules which will be needed later
	var saveModules = mw.loader.using( [ 'jquery.byteLimit', 'mediawiki.action.history.diff' ] );
	
	$root.addClass( 'spriteedit-loaded' );
	
	if ( !state && historySupported ) {
		history.pushState( {}, '', mw.util.getUrl( null, { spriteaction: 'edit' } ) );
	}
	if ( state !== 'initial' ) {
		$( '#ca-view' ).add( '#ca-spriteedit' ).toggleClass( 'selected' );
	}
	
	if ( imageEditingSupported ) {
		var $sprite = $doc.find( '.sprite' ).first();
		settings.imageWidth = $sprite.width();
		settings.imageHeight = $sprite.height();
		settings.sheet = $doc.data( 'original-url' );
		settings.spacing = $doc.data( 'spacing' );
		if ( !settings.sheet ) {
			settings.sheet = $sprite.css( 'background-image' )
				.replace( /^url\(["']?/, '' ).replace( /["']?\)$/, '' );
			$doc.data( 'original-url', settings.sheet );
		}
		settings.sheet += ( settings.sheet.match( /\?/ ) ? '&' : '?' ) + Date.now();
		
		// Cloudfront doesn't allow CORS, so temporarily go through a server that does
		settings.sheet = 'https://matt-russell.com/cloudfront.php?url=' + encodeURIComponent( settings.sheet );
		
		// Replace the spritesheet with a fresh uncached one to ensure
		// we don't save over it with an old version.
		// XHR is used instead of a CORS Image so a blob URL can
		// be used for the background image, rather than the real URL.
		// This works around the image being downloaded twice, probably
		// caused by the background image not reusing the CORS request.
		var sheetRequest = retryableRequest( function() {
			var deferred = $.Deferred();
			var requestTimeout;
			var xhr = new XMLHttpRequest();
			xhr.open( 'GET', settings.sheet, true );
			xhr.responseType = 'blob';
			xhr.onload = function() {
				clearTimeout( requestTimeout );
				if ( this.status !== 200 ) {
					deferred.reject( 'http', {
						textStatus: this.statusText ? this.status + ' ' + this.statusText : 'error'
					} );
					return;
				}
				
				spritesheet = new Image();
				spritesheet.onload = function() {
					settings.sheetWidth = this.width;
					settings.sheetHeight = this.height;
					
					if ( inlineStyle ) {
						inlineStyle.disabled = true;
						URL.revokeObjectURL( inlineStyle.url );
					}
					inlineStyle = mw.util.addCSS(
						'#spritedoc .sprite { background-image: url(' + this.src + ') !important }'
					);
					inlineStyle.url = this.src;
					
					deferred.resolve();
				};
				spritesheet.src = URL.createObjectURL( this.response );
			};
			requestTimeout = setTimeout( function() {
				xhr.abort();
				deferred.reject( 'http', { textStatus: 'timeout' } );
			}, 30 * 1000 );
			
			var errorCallback = xhr.onerror = function() {
				if ( deferred.state() === 'pending' ) {
					deferred.reject( 'http', { textStatus: 'error' } );
				}
			};
			// Support: IE 9 only
			// Use onreadystatechange to replace onabort
			// to handle uncaught aborts
			if ( xhr.onabort !== undefined ) {
				xhr.onabort = errorCallback;
			} else {
				xhr.onreadystatechange = function() {
					// Check readyState before timeout as it changes
					if ( xhr.readyState === 4 ) {
						// Allow onerror to be called first,
						// but that will not handle a native abort
						// Also, save errorCallback to a variable
						// as xhr.onerror cannot be accessed
						window.setTimeout( function() {
							errorCallback();
						} );
					}
				};
			}
			xhr.send();
			
			return deferred.promise( { abort: function() {
				deferred.reject( 'http', { textStatus: 'abort' } );
				xhr.abort();
			} } );
		} );
	}
	
	// Check if the IDs page has been edited since opening
	// the page and download the latest version if so
	var curContentRequest = retryableRequest( function() {
		return revisionsApi.get( {
			rvprop: 'timestamp',
			pageids: idsPageId,
		} );
	} );
	var contentRequest = curContentRequest.then( function( data ) {
		var currentTimestamp = fixTimestamp( data.query.pages[idsPageId].revisions[0].timestamp );
		if ( currentTimestamp > $doc.data( 'idstimestamp' ) ) {
			$doc.data( 'idstimestamp', currentTimestamp );
			
			curContentRequest = retryableRequest( function() {
				return parseApi.get( {
					title: mw.config.get( 'wgPageName' ),
					text: $( '<i>' ).html(
						$.parseHTML( $doc.attr( 'data-refreshtext' ) )
					).html()
				} );
			} ).done( function( data ) {
				oldHtml = data.parse.text['*'];
				$doc.html( oldHtml );
			} );
			
			return curContentRequest;
		} else {
			oldHtml = $doc.html();
		}
	} ).promise( { abort: curContentRequest.abort } );
	
	// Check if we have permission to edit the IDs page and
	// spritesheet file and that the user isn't blocked
	var curPermissionsRequest = retryableRequest( function() {
		return new mw.Api().get( {
			action: 'query',
			meta: 'userinfo',
			uiprop: 'rights|blockinfo',
			utf8: true,
		} );
	} );
	var permissionsRequest = curPermissionsRequest.then( function( data ) {
		var info = data.query.userinfo;
		
		var canEdit = true;
		if ( info.blockid ) {
			canEdit = false;
			var $blockNotice = $( '<p>' ).text( i18n.blockedNotice );
			if ( info.blockreason ) {
				curPermissionsRequest = retryableRequest( function() {
					return parseApi.get( { summary: info.blockreason } );
				} ).done( function( data ) {
					$blockNotice.append( '<br>', i18n.blockedReason.replace( /\$1/g,
						$( '<span>' ).addClass( 'comment' ).html( data.parse.parsedsummary['*'] ).html()
					) );
				} );
			}
			$.when( curPermissionsRequest ).always( function() {
				mw.notify( $blockNotice, { type: 'error', autoHide: false } );
			} );
		} else {
			var rights = info.rights;
			$.each( [ 'ids', 'sprite' ], function() {
				var requiredRights = $doc.data( this + 'protection' ).split( ',' );
				$.each( requiredRights, function() {
					if ( rights.indexOf( this ) === -1 ) {
						canEdit = false;
						return false;
					}
				} );
				
				return canEdit;
			} );
			
			if ( !canEdit ) {
				mw.notify( i18n.noPermissionNotice, { type: 'error', autoHide: false } );
			}
			
			/* User doesn't have the right to apply change tags */
			if ( rights.indexOf( 'applychangetags' ) === -1 ) {
				canTag = false;
			}
		}
		
		if ( !canEdit ) {
			if ( sheetRequest ) {
				sheetRequest.abort();
			}
			contentRequest.abort();
			
			destroy();
		}
	} ).promise( { abort: curPermissionsRequest.abort } );
	
	$.when( sheetRequest, contentRequest, permissionsRequest ).then( function() {
		// Make sure the editor wasn't destroyed while we were waiting
		if ( $root.hasClass( 'spriteedit-loaded' ) ) {
			enable();
		}
	}, function( code, error ) {
		// Fatal error, bail
		if ( sheetRequest ) {
			sheetRequest.abort();
		}
		contentRequest.abort();
		permissionsRequest.abort();
		
		handleError( code, error );
		destroy();
	} );
	
	// Handle closing the editor on navigation
	if ( historySupported ) {
		$win.on( 'popstate.spriteEdit', function() {
			if (
				!location.search.match( '[?&]spriteaction=edit' ) &&
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
		
		
		$doc.append(
			$( '<div>' ).addClass( 'spriteedit-autoscroll spriteedit-autoscroll-up' ),
			$( '<div>' ).addClass( 'spriteedit-autoscroll spriteedit-autoscroll-down' )
		);
		var autoScroll = function( now ) {
			autoScroll.delta = ( now - autoScroll.timeLast ) / ( 1000 / 60 );
			autoScroll.timeLast = now;
			
			if ( mouse.y !== autoScroll.lastMouseY ) {
				var areaRect = autoScroll.area.getBoundingClientRect();
				if ( autoScroll.dir === -1 ) {
					autoScroll.speed = areaRect.bottom - mouse.y;
				} else {
					autoScroll.speed = mouse.y - areaRect.top + 1;
				}
				
				autoScroll.lastMouseY = mouse.y;
			}
			
			// Prevent overscroll
			var scrollTop = $win.scrollTop();
			if (
				autoScroll.dir === -1 && scrollTop > autoScroll.topLimit ||
				autoScroll.dir === 1 && scrollTop + $win.height() < autoScroll.bottomLimit
			) {
				scrollBy( 0, autoScroll.dir * Math.round( autoScroll.speed / 2 ) * Math.round( autoScroll.delta ) );
			}
			
			autoScroll.id = requestAnimationFrame( autoScroll );
		};
		autoScroll.start = function( area ) {
			if ( autoScroll.id ) {
				autoScroll.stop();
			}
			
			var scrollTop = $win.scrollTop();
			autoScroll.area = area;
			autoScroll.dir = $( area ).hasClass( 'spriteedit-autoscroll-up' ) ? -1 : 1;
			autoScroll.speed = 1;
			autoScroll.timeLast = window.performance ? performance.now() : Date.now();
			autoScroll.topLimit = scrollTop + $doc[0].getBoundingClientRect().top;
			autoScroll.bottomLimit = scrollTop + $doc.find( '.spritedoc-section' ).last()[0].getBoundingClientRect().bottom + 50;
			autoScroll.id = requestAnimationFrame( autoScroll );
		};
		autoScroll.stop = function() {
			cancelAnimationFrame( autoScroll.id );
			autoScroll.id = 0;
		};
		
		$doc.find( '.spriteedit-autoscroll' )
			.on( 'mouseenter.spriteEdit dragenter.spriteEdit', function() {
				autoScroll.start( this );
			} )
			.on( 'mouseleave.spriteEdit dragleave.spriteEdit', autoScroll.stop );
		
		
		addControls( $doc.find( 'h3' ), 'heading' );
		
		var $boxes = $doc.find( '.spritedoc-box' );
		$boxes.each( function() {
			var $this = $( this );
			
			var $names = $this.find( '.spritedoc-name' );
			$this.attr( 'data-sort-key', $names.first().text() );
			
			$names.find( 'code' ).each( function() {
				var $code = $( this );
				usedNames[$code.text()] = [ $code ];
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
					overflow: 'hidden',
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
				overflow: 'visible',
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
			sortEnd: expandBoxes,
		} );
		makeSortable( {
			selectors: {
				container: '.spritedoc-section',
				parent: '.spritedoc-boxes',
				elem: '.spritedoc-box',
			},
			autoSort: true,
			sortStart: collapseBoxes,
			sortEnd: expandBoxes,
		} );
		
		// Create toolbar
		var contentPadding = {
			left: $content.css( 'padding-left' ),
			right: $content.css( 'padding-right' ),
		};
		$toolbar = $( '<div>' ).addClass( 'spriteedit-toolbar' ).css( {
			paddingLeft: contentPadding.left,
			paddingRight: contentPadding.right,
			marginLeft: '-' + contentPadding.left,
			marginRight: '-' + contentPadding.right,
		} );
		var undoButton = new OO.ui.ButtonInputWidget( {
			id: 'spriteedit-undo',
			icon: 'undo',
			label: i18n.toolbarUndo,
			disabled: true,
		} );
		undoButton.$element.data( 'ooui-object', undoButton );
		
		var redoButton = new OO.ui.ButtonInputWidget( {
			id: 'spriteedit-redo',
			icon: 'redo',
			label: i18n.toolbarRedo,
			disabled: true,
		} );
		redoButton.$element.data( 'ooui-object', redoButton );
		
		var newSectionButton = new OO.ui.ButtonInputWidget( {
			id: 'spriteedit-add-section',
			icon: 'tableAddRowAfter',
			label: i18n.toolbarNewSection,
		} );
		newSectionButton.$element.data( 'ooui-object', newSectionButton );
		
		var newImageButton = new OO.ui.ButtonInputWidget( {
			id: 'spriteedit-add-image',
			icon: 'imageAdd',
			label: i18n.toolbarNewImage,
		} );
		newImageButton.$element.data( 'ooui-object', newImageButton );
		
		var saveButton = new OO.ui.ButtonInputWidget( {
			id: 'spriteedit-save',
			flags: [ 'progressive', 'primary' ],
			icon: 'expand',
			label: i18n.toolbarSave,
			disabled: true,
		} );
		saveButton.$element.data( 'ooui-object', saveButton ).css( 'right', contentPadding.right );
		
		var toolboxSelect = new OO.ui.DropdownWidget( {
			id: 'spriteedit-toolbox',
			label: i18n.toolbarTools,
			$overlay: $doc,
		} );
		toolboxSelect.$element.data( 'ooui-object', toolboxSelect );
		
		$toolbar.append(
			new OO.ui.ButtonGroupWidget( {
				items: [ undoButton, redoButton ],
			} ).$element,
			new OO.ui.ButtonGroupWidget( {
				items: [ newSectionButton, newImageButton ],
			} ).$element,
			toolboxSelect.$element,
			saveButton.$element
		);
		if ( !imageEditingSupported ) {
			newImageButton.setDisabled( true ).$element
				.prop( 'title', i18n.browserActionNotSupported )
				.css( 'cursor', 'help' );
		}
		
		// Create tools
		var $toolbox = $toolbar.find( '#spriteedit-toolbox' );
		var deprecateOption = new OO.ui.MenuOptionWidget( {
			data: 'deprecate',
			label: i18n.toolbarToolDeprecate,
			icon: 'flag',
		} );
		deprecateOption.$element.prop( 'title', i18n.toolbarToolDeprecateTip );
		toolboxSelect.getMenu().addItems( [ deprecateOption ] );
		
		var $barContainer = $( '<div>' ).addClass( 'spriteedit-toolbar-container' )
			.append( $toolbar ).prependTo( $doc );
		
		if ( $docPrev.length ) {
			$doc.insertAfter( $docPrev );
		} else {
			$doc.prependTo( $docParent );
		}
		
		// Set height now that everything is re-attached
		var toolbarHeight = $toolbar[0].getBoundingClientRect().height;
		$barContainer.height( toolbarHeight );
		
		// Wait until everything else is done so the animation is smooth
		requestAnimationFrame( function() {
			var barTop = $barContainer[0].getBoundingClientRect().top;
			if ( barTop > 0 ) {
				$root.addClass( 'spriteedit-smoothscroll' );
				scroll( 0, barTop + $win.scrollTop() + 1 );
			}
		} );
		
		// Check the editor's change tag exists
		// Since the tag isn't important, we don't wait for the request to finish
		// If it isn't done by the time we try to save, we assume we can't tag
		if ( canTag !== false ) {
			findChangeTag( 'spriteeditor' ).then( function( result ) {
				canTag = result;
			} );
		}
		
		
		/** Bind events **/
		/* Outside interface events */
		// Prevent accidentally closing window if changes have been made
		preventClose = mw.confirmCloseWindow( {
			namespace: 'spriteEdit',
			test: function() {
				return !saveButton.isDisabled();
			},
		} );
		
		$( '#ca-view' ).find( 'a' ).on( 'click.spriteEdit', function( e ) {
			close();
			e.preventDefault();
		} );
		
		
		/* Toolbar events */
		// Manually make the toolbar sticky if position:sticky isn't supported
		if ( !supports( 'position', 'sticky' ) && !supports( 'position', '-webkit-sticky' ) ) {
			var fixedClass = 'spriteedit-toolbar-fixed';
			var contentOffset = $content.offset().left + 1;
			$win.on( 'scroll.spriteEdit', $.throttle( 32, function() {
				var fixed = $toolbar.hasClass( fixedClass ),
					scrollTop = $win.scrollTop(),
					offset = $barContainer.offset().top;
				if ( !fixed && scrollTop >= offset ) {
					$toolbar.addClass( fixedClass ).css( 'left', contentOffset );
				} else if ( fixed && scrollTop < offset ) {
					$toolbar.removeClass( fixedClass ).css( 'left', '' );
				}
			} ) );
		}
		
		$( '#spriteedit-undo' ).find( 'button' ).on( 'click.spriteEdit', function() {
			$( this ).focus().blur();
			
			// We're not meant to be editing
			if ( $root.hasClass( 'spriteedit-hidecontrols' ) ) {
				return;
			}
			
			var hist = changes.pop();
			revert( hist );
			undoneChanges.push( hist );
			redoButton.setDisabled( false );
		} );
		
		$( '#spriteedit-redo' ).find( 'button' ).on( 'click.spriteEdit', function() {
			$( this ).focus().blur();
			
			// We're not meant to be editing
			if ( $root.hasClass( 'spriteedit-hidecontrols' ) ) {
				return;
			}
			
			var hist = undoneChanges.pop();
			$.each( hist, function() {
				change( this.action, this.content, false, true );
			} );
			changes.push( hist );
			
			if ( !undoneChanges.length ) {
				redoButton.setDisabled( true );
			}
			
			$.each( [
				'#spriteedit-undo',
				'#spriteedit-save',
				'#spriteedit-summary',
				'#spriteedit-review-button',
			], function() {
				if ( $( this ).length ) {
					$( this ).data( 'ooui-object' ).setDisabled( false );
				}
			} );
		} );
		
		$( '#spriteedit-add-section' ).find( 'button' ).on( 'click.spriteEdit', function() {
			$( this ).focus().blur();
			
			// We're not meant to be editing
			if ( $root.hasClass( 'spriteedit-hidecontrols' ) ) {
				return;
			}
			
			var $newHeading = $headingTemplate.clone();
			change( 'insert', {
				$elem: $( '<div>' ).addClass( 'spritedoc-section' ).prepend(
					$newHeading,
					$( '<ul>' ).addClass( 'spritedoc-boxes' )
				),
				index: $( nearestSection() ).index() - 1,
				$parent: $doc,
			}, true );
			
			$newHeading.find( '.mw-headline' ).focus();
		} );
		
		$( '#spriteedit-add-image' ).find( 'button' ).on( 'click.spriteEdit', function() {
			$( this ).focus().blur();
			
			// We're not meant to be editing
			if ( $root.hasClass( 'spriteedit-hidecontrols' ) ) {
				return;
			}
			
			$( '<input type="file">' )
				.attr( {
					accept: 'image/*',
					multiple: true,
				} )
				.one( 'change.spriteEdit', function() {
					insertSprites( this.files );
				} ).click();
		} );
		
		// Toolbox functions
		// Modify click event to not open menu when we're not meant to be editing,
		// or a tool is already selected
		toolboxSelect.origOnClick = toolboxSelect.onClick;
		toolboxSelect.onClick = function( e ) {
			if ( $root.hasClass( 'spriteedit-hidecontrols' ) ) {
				this.$handle.blur();
				return;
			}
			
			toolboxSelect.origOnClick.call( toolboxSelect, e );
		};
		toolboxSelect.$handle.off( 'click' ).on( 'click', toolboxSelect.onClick.bind( toolboxSelect ) );
		
		toolboxSelect.on( 'labelChange', function() {
			if ( !toolboxSelect.getLabel() ) {
				toolboxSelect.setLabel( i18n.toolbarTools );
			}
		} );
		
		var toolNamespace = '.spriteEdit.spriteEditTool.spriteEditTool';
		var tool;
		// Bind events for each tool's function
		toolboxSelect.getMenu().on( 'choose', function( item ) {
			tool = item.getData();
			$root.addClass( 'spriteedit-hidecontrols spriteedit-tool spriteedit-tool-' + tool );
			
			switch ( tool ) {
				case 'deprecate':
					$doc.on( 'click' + toolNamespace + 'Deprecate', '.spritedoc-name > code', function() {
						change( 'toggle deprecation', { $elem: $( this ) } );
					} );
				break;
			}
		} );
		// Clear tool when clicking a toolbar button, the toolbox itself, or pressing escape
		var clearTool = function( e ) {
			if ( !$root.hasClass( 'spriteedit-tool' ) ) {
				return;
			}
			toolboxSelect.getMenu().selectItem();
			$doc.off( '.spriteEditTool' );
			$root.removeClass( 'spriteedit-hidecontrols spriteedit-tool spriteedit-tool-' + tool );
			tool = null;
		};
		$toolbar.on( 'mouseup.spriteEdit', 'button', function() {
			clearTool();
		} );
		$toolbox.on( 'click.spriteEdit', function() {
			clearTool();
		} );
		$( document ).on( 'keydown.spriteEdit', function( e ) {
			// Esc
			if ( e.keyCode === 27 ) {
				clearTool();
			}
		} );
		
		// Drag and drop functionality
		if ( dropSupported && imageEditingSupported ) {
			var dragTimeout, dragEnded;
			var endDrag = function() {
				$root.removeClass( 'spriteedit-dragging' );
				
				clearTimeout( dragTimeout );
				clearTimeout( dropTimeout );
				dragEnded = false;
				dropEnded = false;
			};
			var isFile = function( e ) {
				var types = e.originalEvent.dataTransfer.types;
				return types.indexOf ?
					types.indexOf( 'Files' ) > -1 || types.indexOf( 'application/x-moz-file' ) > -1 :
					types.contains( 'Files' );
			};
			$win.on( 'dragenter.spriteEdit', function( e ) {
				if ( !isFile( e ) ) {
					return;
				}
				
				$root.addClass( 'spriteedit-dragging' );
			} ).on( 'dragover.spriteEdit', function() {
				clearTimeout( dragTimeout );
				dragEnded = false;
			} ).on( 'dragleave.spriteEdit', function( e ) {
				if ( !isFile( e ) ) {
					return;
				}
				
				clearTimeout( dragTimeout );
				dragEnded = true;
				dragTimeout = setTimeout( function() {
					if ( dragEnded ) {
						endDrag();
					}
				}, 100 );
			} );
			
			var dropTimeout, dropEnded;
			$doc.on( 'dragenter.spriteEdit', '.spritedoc-section', function( e ) {
				if ( !isFile( e ) ) {
					return;
				}
				
				$doc.find( '.spriteedit-droptarget' ).not( this ).removeClass( 'spriteedit-droptarget' );
				$( this ).addClass( 'spriteedit-droptarget' );
			} ).on( 'dragover.spriteEdit', '.spritedoc-section', function( e ) {
				clearTimeout( dropTimeout );
				dropEnded = false;
				
				e.originalEvent.dataTransfer.dropEffect = 'copy';
				
				e.preventDefault();
			} ).on( 'dragleave.spriteEdit', '.spritedoc-section', function( e ) {
				if ( !isFile( e ) ) {
					return;
				}
				
				clearTimeout( dropTimeout );
				dropEnded = true;
				dropTimeout = setTimeout( function() {
					if ( dropEnded ) {
						$doc.find( '.spriteedit-droptarget' ).removeClass( 'spriteedit-droptarget' );
						dropEnded = false;
					}
				}, 100 );
			} ).on( 'drop.spriteEdit', '.spritedoc-section', function( e ) {
				if ( !isFile( e ) ) {
					return;
				}
				
				$doc.find( '.spriteedit-droptarget' ).removeClass( 'spriteedit-droptarget' );
				
				insertSprites( e.originalEvent.dataTransfer.files, this );
				endDrag();
				e.preventDefault();
			} );
		}
		
		$( '#spriteedit-save' ).find( 'button' ).on( 'click.spriteEdit', function() {
			var $button = $( this );
			$button.focus().blur();
			
			// Prevent saving and notify if there are duplicate names
			if ( $doc.find( '.spriteedit-dupe' ).length ) {
				mw.notify( i18n.dupeNamesNotice, { type: 'warn', autoHide: false } );
				
				return;
			}
			
			// Prevent saving if button already pressed and still processing
			if ( $button.hasClass( 'spriteedit-processing' ) ) {
				return;
			}
			
			$button.addClass( 'spriteedit-processing' );
			
			if ( $toolbar.hasClass( 'spriteedit-saveform-open' ) ) {
				// If we know changes weren't made (by performing a diff),
				// quit out, otherwise it's likely faster to just save and
				// assume changes were made, than wait for the diff to be ready.
				// It will just be a null edit if nothing was changed.
				if ( !names.modified && !sheet.modified ) {
					destroy( true );
					
					return;
				}
				
				saveChanges( $( '#spriteedit-summary' ).data( 'ooui-object' ).getValue() );
				
				return;
			}
			
			saveModules.done( function() {
				$toolbar.addClass( 'spriteedit-saveform-open' );
				$button
					.removeClass( 'spriteedit-processing' )
					// Prevent accidental double-click saving
					.css( 'pointer-events', 'none' );
				
				$button.parent().data( 'ooui-object' ).setIcon( 'check' );
				
				if ( !$toolbar.find( '#spriteedit-saveform' ).length ) {
					var summaryInput = new OO.ui.TextInputWidget( {
						id: 'spriteedit-summary',
						name: 'wpSummary',
						spellcheck: true,
						placeholder: i18n.toolbarSummaryPlaceholder,
						maxLength: 255,
						label: '255',
					} );
					summaryInput.$element.data( 'ooui-object', summaryInput );
					summaryInput.$label.prop( 'title', i18n.toolbarSummaryLabelTip );
					summaryInput.on( 'change', function( value ) {
						summaryInput.setLabel( String( 255 - $.byteLength( value ) ) );
					} );
					$( '<div>' )
						.attr( 'id', 'spriteedit-saveform' )
						.css( 'margin-right', $( '#spriteedit-save' )[0].getBoundingClientRect().width )
						.append(
							summaryInput.$element,
							makeButton( i18n.toolbarReviewChanges, { id: 'spriteedit-review-button' } )
					).appendTo( $toolbar );
				}
				
				var openedToolbarHeight = $toolbar[0].getBoundingClientRect().height;
				$toolbar
					.outerHeight( toolbarHeight )
					.redraw()
					.outerHeight( openedToolbarHeight )
					.transitionEnd( function() {
						$button.css( 'pointer-events', '' );
						$barContainer.height( openedToolbarHeight );
						$( '#spriteedit-summary' ).data( 'ooui-object' ).focus();
						
						// Do this after the transition so there is no stutter
						names.getDiff();
						sheet.stash();
					} );
			} );
		} );
		
		$doc.on( 'keydown.spriteEdit', '#spriteedit-summary', function( e ) {
			// Anything but Enter
			if ( e.which !== 13 ) {
				return;
			}
			
			$( this ).blur();
			$( '#spriteedit-save' ).find( 'button' ).click();
			e.preventDefault();
		} );
		
		$doc.on( 'click.spriteEdit', '#spriteedit-review-button > button', function() {
			var $button = $( this );
			if ( $button.hasClass( 'spriteedit-processing' ) ) {
				return;
			}
			$button.focus().blur().addClass( 'spriteedit-processing' );
			
			var changesPanel = panels.changes || panel( 'changes', {
				title: i18n.panelChangesTitle,
				content: [
					$( '<div>' ).addClass( 'spriteedit-sheet-changes' ),
					$( '<div>' ).addClass( 'spriteedit-id-changes' ),
				],
			} );
			var $changesText = changesPanel.$text;
			
			$.when( names.getDiff(), sheet.getData() ).then( function( diff, sheetData ) {
				var sheetChanges;
				if ( !diff && !sheetData ) {
					$changesText.text( i18n.panelChangesNoDiffFromCur );
				} else {
					if ( sheetData ) {
						sheetChanges = $.Deferred();
						var newSpritesheet = new Image();
						newSpritesheet.onload = function() {
							$changesText.find( '.spriteedit-sheet-changes' ).append(
								$( '<div>' ).text( i18n.panelChangesSheetTitle ),
								$( '<div>' ).addClass( 'spriteedit-sheet-diff' ).append(
									$( '<span>' ).addClass( 'spriteedit-old-sheet' ).append( spritesheet ),
									$( '<span>' ).addClass( 'spriteedit-new-sheet' ).append( newSpritesheet )
								)
							);
							
							sheetChanges.resolve();
						};
						newSpritesheet.src = sheetData;
					}
					if ( diff ) {
						$changesText.find( '.spriteedit-id-changes' ).append(
							$( '<div>' ).text( i18n.panelChangesIdTitle ),
							$( '<div>' ).append( diff )
						);
					}
				}
				
				$.when( sheetChanges ).done( function() {
					$button.removeClass( 'spriteedit-processing' );
					changesPanel.show();
				} );
			}, function( code, data ) {
				$button.removeClass( 'spriteedit-processing' );
				handleError( code, data );
			} );
		} );
		
		
		/* Edit control events */
		$doc.on( 'click.spriteEdit', '.spriteedit-add-name > button', function() {
			var $names = $( this ).closest( '.spritedoc-box' ).find( '.spritedoc-name' );
			var $item = $( '<li>' ).addClass( 'spritedoc-name' );
			var $name = $( '<code>' ).addClass( 'spriteedit-new' )
				.attr( 'data-placeholder', i18n.namePlaceholder );
			addControls( $item.append( $name ), 'name' );
			
			change( 'insert', {
				$elem: $item,
				index: $names.length - 1,
				$parent: $names.first().parent(),
			}, true );
			
			$name.focus();
		} );
		
		$doc.on( 'focus.spriteEdit', '[contenteditable]', function() {
			var $this = $( this );
			if ( $root.hasClass( 'spriteedit-hidecontrols' ) ) {
				$this.blur();
				return;
			}
			
			var text = $this.text();
			$this.attr( 'data-original-text', text );
			
			if ( !changes.length ) {
				$this.one( 'keypress.spriteEdit', function() {
					$.each( [
						'#spriteedit-save',
						'#spriteedit-summary',
						'#spriteedit-review-button',
					], function() {
						if ( $( this ).length ) {
							$( this ).data( 'ooui-object' ).setDisabled( false )
						}
					} );
				} );
			}
		} );
		$doc.on( 'blur.spriteEdit', '[contenteditable]', function() {
			if ( $root.hasClass( 'spriteedit-hidecontrols' ) ) {
				return;
			}
			
			var $this = $( this );
			var text = $this.text();
			var trimmedText = text.trim().replace( /  +/g, ' ' );
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
							text: i18n.sectionUncategorized,
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
					$parent: $parent,
				} );
				return;
			}
			
			if ( text === origText ) {
				if ( !changes.length ) {
					$.each( [
						'#spriteedit-save',
						'#spriteedit-summary',
						'#spriteedit-review-button',
					], function() {
						if ( $( this ).length ) {
							$( this ).data( 'ooui-object' ).setDisabled( true );
						}
					} );
				}
				
				return;
			}
			
			if ( usedNames[text] ) {
				// Wait until after edit change, as it may move the element
				// which the tooltip should be anchored to
				requestAnimationFrame( function() {
					tooltip( $this, i18n.dupeName );
				} );
			}
			
			change( 'edit', {
				$elem: $this,
				oldText: origText,
				text: text,
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
		// Make pastes plain text
		$doc.on( 'paste.spriteEdit', '[contenteditable]', function() {
			var $this = $( this );
			var hasFocus = $this.has( ':focus' );
			if ( !hasFocus ) {
				$this.focus();
			}
			setTimeout( function() {
				var text = $this.text().replace( /\n/g, ' ' );
				if ( $this.html() !== $( '<i>' ).text( text ).html() ) {
					$this.text( text );
					
					if ( !hasFocus ) {
						$this.blur();
					}
				}
			}, 0 );
		} );
		var isText = function( e ) {
			var types = e.originalEvent.dataTransfer.types;
			return types.indexOf ? types.indexOf( 'text/plain' ) > -1 : types.contains( 'text/plain' );
		};
		$doc.on( 'dragenter.spriteEdit dragover.spriteEdit', '[contenteditable]', function( e ) {
			if ( !isText( e ) ) {
				return;
			}
			
			e.preventDefault();
		} );
		$doc.on( 'drop.spriteEdit', function( e ) {
			// Prevent default drop on anything but contenteditable
			// This prevents browsers dropping content into a nearby contenteditable, which doesn't
			// trigger any kind of drop event on the contenteditable (because you didn't actually
			// drop anything directly on it), thus making it impossible to handle it properly.
			if ( !$( e.target ).is( '[contenteditable]' ) ) {
				e.preventDefault();
				return;
			}
			
			if ( !isText( e ) ) {
				return;
			}
			
			var $this = $( e.target );
			$this.focus();
			setTimeout( function() {
				var text = $this.text().replace( /\n/g, ' ' );
				if ( $this.html() !== $( '<i>' ).text( text ).html() ) {
					$this.text( text );
				}
				
				$this.blur();
			}, 0 );
		} );
		
		if ( imageEditingSupported ) {
			$doc.on( 'click.spriteEdit', '.spritedoc-image', function() {
				var $parent = $( this );
				
				tooltip( $parent, [
					makeButton( i18n.ctxReplaceImage, {
						type: [ 'progressive', 'primary' ],
						icon: 'imageGallery',
						action: function() {
							$( '<input type="file">' )
								.attr( 'accept', 'image/*' )
								.one( 'change', function() {
									tooltip.hide();
									
									scaleImage( this.files[0] ).done( function( $img ) {
										change( 'replace image', {
											$elem: $img,
											$parent: $parent,
											$oldImg: $parent.find( 'img' ),
										} );
									} );
								} ).click();
						},
					} ),
					makeButton( i18n.ctxDownloadImage, {
						icon: 'download',
						action: function() {
							var url;
							var $box = $parent.parent();
							// Already an image, just pass on the URL
							if ( $box.hasClass( 'spriteedit-new' ) ) {
								url = $parent.find( '> img' ).attr( 'src' );
							} else {
								// Individual sprite needs to be extracted from the spritesheet
								var width = settings.imageWidth;
								var height = settings.imageHeight;
								var posPx = posToPx( $box.data( 'pos' ) );
								var imgCanv = getCanvas( 'image' );
								
								imgCanv.clear();
								imgCanv.ctx.drawImage( spritesheet,
									posPx.left, posPx.top, width, height,
									0, 0, width, height
								);
								
								url = imgCanv.canvas.toDataURL();
							}
							
							var dlLink = $( '<a>' ).attr( {
								href: url,
								download: $box.data( 'sort-key' ) + '.png',
							} ).appendTo( 'body' );
							dlLink[0].click();
							dlLink.remove();
						},
					} ),
					makeButton( i18n.ctxDeleteImage, {
						type: [ 'destructive', 'primary' ],
						icon: 'trash',
						action: function() {
							tooltip.hide( function() {
								var $box = $parent.parent();
								change( 'delete', {
									$elem: $box,
									$parent: $box.parent(),
									index: $box.index() - 1,
								} );
							} );
						},
					} ),
				], { horizontal: true, class: 'spriteedit-tooltip-controls' } );
			} );
		}
		
		
		/* Window events */
		$win.on( 'resize.spriteEdit', $.throttle( 32, function() {
			var $conflict = $( '#spriteedit-dialog-conflict' );
			if ( $conflict.length && $conflict.is( ':visible' ) ) {
				var $textarea = $conflict.find( 'textarea' );
				$textarea.css( 'max-height', (
					$conflict.find( '.spriteedit-dialog-text' ).height() - $textarea.parent()[0].offsetTop
				) + 'px' );
			}
		} ) );
		
		var updateMouse = function( e ) {
			mouse.moved = true;
			mouse.x = e.clientX;
			mouse.y = e.clientY;
		};
		// Only update mouse while sorting, dragging, or while over a handle
		$doc.on( 'mouseenter.spriteEdit mousemove.spriteEdit', '.spriteedit-handle', function( e ) {
			if ( !sorting ) {
				updateMouse( e );
			}
		} );
		$( document ).on( 'mousemove.spriteEdit', function( e ) {
			if ( sorting ) {
				updateMouse( e );
			}
		} ).on( 'dragover.spriteEdit', function( e ) {
			updateMouse( e.originalEvent );
		} );
		
		// Disable smooth scrolling once scrolling ends so it does not interfere with user scrolling.
		$win.on( 'scroll.spriteEdit', $.debounce( 250, function() {
			$root.removeClass( 'spriteedit-smoothscroll' );
		} ) );
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
		if ( !$root.hasClass( 'spriteedit-enabled' ) || $( '#spriteedit-save' ).data( 'ooui-object' ).isDisabled() ) {
			destroy( true, state === 'history' );
		} else {
			var discardPanel = panels.discard || panel( 'discard', {
				title: i18n.panelDiscardTitle,
				content: $( '<p>' ).text( i18n.panelDiscardText ),
				actions: { right: [
					{ text: i18n.panelDiscardContinue, config: {
						action: function() {
							discardPanel.hide();
						}
					} },
					{ text: i18n.panelDiscardDiscard, config: {
						type: [ 'destructive', 'primary' ],
						icon: 'trash',
						action: function() {
							discardPanel.hide( function() {
								destroy( true, state === 'history' );
							} );
						}
					} },
				] },
			} );
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
			return i18n.genericError;
		}
		
		var pages = data.query.pages;
		var page = pages[idsPageId];
		if ( !page ) {
			return i18n.diffErrorMissingPage;
		}
		var diff = page.revisions[0].diff['*'];
		if ( diff === undefined ) {
			return i18n.diffError;
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
	
	var names = ( function() {
		var promises = {};
		/**
		 * Create a deferred object for the request type
		 *
		 * If a deferred of this type already exists, or names is not
		 * modified, returns false.
		 *
		 * Otherwise, adds the deferred's promise to the list, and returns
		 * the deferred.
		 */
		var makeDeferred = function( type ) {
			if ( promises[type] ) {
				return false;
			}
			
			var deferred = $.Deferred();
			promises[type] = deferred.promise();
			if ( !names.modified ) {
				deferred.resolve();
				return false;
			}
			
			return deferred;
		};
		
		return {
			/**
			 * Invalidates all promises and sets the modified state, if specified
			 */
			invalidate: function( modified ) {
				promises = {};
				if ( modified !== undefined ) {
					names.modified = modified;
				}
			},
			/**
			 * Returns the names Lua table
			 */
			getTable: function() {
				var deferred = makeDeferred( 'table' );
				if ( !deferred ) {
					return promises.table;
				}
				
				sheet.updatePositions().done( function() {
					var $sections = $doc.find( '.spritedoc-section' );
					var sectionIds = [];
					var getSectionId = ( function() {
						var id = 0;
						return function() {
							if ( id < sectionIds.length ) {
								sectionIds.sort( function( a, b ) {
									return a - b;
								} );
								
								$.each( sectionIds, function( _, v ) {
									if ( v - id > 1 ) {
										return false;
									}
									id = v;
								} );
							}
							
							id++;
							
							sectionIds.push( id );
							return id;
						};
					}() );
					
					$sections.each( function() {
						var id = $( this ).data( 'section-id' );
						if ( id !== undefined ) {
							sectionIds.push( id );
						}
					} );
					
					var headingRows = [];
					var ids = [];
					$sections.each( function() {
						var $section = $( this );
						var sectionId = $section.data( 'section-id' ) || getSectionId();
						var sectionName = $section.find( '.mw-headline' ).text().replace( /\s+/g, ' ' );
						headingRows.push(
							'{ ' + luaStringQuote( sectionName ) + ', ' + luaKeyQuote( i18n.luaKeyId ) + ' = ' + sectionId + ' },'
						);
						
						$section.find( '.spritedoc-box' ).each( function() {
							var $box = $( this );
							var pos = $box.data( 'pos' );
							if ( pos === undefined ) {
								pos = $box.data( 'new-pos' );
							}
							$box.find( '.spritedoc-name' ).find( 'code' ).each( function() {
								var $this = $( this );
								var id = $this.text().replace( /\s+/g, ' ' );
								ids.push( {
									sortKey: id.toLowerCase(),
									id: id,
									pos: pos,
									section: sectionId,
									deprecated: $this.hasClass( 'spritedoc-deprecated' ),
								} );
							} );
						} );
					} );
					ids.sort( function( a, b ) {
						return a.sortKey > b.sortKey ? 1 : -1;
					} );
					
					var idsRows = [];
					$.each( ids, function() {
						var idData = [
							luaKeyQuote( i18n.luaKeyPos ) + ' = ' + this.pos,
							luaKeyQuote( i18n.luaKeySection ) + ' = ' + this.section,
						];
						if ( this.deprecated ) {
							idData.push( luaKeyQuote( i18n.luaKeyDeprecated ) + ' = true' );
						}
						
						idsRows.push(
							'[' + luaStringQuote( this.id ) + '] = ' +
							'{ ' + idData.join( ', ' ) + ' },'
						);
					} );
					
					deferred.resolve( [
						'return {',
						'	' + luaKeyQuote( i18n.luaKeySections ) + ' = {',
						'		' + headingRows.join( '\n\t\t' ),
						'	},',
						'	' + luaKeyQuote( i18n.luaKeyIds ) + ' = {',
						'		' + idsRows.join( '\n\t\t' ),
						'	}',
						'}',
					].join( '\n' ) );
				} );
				
				return promises.table;
			},
			/**
			 * Sets the names Lua table to the specified content
			 */
			setTable: function( table ) {
				names.invalidate( true );
				promises.table = $.Deferred().resolve( table ).promise();
			},
			/**
			 * Requests a diff of the names Lua table against
			 * the current revisions content
			 */
			getDiff: function() {
				var deferred = makeDeferred( 'diff' );
				if ( !deferred ) {
					return promises.diff;
				}
				
				names.getTable().then( function( table ) {
					return retryableRequest( function() {
						return new mw.Api( {
							ajax: { contentType: 'multipart/form-data' },
						} ).post( {
							action: 'query',
							prop: 'revisions',
							pageids: idsPageId,
							rvprop: '',
							rvdifftotext: table,
							rvlimit: 1,
							utf8: true,
						} );
					} );
				} ).then( function( data ) {
					var diff = makeDiff( data );
					names.modified = !!diff;
					deferred.resolve( diff );
				}, function( code, data ) {
					deferred.reject( code, data );
					promises.diff = null;
				} );
				
				return promises.diff;
			},
			/**
			 * Saves the names table
			 *
			 * "summary" is the edit summary for the edit.
			 */
			save: function( summary, conflict ) {
				var deferred = makeDeferred( 'save' );
				if ( !deferred ) {
					return promises.save;
				}
				
				names.getTable().then( function( table ) {
					// TODO: Check if edit actually succeeded on failure or null edit
					return retryableRequest( function() {
						return new mw.Api( {
							ajax: { contentType: 'multipart/form-data' },
						} ).postWithToken( 'csrf', {
							action: 'edit',
							nocreate: true,
							pageid: idsPageId,
							text: table,
							// If there's already been an edit conflict, just allow the edit
							// through conflict-free, as it's already annoying enough to
							// deal with one conflict.
							basetimestamp: !conflict ? $doc.data( 'idstimestamp' ): undefined,
							summary: summary,
							tags: canTag ? 'spriteeditor' : undefined,
							utf8: true,
						} );
					} );
				} ).then( deferred.resolve, function( code, data ) {
					deferred.reject( code, data );
					promises.save = null;
				} );
				
				return promises.save;
			},
		};
	}() );
	
	var sheet = ( function() {
		var promises = {};
		/**
		 * Create a deferred object for the request type
		 *
		 * If a deferred of this type already exists, or the sheet is not
		 * modified, returns false.
		 *
		 * Otherwise, adds the deferred's promise to the list, and returns
		 * the deferred.
		 */
		var makeDeferred = function( type ) {
			if ( promises[type] ) {
				return false;
			}
			
			var deferred = $.Deferred();
			promises[type] = deferred.promise();
			if ( !sheet.modified ) {
				deferred.resolve();
				return false;
			}
			
			return deferred;
		};
		
		return {
			/**
			 * Invalidates all promises and sets the modified state, if specified
			 */
			invalidate: function( modified ) {
				promises = {};
				if ( modified !== undefined ) {
					sheet.modified = modified;
				}
			},
			/**
			 * Invalidates just the stash's promise
			 */
			invalidateStash: function() {
				promises.stash = null;
			},
			/**
			 * Updates the potential position information
			 * for any new images, and resizes the canvas
			 */
			updatePositions: function() {
				var deferred = makeDeferred( 'pos' );
				if ( !deferred ) {
					return promises.pos;
				}
				
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
					
					newImgs.forEach( function( $box ) {
						$box.data( 'new-pos', unusedPos.length ? unusedPos.shift() : ++lastPos );
					} );
					
					if ( !unusedPos.length ) {
						var imagesPerRow = ( settings.sheetWidth + settings.spacing ) / ( settings.imageWidth + settings.spacing );
						settings.sheetHeight = Math.ceil( lastPos / imagesPerRow ) * ( settings.imageHeight + settings.spacing ) - settings.spacing;
						getCanvas( 'sheet' ).resize();
					}
				}
				
				deferred.resolve();
				
				return promises.pos;
			},
			/**
			 * Draws the new sheet and returns it as a data URL
			 */
			getData: function() {
				var deferred = makeDeferred( 'sheet' );
				if ( !deferred ) {
					return promises.sheet;
				}
				
				$.when( sheet.updatePositions(), $.when.apply( null, loadingImages ) ).then( function() {
					var sheetCanvas = getCanvas( 'sheet' );
					sheetCanvas.clear();
					sheetCanvas.ctx.drawImage( spritesheet, 0, 0 );
					
					// TODO: Clear deleted images so when new images fill their place
					// the original images don't show up while the old sheet is cached
					
					// Insert new images into sheet
					$doc.find( '.spriteedit-new' ).each( function() {
						var $box = $( this );
						var img = $box.find( 'img' )[0];
						var pos = $box.data( 'pos' );
						if ( pos === undefined ) {
							pos = $box.data( 'new-pos' );
						}
						
						var posPx = posToPx( pos );
						// Clear previous image including spacing, just in-case
						// someone manually uploaded an image overlapping the spacing
						sheetCanvas.ctx.clearRect(
							posPx.left - settings.spacing,
							posPx.top - settings.spacing,
							settings.imageWidth + settings.spacing * 2,
							settings.imageHeight + settings.spacing * 2
						);
						
						sheetCanvas.ctx.drawImage( img, posPx.left, posPx.top );
					} );
					deferred.resolve( sheetCanvas.canvas.toDataURL() );
					
					loadingImages = [];
				}, function() {
					deferred.reject();
					promises.sheet = null;
				} );
				
				return promises.sheet;
			},
			/**
			 * Stashes the sheet to the server
			 */
			stash: function() {
				var deferred = makeDeferred( 'stash' );
				if ( !deferred ) {
					return promises.stash;
				}
				
				sheet.getData().then( function( sheetData ) {
					var sheetByteString = atob( sheetData.split( ',' )[1] );
					var sheetByteStringLen = sheetByteString.length;
					var buffer = new ArrayBuffer( sheetByteStringLen );
					var intArray = new Uint8Array( buffer );
					for ( var i = 0; i < sheetByteStringLen; i++) {
						intArray[i] = sheetByteString.charCodeAt( i );
					}
					var sheetBytes = new Blob( [buffer], { type: 'image/png' } );
					
					return retryableRequest( function() {
						return new mw.Api( {
							ajax: { contentType: 'multipart/form-data' },
						} ).postWithToken( 'csrf', {
							action: 'upload',
							stash: true,
							ignorewarnings: true,
							filename: $doc.data( 'spritesheet' ),
							file: sheetBytes,
						} );
					} );
				} ).then( function( data ) {
					deferred.resolve( data.upload.filekey );
				}, function( code, data ) {
					deferred.reject( code, data );
					promises.stash = null;
				} );
				
				return promises.stash;
			},
			/**
			 * Commits the stash to the server
			 *
			 * If the request fails, will re-stash the image and commit it, once.
			 * 
			 * "summary" is the edit summary for the upload.
			 * "retried" is a boolean stating whether the upload has
			 * already been retried.
			 */
			save: function( summary, retried ) {
				var deferred = makeDeferred( 'save' );
				if ( !deferred ) {
					return promises.save;
				}
				
				sheet.stash().then( function( key ) {
					// TODO: Check if upload actually succeeded on failure
					return retryableRequest( function() {
						return new mw.Api().postWithToken( 'csrf', {
							action: 'upload',
							ignorewarnings: true,
							comment: summary,
							filename: $doc.data( 'spritesheet' ),
							filekey: key,
							tags: canTag ? 'spriteeditor' : undefined,
						} );
					} );
				} ).then( deferred.resolve, function( code, data ) {
					promises.save = null;
					if ( retried ) {
						if ( code === 'stashedfilenotfound' ) {
							sheet.invalidateStash();
						}
						deferred.reject( code, data );
					} else {
						sheet.invalidateStash();
						sheet.save( summary, true );
					}
				} );
				
				return promises.save;
			},
		};
	}() );
	
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
	 * "refresh" is a boolean, which when true will cause the sprite documentation
	 * to be reparsed after saving (e.g. in the event of an edit conflict).
	 */
	var saveChanges = function( summary, refresh, conflict ) {
		// No more editing
		$root.addClass( 'spriteedit-hidecontrols' );
		
		var idsEdit, sheetEdit;
		if ( names.modified ) {
			// Wait for image upload before saving text
			idsEdit = sheet.stash().then( function() {
				return names.save( summary, conflict );
			} ).then( function( data ) {
				// Null edit, nothing to do here
				if ( data.edit.nochange === '' ) {
					return;
				}
				
				$doc.data( 'idstimestamp', fixTimestamp( data.edit.newtimestamp ) );
				
				// Purge this page so the changes show up immediately
				retryableRequest( function() {
					return new mw.Api().post( {
						action: 'purge',
						pageids: mw.config.get( 'wgArticleId' ),
					} );
				} );
			}, handleSaveError );
		}
		if ( sheet.modified ) {
			sheetEdit = sheet.save( summary ).fail( handleSaveError );
		}
		
		$.when( idsEdit, sheetEdit ).done( function() {
			var newContent;
			if ( refresh ) {
				newContent = retryableRequest( function() {
					return parseApi.get( {
						title: mw.config.get( 'wgPageName' ),
						text: $( '<i>' ).html(
							$.parseHTML( $doc.attr( 'data-refreshtext' ) )
						).html(),
					} );
				} );
			}
			
			$.when( newContent ).done( function( data ) {
				if ( refresh ) {
					$doc.html( data.parse.text['*'] );
				}
			} ).always( function() {
				destroy();
				
				mw.hook( 'postEdit' ).fire( { message: i18n.changesSavedNotice } );
			} );
		} );
	};
	
	/**
	 * Handles special case errors that occur when saving (AKA, handleError with edit conflicts)
	 *
	 * If there's an edit conflict, this will be display a barely human-usable edit conflict
	 * panel, where the user may manually merge the raw lua table changes. Sprite edit conflict
	 * merging is not supported (because image uploading doesn't implement edit conflicts, for one).
	 * Otherwise, passes it on to handleError.
	 *
	 * "code" and "data" are the standard variables returned by a mw.Api promise rejection.
	 */
	var handleSaveError = function( code, data ) {
		// Allow editing again
		$root.removeClass( 'spriteedit-hidecontrols' );
		$( '#spriteedit-save' ).find( 'button' ).removeClass( 'spriteedit-processing' );
		
		if ( code !== 'editconflict' ) {
			handleError( code, data );
			return;
		}
		
		var conflictPanel = panels.conflict || panel( 'conflict', {
			title: i18n.panelConflictTitle,
			content: $( '<p>' ).text( i18n.panelConflictText ),
			actions: {
				left: { text: i18n.panelConflictReview, config: {
					id: 'review-conflict-changes',
					action: function() {
						var $button = $( this );
						if ( $button.hasClass( 'spriteedit-processing' ) ) {
							return;
						}
						$button.blur().addClass( 'spriteedit-processing' );
						
						var changesPanel = panels.ecchanges || panel( 'ecchanges', {
							title: i18n.panelEcchangesTitle,
							content: $( '<div>' ).addClass( 'spriteedit-id-changes' ),
							actions: { right: { text: i18n.panelEcchangesReturn, config: {
								id: 'spriteedit-return-edit',
								type: [ 'progressive', 'primary' ],
								action: function() {
									conflictPanel.show();
								},
							} } },
							onClose: function() {
								names.invalidate( true );
							},
						} );
						
						names.setTable( $( '#spriteedit-ec-curText' ).data( 'ooui-object' ).getValue() );
						names.getDiff().then( function( diff ) {
							changesPanel.clean();
							
							if ( !diff ) {
								diff = i18n.panelChangesNoDiffFromCur;
							}
							changesPanel.$text.find( '.spriteedit-id-changes' ).append( diff );
							changesPanel.show();
						}, function( code, data ) {
							$button.removeClass( 'spriteedit-processing' );
							handleError( code, data );
						} );
					}
				} },
				right: { text: i18n.panelConflictSave, config: {
					id: 'save-conflict',
					type: [ 'progressive', 'primary' ],
					action: function() {
						var $button = $( this );
						if ( $button.hasClass( 'spriteedit-processing' ) ) {
							return;
						}
						$button.blur().addClass( 'spriteedit-processing' );
						
						names.setTable( $( '#spriteedit-ec-curText' ).data( 'ooui-object' ).getValue() );
						saveChanges( $( '#spriteedit-summary' ).data( 'ooui-object' ).getValue(), true, true );
					},
				} },
			},
			onShow: function() {
				this.$actions.find( 'button' ).removeClass( 'spriteedit-processing' );
				
				var $textarea = this.$text.find( 'textarea' );
				$textarea.css( 'max-height', ( this.$text.height() - $textarea.parent()[0].offsetTop ) + 'px' );
			},
			onClose: function() {
				names.invalidate( true );
			},
		} );
		
		$.when(
			names.getTable(),
			names.getDiff(),
			retryableRequest( function() {
				return revisionsApi.get( { pageids: idsPageId } );
			} )
		).then( function( table, diff, curTextData ) {
			// TODO: Change to MultilineTextInputWidget on MW 1.30
			var curEditbox = new OO.ui.TextInputWidget( {
				id: 'spriteedit-ec-curText',
				multiline: true,
				value: curTextData[0].query.pages[idsPageId].revisions[0]['*'],
			} );
			curEditbox.$element.data( 'ooui-object', curEditbox );
			var oldEditbox = new OO.ui.TextInputWidget( {
				id: 'spriteedit-ec-oldText',
				multiline: true,
				readOnly: true,
				value: table,
			} );
			oldEditbox.$element.data( 'ooui-object', oldEditbox );
			
			var $curText = $( '<div>' ).append(
				$( '<p>' ).text( i18n.panelConflictCurText ),
				curEditbox.$element
			);
			var $oldText = $( '<div>' ).append(
				$( '<p>' ).text( i18n.panelConflictYourText ),
				oldEditbox.$element
			);
			
			conflictPanel.$text.append(
				$( '<div>' ).addClass( 'spriteedit-ec-editboxes' ).append(
					$curText,
					$oldText
				),
				diff
			);
			
			conflictPanel.show();
		}, function( code, data ) {
			$( '#spriteedit-save' ).find( 'button' ).removeClass( 'spriteedit-processing' );
			handleError( code, data );
		} );
	};
	
	/**
	 * Converts a position to pixel co-ordinates on the sheet
	 */
	var posToPx = function( pos ) {
		settings.imagesPerRow = settings.imagesPerRow ||
			( settings.sheetWidth + settings.spacing ) / ( settings.imageWidth + settings.spacing );
		pos -= 1;
		return {
			left: pos % settings.imagesPerRow * ( settings.imageWidth + settings.spacing ),
			top: Math.floor( pos / settings.imagesPerRow ) * ( settings.imageHeight + settings.spacing ),
		};
	};
	
	/**
	 * Inserts new images into the editor
	 *
	 * A box is created for the new image, with the name set to the file's name (minus extension).
	 * The box is inserted into the nearest section and then sorted to the correct location.
	 * Any file that doesn't match the image/* mime type is ignored.
	 *
	 * "files" is a "FileList" (or an array of "File" objects) from a file input or drop.
	 * "section" is an Element which is the section to place the sprites in. Defaults to
	 * the nearestSection()
	 */
	var insertSprites = function( files, section ) {
		var $parent = $( section || nearestSection() ).find( '.spritedoc-boxes' );
		$.each( files, function() {
			if ( !this.type.match( /^image\// ) ) {
				return;
			}
			
			var $newBox = $boxTemplate.clone();
			$newBox.find( 'code' ).text( this.name.trim().replace( /\.[^\.]+$/, '' ) );
			scaleImage( this ).done( function( $img ) {
				$newBox.find( '.spritedoc-image' ).html( $img );
			} );
			
			var name = $newBox.find( '.spritedoc-name' ).text();
			$newBox.attr( 'data-sort-key', name );
			
			var index = getAlphaIndex( name, undefined, $parent );
			change( 'insert', {
				$elem: $newBox,
				index: index - 1,
				$parent: $parent,
			} );
		} );
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
				height: settings[type + 'Height'],
			} ).appendTo( $doc );
			var canvas = $canvas[0];
			var ctx = canvas.getContext( '2d' );
			
			var funcs = {
				canvas: canvas,
				ctx: ctx,
				resize: function() {
					$canvas.attr( {
						width: settings[type + 'Width'],
						height: settings[type + 'Height'],
					} );
				},
				clear: function() {
					ctx.clearRect( 0, 0, canvas.width, canvas.height );
				},
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
	 * panel id prior to calling this function to create a new panel,
	 * so duplicates are not made.
	 * E.g: `var myPanel = panels.myPanel || panel( 'myPanel', ... );`
	 *
	 * "id" is the unique ID that identifies this panel
	 * "config" is an object of config options for this panel
	 *  "title" is the string to use for the panel's title
	 *  "content" is HTML to use for the panel's text area,
	 *   it can be in any format $().append takes (jQuery, nodes, HTML strings, array)
	 *   The panel will reset to this HTML whenever the dialog box is closed
	 *   (if "cached" isn't specified)
	 *  "actions" is an object to specify which buttons to place.
	 *   It has a "left" and "right" key to specify which side of the
	 *   dialog to place the buttons which accept an array of objects
	 *   which are passed to `makeButton`
	 *  "onShow" is a callback which is called whenever the dialog is
	 *   opened, or this panel is shown
	 *  "onHide" is a callback which is called whenever the dialog is
	 *   closed, or this panel is hidden
	 *  "onClose" is a callback which is called whenever the dialog is
	 *   closed, regardless of which panel is currently shown
	 *  "cached" is a boolean specifying if the panel's HTML should be
	 *   retained after the dialog is closed, or should be reset to the
	 *   value of "config.content"
	 *
	 * Returns the panel object for the new panel (or the currently displayed
	 * panel if called with no arguments).
	 * The panel object contains jQuery objects of the panel's parts, some of
	 * the config options, and methods for controlling the panel/dialog window.
	 * 
	 * panel.show shows the panel, opening the dialog if it isn't already
	 *  It accepts a callback function which is called once the dialog/panel
	 *  opening animation is finished
	 * panel.hide closes the dialog
	 *  It accepts a callback function which is called once the dialog closing
	 *  animation is finished
	 * panel.clean deletes the panel's text and resets it to the initial
	 *  value specified in "config.content"
	 */
	var panel = function( id, config ) {
		var $overlay;
		var $dialog = $( '.spriteedit-dialog' );
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
				makeButton( '', {
					id: 'spriteedit-dialog-close',
					icon: 'close',
					title: i18n.panelCloseTip,
					action: function() {
						var closingPanel = panel();
						closingPanel.hide();
						if ( closingPanel.onClose ) {
							closingPanel.onClose.call( closingPanel );
						}
					},
				} )
			).appendTo( $overlay );
		}
		
		if ( config.content && !Array.isArray( config.content ) ) {
			config.content = [ config.content ];
		}
		
		var $panel = $( '<div>' )
			.prop( 'id', 'spriteedit-dialog-' + id )
			.addClass( 'spriteedit-dialog-panel' );
		
		var $title = $( '<div>' ).addClass( 'spriteedit-dialog-title' ).text( config.title ).appendTo( $panel );
		
		var $text = $( '<div>' ).addClass( 'spriteedit-dialog-text' ).appendTo( $panel );
		
		if ( config.content ) {
			$text.append( config.content );
			
			// Keep content as the initial HTML for resetting
			config.content = $text.html();
		}
		
		var $actions;
		if ( config.actions ) {
			$actions = $( '<div>' ).addClass( 'spriteedit-dialog-actions' ).appendTo( $panel );
			var $leftActions = $( '<span>' ).appendTo( $actions );
			var $rightActions = $( '<span>' ).css( 'float', 'right' ).appendTo( $actions );
			var addButtons = function( buttons, right ) {
				if ( !buttons ) {
					return;
				}
				
				var $area = right ? $rightActions : $leftActions;
				if ( !Array.isArray( buttons ) ) {
					buttons = [ buttons ];
				}
				$.each( buttons, function() {
					$area.append( makeButton( this.text, this.config ) );
				} );
			};
			
			addButtons( config.actions.left );
			addButtons( config.actions.right, true );
		}
		
		$dialog.append( $panel );
		
		if ( $overlay ) {
			$( document.body ).append( $overlay );
		} else {
			$overlay = $dialog.parent();
		}
		
		$overlay.show();
		
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
				$dialog.css( { transform: 'none', transition: 'none' } );
				
				var prevPanel;
				if ( $overlay.css( 'opacity' ) === '1' ) {
					prevPanel = panel();
					// Remember to cleanup previous panel when the dialog is closed
					if ( prevPanel && !prevPanel.cached ) {
						prevPanel.cleanup = true;
					}
					if ( prevPanel.onHide ) {
						prevPanel.onHide.call( prevPanel );
					}
				}
				
				var oldRect;
				if ( prevPanel ) {
					oldRect = $dialog[0].getBoundingClientRect();
					prevPanel.$panel.hide();
				}
				$overlay.css( 'display', '' );
				$panel.css( 'display', '' );
				if ( prevPanel ) {
					var newRect = $dialog[0].getBoundingClientRect();
					$dialog.css( 'transform', 'scale(1)' ).redraw().css( 'transition', '' );
					if ( oldRect.width === newRect.width && oldRect.height === newRect.height ) {
						// No transition to be made
						$dialog.trigger( 'transitionend' );
					} else {
						$panel.css( 'display', 'none' );
						$dialog.css( {
							width: oldRect.width,
							height: oldRect.height,
						} ).redraw().css( {
							width: newRect.width,
							height: newRect.height,
						} ).transitionEnd( function() {
							panelShown = true;
							$dialog.css( { width: '', height: '' } );
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
					$dialog.css( 'transform', '' ).redraw().css( 'transition', '' );
					$overlay.css( 'opacity', 1 );
					$dialog
						.addClass( 'spriteedit-elastic' )
						.css( 'transform', 'scale(1)' )
						.transitionEnd( function() {
							$dialog.removeClass( 'spriteedit-elastic' );
						} );
				}
				
				$dialog.data( 'active-panel', id );
				
				if ( config.onShow ) {
					config.onShow.call( thisPanel );
				}
				if ( callback ) {
					callback.call( thisPanel );
				}
				
				return this;
			},
			hide: function( callback ) {
				if ( !$overlay.is( ':visible' ) ) {
					return this;
				}
				
				if ( config.onHide ) {
					config.onHide.call( thisPanel );
				}
				
				$dialog.css( 'transform', 'scale(0)' );
				$overlay.css( 'opacity', 0 ).transitionEnd( function() {
					// Reset scrollbar BEFORE hiding
					$text.scrollLeft( 0 );
					$text.scrollTop( 0 );
					
					$overlay.css( 'display', 'none' );
					thisPanel.$panel.css( 'display', 'none' );
					
					if ( !config.cached ) {
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
				
				if ( config.content ) {
					$text.append( config.content );
				}
				
				thisPanel.cleanup = false;
			},
			onShow: config.onShow,
			onHide: config.onHide,
			onClose: config.onClose,
			cached: config.cached,
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
	 * "config" contains key-value pairs of the following configuration options:
	 *   "horizontal" is a boolean determining if the tooltip should open horizontally or vertically
	 *   relative to its anchor.
	 *   "callback" is a function called once the tooltip finishes its opening animation.
	 *   "class" is a classname to add to the tooltip
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
		
		var func = function( $elem, content, config ) {
			config = config || {};
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
			
			if ( config.class ) {
				$tooltip.addClass( config.class );
			}
			
			var anchorPos = $anchor.offset();
			var docPos = $doc.offset();
			if ( config.horizontal ) {
				$tooltip.addClass( 'spriteedit-tooltip-horizontal' ).css( {
					top: anchorPos.top - docPos.top + $anchor.outerHeight() / 2,
					left: anchorPos.left - docPos.left - $tooltip.outerWidth(),
				} );
			} else {
				$tooltip.css( {
					top: anchorPos.top - docPos.top - $tooltip.outerHeight(),
					left: anchorPos.left - docPos.left + $anchor.outerWidth() / 2,
				} );
			}
			
			$tooltip.addClass( 'spriteedit-elastic' ).css( {
				opacity: 1,
				transform: 'scale(1)',
			} ).transitionEnd( function() {
				$( this ).removeClass( 'spriteedit-elastic' );
				
				if ( config.callback ) {
					config.callback.call( this );
				}
			} );
		};
		func.hide = function( callback ) {
			if ( !$tooltip.length ) {
				return;
			}
			
			$tooltip.off( 'transitionend.spriteEdit' ).css( {
				opacity: 0,
				transform: 'scale(0)',
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
			
			if ( $ghost.find( '.spriteedit-new' ).length && $ghost.text().trim() === '' ) {
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
				left: ( ghostRect.left - e.clientX ) / ghostRect.width,
			};
			
			$ghost.addClass( 'spriteedit-ghost' ).css( {
				top: e.clientY,
				left: e.clientX,
			} );
			
			// Apply offsets
			var newGhostRect = ghostElem.getBoundingClientRect();
			$ghost.css( {
				marginTop: newGhostRect.height * cursorOffset.top,
				marginLeft: newGhostRect.width * cursorOffset.left,
			} );
			
			if ( options.sortStart ) {
				options.sortStart.call( ghostElem, $placeholder[0] );
			}
			
			// Must be set after callback for collapsing.
			if ( !autoSort ) {
				$placeholder.css( 'min-height', ghostElem.getBoundingClientRect().height );
			}
			
			$ghost.parent().mouseenter();
			
			sorting = true;
			$root.addClass( 'spriteedit-sorting spriteedit-hidecontrols' );
			
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
						$parent: $box.parent(),
					}, true );
				}
				
				change( 'insert', {
					$elem: $ghost,
					oldIndex: $ghost.index() - 1,
					$oldParent: $ghost.parent(),
					index: index - 1,
					$parent: $hoverParent.length && $hoverParent.find( selectors.parent ) ||
						$placeholder.parent(),
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
			
			sorting = false;
			$root.removeClass( 'spriteedit-sorting spriteedit-hidecontrols' );
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
					
					names.invalidate( true );
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
					
					if ( !moved && ( isBox || content.$elem.hasClass( 'spritedoc-section' ) ) ) {
						content.$elem.find( '.spritedoc-name' ).find( 'code' ).each( function() {
							updateName( undefined, $( this ).text(), $( this ) );
						} );
						if ( $doc.find( '.spriteedit-new' ).length ) {
							sheet.invalidate( true );
						}
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
					
					requestAnimationFrame( function() {
						scrollIntoView( content.$elem );
					} );
					
					names.invalidate( true );
				break;
				
				case 'delete':
					var isBox = content.$elem.hasClass( 'spritedoc-box' );
					var $box = !isBox && content.$elem.closest( '.spritedoc-box' );
					
					content.$elem.detach();
					
					if ( isBox || content.$elem.hasClass( 'spritedoc-section' ) ) {
						content.$elem.find( '.spritedoc-name' ).find( 'code' ).each( function() {
							updateName( $( this ).text(), undefined, $( this ) );
						} );
						sheet.invalidate( !!$doc.find( '.spriteedit-new' ).length );
					} else if ( content.$elem.hasClass( 'spritedoc-name' ) ) {
						var $code = content.$elem.find( 'code' );
						updateName( $code.text(), undefined, $code );
						updateBoxSorting( $box );
					}
					
					names.invalidate( true );
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
					sheet.invalidate( true );
				break;
				
				case 'reset image':
					content.$elem.detach();
					content.$parent.children().css( 'display', '' );
					content.$parent.parent().removeClass( 'spriteedit-new' );
					
					if ( !$doc.find( '.spriteedit-new' ).length ) {
						sheet.invalidate( false );
					}
				break;
				
				case 'toggle deprecation':
					content.$elem.toggleClass( 'spritedoc-deprecated' );
					
					names.invalidate( true );
				break;
			}
			
			var hist = { action: action, content: content };
			if ( !oldChange ) {
				queue.push( hist );
				if ( !queueChange ) {
					func.commit();
				}
			}
		};
		func.commit = function() {
			addHistory( queue );
			
			queue = [];
		};
		func.discard = function() {
			queue = [];
			
			if ( !$doc.find( '.spriteedit-new' ).length ) {
				sheet.invalidate( false );
			}
			
			if ( !changes.length ) {
				names.invalidate( false );
				
				$.each( [
					'#spriteedit-save',
					'#spriteedit-summary',
					'#spriteedit-review-button',
				], function() {
					if ( $( this ).length ) {
						$( this ).data( 'ooui-object' ).setDisabled( true );
					}
				} );
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
			
			$( '#spriteedit-redo' ).data( 'ooui-object' ).setDisabled( true );
		}
		
		$.each( [
			'#spriteedit-undo',
			'#spriteedit-save',
			'#spriteedit-summary',
			'#spriteedit-review-button',
		], function() {
			if ( $( this ).length ) {
				$( this ).data( 'ooui-object' ).setDisabled( false );
			}
		} );
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
						oldText: content.text,
					}, false, true );
				break;
				
				case 'insert':
					if ( content.$oldParent ) {
						change( 'insert', {
							$elem: content.$elem,
							index: content.oldIndex,
							$parent: content.$oldParent,
						}, false, true );
					} else {
						change( 'delete', {
							$elem: content.$elem,
							$parent: content.$parent,
						}, false, true );
					}
				break;
				
				case 'delete':
					change( 'insert', {
						$elem: content.$elem,
						index: content.index,
						$parent: content.$parent,
					}, false, true );
				break;
				
				case 'replace image':
					if ( content.$oldImg.length ) {
						change( 'replace image', {
							$elem: content.$oldImg,
							$parent: content.$parent,
							$oldImg: content.$elem,
						}, false, true );
					} else {
						change( 'reset image', content, false, true );
					}
				break;
				
				case 'reset image':
					change( 'replace image', content, false, true );
				break;
				
				case 'toggle deprecation':
					change( 'toggle deprecation', content, false, true );
				break;
			}
		}
		
		if ( !$doc.find( '.spriteedit-new' ).length ) {
			sheet.invalidate( false );
		}
		
		if ( !changes.length ) {
			names.invalidate( false );
			
			$.each( [
				'#spriteedit-undo',
				'#spriteedit-save',
				'#spriteedit-summary',
				'#spriteedit-review-button',
			], function() {
				if ( $( this ).length ) {
					$( this ).data( 'ooui-object' ).setDisabled( true );
				}
			} );
		}
	};
	
	/**
	 * Updates the list of names for duplicate detection
	 *
	 * Also sorts the names and box if necessary.
	 */
	var updateName = function( oldText, newText, $elem ) {
		if ( oldText ) {
			var oldNames = usedNames[oldText];
			if ( oldNames.length === 1 ) {
				delete usedNames[oldText];
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
			var newNames = usedNames[newText];
			if ( !newNames ) {
				newNames = usedNames[newText] = [];
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
					$parent: $parent,
				}, false, true );
			} else if ( index === 0 ) {
				updateBoxSorting( $item.closest( '.spritedoc-box' ) );
			}
		}
	};
	
	/**
	 * Updates the box's sort key and sorts it.
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
				$parent: $parent,
			}, false, true );
		}
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
		document.title = originalTitle;
		
		// Disable close confirm dialog
		preventClose.release();
		
		$win.add( document ).off( '.spriteEdit' );
		
		if ( !leaveUrl ) {
			if ( historySupported ) {
				history.pushState( {}, '', mw.util.getUrl() );
			} else if ( location.search.match( '[?&]spriteaction=edit' ) ) {
				location = mw.util.getUrl();
			}
		}
		
		var enabled = $root.hasClass( 'spriteedit-enabled' );
		
		$root.removeClass( 'spriteedit-loaded spriteedit-enabled spriteedit-imageeditingenabled spriteedit-hidecontrols' );
		
		var $viewTab = $( '#ca-view' );
		$viewTab.add( '#ca-spriteedit' ).toggleClass( 'selected' );
		
		$doc.add( $viewTab.find( 'a' ) ).off( '.spriteEdit' );
		
		// No further cleanup necessary
		if ( !enabled ) {
			return;
		}
		
		$( '.mw-editsection' ).add( '.mw-editsection-like' ).css( 'display', '' );
		
		// Release old image URL references
		if ( sheet.modified ) {
			$.each( changes, function() {
				if ( this.action === 'replace image' ) {
					URL.revokeObjectURL( this.content.$oldImg.attr( 'src' ) );
				}
			} );
		}
		
		if ( restore ) {
			// Release current image URL references
			if ( sheet.modified ) {
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
			'.spriteedit-dialog-overlay',
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
		this.each( function() {
			callback.call( this );
		} );
	}
	
	return this;
};

/**
 * Forces the browser to redraw an element
 */
$.fn.redraw = function() {
	this.each( function() {
		this.offsetWidth;
	} );
	
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
	var $items = $parent ? $parent.children() : $elem.siblings();
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
	var toolbarHeight = $( '.spriteedit-toolbar' )[0].getBoundingClientRect().height;
	var scrollPos;
	if ( elemRect.top - toolbarHeight < 10 ) {
		scrollPos = elemRect.top + $win.scrollTop() - toolbarHeight - 10;
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
 * Returns a lua key with quotes and brackets if necessary
 */
var luaKeyQuote = function( str ) {
	if ( str.match( /^[a-z_]\w*$/i ) ) {
		return str;
	}
	
	return '[' + luaStringQuote( str ) + ']';
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
			$elems.each( function(){
				var addNameButton = new OO.ui.ButtonInputWidget( {
					classes: [ 'spriteedit-add-name' ],
					framed: false,
					icon: 'add',
					title: i18n.controlNewName,
				} );
				addNameButton.$element.data( 'ooui-object', addNameButton );
				$( this ).prepend(
					$( '<span>' ).addClass( 'spriteedit-handle' ),
					addNameButton.$element
				);
			} );
			addControls( $elems.find( '.spritedoc-name' ), 'name' );
		break;
		case 'name':
			$elems.find( 'code' ).attr( 'contenteditable', true );
		break;
	}
};

/**
 * Create an OOUI button widget
 *
 * "text" is the string displayed on the button.
 * "config" is an object defining various properties of the button:
 * * "type" is a string or array of strings defining the OOUI flags
 *   this button should use (e.g.: progressive, destructive, primary).
 * * "id" is the id attribute applied to the button.
 * * "icon" is the OOUI icon to use
 * * "action" is a function called when the button is clicked.
 */
var makeButton = function( text, config ) {
	var button = new OO.ui.ButtonInputWidget( {
		flags: config.type,
		id: config.id,
		label: text,
		icon: config.icon,
		title: config.title,
	} );
	
	if ( config.action ) {
		button.$button.on( 'click.spriteEdit', function( e ) {
			$( this ).focus().blur();
			config.action.call( this, e );
		} );
	}
	
	button.$element.data( 'ooui-object', button );
	
	return button.$element;
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

/**
 * Retries a request once if it fails
 *
 * Always returns an abortable promise, even if the request itself isn't abortable.
 *
 * "request" is a function which will run the request,
 * and should return the request's promise.
 * "delay" is the amount of milliseconds to wait before retrying.
 * "retries" is the amount of times to retry
 */
var retryableRequest = function( request, delay, retries ) {
	var deferred = $.Deferred();
	var curRequest;
	var timeout;
	retries = retries || 1;
	var attemptRequest = function( attempt ) {
		( curRequest = request() ).then( deferred.resolve, function( code, data ) {
			if ( attempt <= retries ) {
				timeout = setTimeout( function() {
					attemptRequest( ++attempt );
				}, delay || 1000 );
			} else {
				deferred.reject( code, data );
			}
			
		} );
	};
	attemptRequest( 1 );
	
	return deferred.promise( { abort: function() {
		if ( curRequest.abort ) {
			curRequest.abort();
		}
		clearTimeout( timeout );
	} } );
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
	var errorTitle = i18n.errorGeneric;
	var errorText;
	if ( code === 'http' ) {
		// Not an error
		if ( data.textStatus === 'abort' ) {
			return;
		}
		
		if ( data.textStatus === 'error' || data.textStatus === 'timeout' ) {
			errorTitle = i18n.errorConnection;
			errorText = i18n.errorConnectionText;
		} else {
			errorTitle = i18n.errorHttp;
			errorText = data.textStatus;
		}
	} else {
		errorTitle = i18n.errorApi;
		errorText = data.error.info;
	}
	
	mw.notify( errorText, { title: errorTitle, type: 'error', autoHide: false } );
};

/**
 * Looks for the specified change tag
 * 
 * Returns a promise which resolves to a boolean stating if the tag is active or not,
 * or null if the tag doesn't exist.
 * 
 * "tag" is the tag to search for.
 * "options" is an object of additional values to add to the request.
 */
var findChangeTag = function( tag, options ) {
	return retryableRequest( function() {
		return new mw.Api().get( $.extend( {
			action: 'query',
			list: 'tags',
			tgprop: 'active',
			tglimit: 'max',
			formatversion: 2,
		}, options || {} ) );
	} ).then( function( data ) {
		var foundActive = null;
		$.each( data.query.tags, function() {
			if ( this.name === tag ) {
				foundActive = this.active;
				return false;
			}
		} );
		
		// XXX: MW JS requires ES5 support, but JavascriptMinifier doesn't
		// support ES5, so these have to remain strings. See T96901
		if ( foundActive === null && data['continue'] ) {
			return findChangeTag( tag, data['continue'] );
		}
		
		return foundActive;
	} );
};


// Finally start the editor
create( 'initial' );


}() );
