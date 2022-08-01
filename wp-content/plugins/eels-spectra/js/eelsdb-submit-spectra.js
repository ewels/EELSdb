/*//////////////////////////////////////////
// EELS DB Spectra Plugin
// eelsdb-submit-spectra.js
// Javascript to make the Spectrum Submission page work
//////////////////////////////////////////*/
/*
We use clever WordPress techniques to pass PHP variables to this script
php_vars.plugin_dir_url (URL to plugin directory)
*/

var form_submitted = false;

jQuery().ready(function($) {

	/////// MICROSCOPE ACQUISITION PRESETS
	$("#eelsdb_user_microscope_preset").change(function(){
		var preset_slug = $(this).val();
		if(preset_slug){
			presets = microscope_presets[preset_slug];
			var changeWarning = 0;
			$.each(presets, function(index, value){
				var id = '#eelsdb_spectra_'+index;
				if($(id).val() && $(id).val() !== value){
					changeWarning = 1;
				}
			});
			if(changeWarning){
				if(!confirm('Selecting this preset will over-write your entries. Are you sure?')){
					$(this).val($.data(this, 'current'));
					return false;
				}
			}
			$.each(presets, function(index, value){
				var id = '#eelsdb_spectra_'+index;
				$(id).val(value);
			});
		}
		$.data(this, 'current', $(this).val());
	});
	$('#microscope_acquiisition_details_fieldset input').change(function(){
		$("#eelsdb_user_microscope_preset").val('');
	});



	/////// ELEMENT EDGES DROPDOWNS
	// Are we on the admin page?
	var admin = parseInt(php_vars.admin);
	// Set the button style
	var buttonClass = 'btn btn-default';
	if(admin){
		buttonClass = 'button';
	}
	// Load the edge data
	var edges = [];
	$.getJSON( php_vars.plugin_dir_url+"element_levels.json", function( data ) {
		// Save the edge data to the global scope element
		edges = data;
		// Disable and then re-enable all elements
		$('#periodic_table a').addClass('disabled');
		$.each( data, function( key, val ) {
			// Remove the disabled class if we have this element
			$('#periodic_table a').filter(function(){
				return $(this).text() == key;
			}).removeClass('disabled').addClass('has-spectra');
		});
	}).fail(function(jqxhr, textStatus, error) {
		var err = textStatus + ", " + error;
		console.log( "Elements dropdown AJAX JSON request failed: " + err );
	});

	// Click event - Main "Add Edge" button
	$('.eelsdb_edges_add').click(function(e){
		e.preventDefault();
		if($('#edge_selection').is(':visible')){
			$('#edge_selection').slideUp('slow', function(){
				$('#periodic_table_div').show();
				$('#level_selection').hide();
			});
		} else {
			$('#periodic_table_div').show();
			$('#level_selection').hide();
			$('#edge_selection').slideDown();
		}
	});

	// Click event - Element Name
	$('#periodic_table a').click(function(e){
		e.preventDefault();
		// Fill in content
		var el = $(this).text();
		var el_name = $(this).attr('title');
		$('#el_symbol').text(el);
		$('#el_name').text(el_name);
		var levels = edges[el];
		var num_levels = 0;
		for (l_name in levels) {
		    if (levels.hasOwnProperty(l_name)) {
		        num_levels++;
		    }
		}
		if(num_levels == 1){
			add_level(el, el_name, l_name);
            reset_form();
			return true;
		}
		var level_list = [];
		$.each(levels, function(level, level_energy){
    		var added_id = '#' + el + '_' + level.replace(/,/g , '');
            if($('#eelsdb_edges_added_edges').find(added_id).length === 0){
			    var level_li = '<li><a href="#" class="'+buttonClass+' level_select" id="'+el+'_'+level+'_button" data-element="'+el+'" data-element-name="'+el_name+'" data-level="'+level+'">'+level+' ('+level_energy+' eV)</a></li>';
			    level_list.push(level_li);
            }
		});
        if(level_list.length > 0){
		    $('#element_levels').html(level_list.join(""));
        } else {
            $('#element_levels').html('Sorry, no remaining levels.');
        }
		// Show level picker
        $('#periodic_table_div').slideUp();
		$('#level_selection').slideDown();
	});

	// Click event - Level select
	$('#element_levels').on('click', '.level_select' ,function(e){
		e.preventDefault();
		var el = $(this).data('element');
		var el_name = $(this).data('element-name');
		var level = $(this).data('level');
		add_level(el, el_name, level);
        $(this).parent().hide();
        if($('#element_levels li:visible').length == 0){
            reset_form();
        }
	});

	// Add an element level
	function add_level(el, el_name, level){
		// Add new level
		var newlevel = el + '_' + level;
		if ($('#'+newlevel).length){
			alert('Error - this edge has already been added..');
		} else {
			var newlevel = '<div id="'+newlevel+'" class="level_edge '+buttonClass+'">';
			newlevel += el_name+' - '+level+' ('+edges[el][level]+' eV)';
			newlevel += '<input type="hidden" name="eelsdb_spectra_spectrumEdges[]" value="'+el+'_'+level+'" />';
			newlevel += '<div style="clear:both;"></div>';
			newlevel += '</div>';
			$('#eelsdb_edges_added_edges').append(newlevel);
			$('#eelsdb_edges_added_edges').slideDown();
		}
    }

    // Hide selection panel
    $('#level_selection').on('click', '.close' ,function(e){
		reset_form();
	});

	// Reset form
    function reset_form(){
    	$('#edge_selection').slideUp('slow', function(){
    		$('#periodic_table_div').show();
    		$('#level_selection').hide();
    	});
    }

	// Click event - Existing edge delete
	$('#eelsdb_edges_added_edges').on('click', '.level_edge' ,function(e){
		e.preventDefault();
		$(this).remove();
		if($('#eelsdb_edges_added_edges .level_edge').length == 0){
			$('#eelsdb_edges_added_edges').slideUp();
		}
	});


	/////// FORM VALIDATION
	// Override defaults for jQuery Validate
	if(!admin){
		$.validator.setDefaults({
			highlight: function(element) {
				if($(element).parent().parent().hasClass('form-inline')) {
					$(element).parent().parent().parent().parent().addClass('has-error');
				} else {
					$(element).closest('.form-group').addClass('has-error');
				}
			},
			unhighlight: function(element) {
				if($(element).parent().parent().hasClass('form-inline')) {
					$(element).parent().parent().parent().parent().removeClass('has-error');
				} else {
					$(element).closest('.form-group').removeClass('has-error');
				}
			},
			errorElement: 'span',
			errorClass: 'help-block',
			errorPlacement: function(error, element) {
				if(element.attr("name") == "eelsdb_spectra_spectrumUpload") {
					error.insertAfter(element.parent().parent().parent());
				} else if(element.parent().parent().hasClass('form-inline')) {
					error.insertAfter(element.parent().parent());
				} else if(element.parent('.input-group').length){
					error.insertAfter(element.parent());
				} else {
					error.insertAfter(element);
				}
			}
		});

		// Swap out commas with full stops for numbers
		$("#eelsdb_spectra_integratetime").keyup(function(){
			var val = $(this).val().replace(/\,/g,'.');
			$(this).val(val);
		});
		// Validate the Spectra Form submission
		var validated_spectra_form = $("#post, #eelsdb_submit_form").validate({
			rules: {
				eelsdb_spectra_spectrumUpload: {
					required: true,
					extension: 'msa|dm3|csv|txt',
					accept:'*'
				},
				eelsdb_spectra_zeroloss_deconv_method: {
					required: function(element) {
						return $("input:radio[name='eelsdb_spectra_zeroloss_deconv']:checked").val() == '1';
					}
				},
				eelsdb_spectra_pluralscattering_deconv_method: {
					required: function(element) {
						return $("input:radio[name='eelsdb_spectra_pluralscattering_deconv']:checked").val() == '1';
					}
				},
				eelsdb_spectra_integratetime: {
					number: true
				},
			},
			showErrors: function(errorMap, errorList) {
				if(this.numberOfInvalids() != '0'){
					if($('#eelsb_spectra_errors_summary').length == 0){
						$('.wrap h2, #eelsdb_submit_introText').after('<div id="eelsb_spectra_errors_summary" class="error below-h2 alert alert-danger" style="display:none;"></div>');
					}
					$("#eelsb_spectra_errors_summary").html("<p><strong>Oops! Something is wrong..</strong> Your form contains <strong>" + this.numberOfInvalids() + "</strong> errors, please see below for details...</p>");
					$("#eelsb_spectra_errors_summary").slideDown();
				} else {
					$('#eelsb_spectra_errors_summary').slideUp('normal', function() { $(this).remove(); });
				}
				this.defaultShowErrors();
			},
			messages: {
				eelsdb_spectra_spectrumUpload: {
					required: "You must upload a spectra file",
					extension: "File extension must be .msa .dm3 .csv or .txt"
				}
			}
	    });

		// Log whether the form has been submitted or not
		$('#publish, #eelsdb_spectra_submit_btn').click(function(){
			form_submitted = true;
		});

		// Revalidate specific fields when specific fields change
		$("input:radio[name='eelsdb_spectra_zeroloss_deconv']").change(function() {
			if(form_submitted){
				$('#eelsdb_spectra_zeroloss_deconv_method').valid();
			}
			show_hide_deconv();
		});
		$("input:radio[name='eelsdb_spectra_pluralscattering_deconv']").change(function() {
			if(form_submitted){
				$('#eelsdb_spectra_pluralscattering_deconv_method').valid();
			}
			show_hide_deconv();
		});
		// Revalidate entire form when certain fields change
		$('#eelsdb_spectra_spectrumType').change(function(){
			if(form_submitted){
				// Reset the form. Remove error div. Validate form.
				validated_spectra_form.resetForm();
				$('#eelsb_spectra_errors_summary').remove();
				validated_spectra_form.form();
			}
		});
	}


	/////// FORM AWESOMENESS

	// Hide irrelevant fields if Zero-loss is selected
	$('#eelsdb_spectra_spectrumType').change(function() {
		hide_show_fields();
	});
	function hide_show_fields (){
		// Hide or show fields based on spectrum type
		if($('#eelsdb_spectra_spectrumType').val() == 'zeroloss'){
			$('.hide-zero').hide();
			$('.show-zero').show();
		} else {
			$('.hide-zero').show();
			$('.show-zero').hide();
		}
	}
	hide_show_fields(); // Run on page load

	// Function to show and hide deconv methods
	function show_hide_deconv () {
		if($("input:radio[name='eelsdb_spectra_zeroloss_deconv']:checked").val() == '1'){
			if(admin){
				$('#eelsdb_spectra_zeroloss_deconv_method, #eelsdb_spectra_zeroloss_deconv_method_label').show();
			} else {
				$('#eelsdb_spectra_zeroloss_deconv_method_form_group').slideDown();
			}
		} else {
			if(admin){
				$('#eelsdb_spectra_zeroloss_deconv_method, #eelsdb_spectra_zeroloss_deconv_method_label').hide();
			} else {
				$('#eelsdb_spectra_zeroloss_deconv_method_form_group').slideUp();
			}
		}
		if($("input:radio[name='eelsdb_spectra_pluralscattering_deconv']:checked").val() == '1'){
			if(admin){
				$('#eelsdb_spectra_pluralscattering_deconv_method, #eelsdb_spectra_pluralscattering_deconv_method_label').show();
			} else {
				$('#eelsdb_spectra_pluralscattering_deconv_method_form_group').slideDown();
			}
		} else {
			if(admin){
				$('#eelsdb_spectra_pluralscattering_deconv_method, #eelsdb_spectra_pluralscattering_deconv_method_label').hide();
			} else {
				$('#eelsdb_spectra_pluralscattering_deconv_method_form_group').slideUp();
			}
		}
	}
	show_hide_deconv(); // Run on page load

	// Show or hide file upload when editing a spectrum
	$('#spectra_new_file_upload').click(function(e){
		e.preventDefault();
		$('#current_spectra_file').hide();
		$('#new_spectra_file').show();
	});
	$('#spectra_cancel_new_file_upload').click(function(e){
		e.preventDefault();
		$('#current_spectra_file').show();
		$('#new_spectra_file').hide();
	});

	// Making the bootstrap file input look good..
	// http://www.surrealcms.com/blog/whipping-file-inputs-into-shape-with-bootstrap-3
	$(document).on('change', '.btn-file :file', function() {
		var input = $(this),
			numFiles = input.get(0).files ? input.get(0).files.length : 1,
			label = input.val().replace(/\\/g, '/').replace(/.*\//, '');
		input.trigger('fileselect', [numFiles, label]);
	});
    $('.btn-file :file').on('fileselect', function(event, numFiles, label) {
		var input = $(this).parents('.input-group').find(':text'), log = numFiles > 1 ? numFiles + ' files selected' : label;
		if( input.length ) {
			input.val(log);
		} else {
			if( log ) alert(log);
		}
	});

	// Making the yes/no radio buttons look good..
	if(!admin){
		$('.btn').button();
	}

	// Prevent double form submission
	var form_submitted = false;
	$('#eelsdb_spectra_submit_btn').click(function(){
		form_submitted = true;
	});

	// Check before navigating away
	window.onbeforeunload = function(){
		if(!admin){
			if(hasFormChanged() && !form_submitted){
				return 'You will lose your unsaved changes if you navigate away..';
			}
		}
	}

	// Function to detect changes from rendered values
	hasFormChanged = function() {
		var changed = false;
		$('#eelsdb_submit_form input[type="text"], #eelsdb_submit_form input[type="email"], #eelsdb_submit_form textarea').each(function() {
			if ($(this).prop('defaultValue') != $(this).val()) {
				changed = true;
			}
		});
		$('#eelsdb_submit_form input[type="checkbox"], #eelsdb_submit_form input[type="radio"]').each(function(elem) {
			if ($(this).prop('defaultChecked') != $(this).prop('checked')) {
				changed = true;
			}
		});
		$('#eelsdb_submit_form select').each(function(elem) {
			if ($(this).prop('defaultSelected') != undefined && $(this).prop('defaultSelected') != $(this).prop('selectedIndex')) {
				changed = true;
			}
		});
		return changed;
	}


	/////// DOI LOOKUP
	// Type in a doi and bingo! You have the whole reference.
	$('#find_doi').click(function(e){
		// setup
		e.preventDefault();
		$('#doi_spinner').show();
		$(this).addClass('disabled');
		var doi = $('#eelsdb_spectra_ref_doi').val();
		doi = doi.trim();
		// Check that we have a DOI
		if(doi.length == 0){
			alert('Please enter a DOI.');
		} else {
			// Get the crossref response
			$.getJSON( "https://api.crossref.org/works/"+doi+"/transform/application/json")
			.done(function(data){
				$('#eelsdb_spectra_ref_url').val(data['URL']);
				$('#eelsdb_spectra_ref_journal').val(data['container-title']);
				$('#eelsdb_spectra_ref_volume').val(data['volume']);
				$('#eelsdb_spectra_ref_issue').val(data['issue']);
				$('#eelsdb_spectra_ref_page').val(data['page']);
				$('#eelsdb_spectra_ref_year').val(data['issued']['date-parts'][0][0]);
				$('#eelsdb_spectra_ref_title').val(data['title']);
				var authors = [];
				$.each(data['author'], function(i, val){
					authors.push(val['given']+" "+val['family']);
				});
				$('#eelsdb_spectra_ref_authors').val(authors.join(', '));
			}).fail(function(){
				alert("Error: DOI not found on crossref.")
			});
		}
		// Restore resting state
		$('#doi_spinner').hide();
		$(this).removeClass('disabled');
	});


});
