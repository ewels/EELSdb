/*//////////////////////////////////////////
// EELS DB Spectra Plugin
// eelsdb-spectra.js
// Javascript to make the browse & view spectrum pages work
//////////////////////////////////////////*/

jQuery().ready(function($) {

	$('#periodic_table a').click(function(e){
		e.preventDefault();
		if($(this).hasClass('active')){
			$(this).removeClass('active');
			$('input[name="spectrumElements[]"][value="'+$(this).text()+'"]').remove();
			$('#element_filter_label_'+$(this).text()).remove();
		} else {
			$(this).addClass('active');
			$('#periodicTableButton').after('<input type="hidden" name="spectrumElements[]" value="'+$(this).text()+'">');
			$('#element_filter_label_label').append(' <a href="#" data-toggle="modal" data-target="#periodicTableModal" class="label label-default element_filter_label" id="element_filter_label_'+$(this).text()+'">'+$(this).text()+'</a>');
		}
		if($('.element_filter_label').length > 0){
			$('#element_filter_label_label').slideDown();
		} else {
			$('#element_filter_label_label').slideUp();
		}
	});
	
	$('#hc_independent_axes').click(function(e){
		e.preventDefault();
		if($(this).text() == 'Share Axis'){
			$('#eelsdb_spectrum_plot').highcharts().yAxis[1].update({
				visible: false,
				title: { style: { display: 'none' }}
			});
			$('#eelsdb_spectrum_plot').highcharts().series[1].update({ yAxis: 0 });
			$(this).text('Independent Axes');
		} else {
			$('#eelsdb_spectrum_plot').highcharts().yAxis[1].update({
				visible: true,
				title: { style: { display: 'block' }}
			});
			$('#eelsdb_spectrum_plot').highcharts().series[1].update({ yAxis: 1 });
			$(this).text('Share Axis');
		}
	});

});
