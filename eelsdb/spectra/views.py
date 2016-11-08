from django.shortcuts import get_object_or_404, render
from django.http import HttpResponseRedirect, HttpResponse
from django.urls import reverse

from .spectrum_upload import UploadSpectraForm, ParseSpectraFile
from .models import Spectrum

def index(request):
    """ Spectra browse page"""
    latest_spectra_list = Spectrum.objects.order_by('-pub_date')[:5]
    context = {'latest_spectra_list': latest_spectra_list}
    return render(request, 'spectra/index.html', context)

def detail(request, spectrum_id):
    """ Single spectrum detail page"""
    spectrum = get_object_or_404(Spectrum, pk=spectrum_id)
    return render(request, 'spectra/detail.html', {'spectrum': spectrum})

def upload(request):
    """ Spectrum upload page"""
    context = {}
    if request.method == 'POST':
        # Create the form with the submitted data in case of error
        context['form'] = UploadSpectraForm(request.POST, request.FILES)
        if context['form'].is_valid():
            # Save a draft of the new spectrum
            spectrum = ParseSpectraFile(request.FILES['spectrum_file'])
            if spectrum is not None:
                # REDIRECT to edit page for new spectrum
                return HttpResponseRedirect(reverse('spectra:edit', args=(spectrum.id,)))
            else:
                context['error_message'] = "Could not save spectrum"
        else:
            context['error_message'] = "Form was not valid"
    else:
        # Fresh page load - fresh form
        context['form'] = UploadSpectraForm()
    return render(request, 'spectra/upload.html', context) 

def edit(request, spectrum_id):
    """ Edit spectrum page"""
    spectrum = get_object_or_404(Spectrum, pk=spectrum_id)
    return render(request, 'spectra/edit.html', {'spectrum': spectrum})

