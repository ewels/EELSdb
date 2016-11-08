from django.shortcuts import get_object_or_404, render
from django.http import HttpResponseRedirect, HttpResponse
from django.urls import reverse

from .spectrum_upload import UploadSpectraForm, ParseSpectraFile
from .models import Spectrum

def index(request):
    latest_spectra_list = Spectrum.objects.order_by('-pub_date')[:5]
    context = {'latest_spectra_list': latest_spectra_list}
    return render(request, 'spectra/index.html', context)

def detail(request, spectrum_id):
    spectrum = get_object_or_404(Spectrum, pk=spectrum_id)
    return render(request, 'spectra/detail.html', {'spectrum': spectrum})

def upload(request):
    context = {}
    if request.method == 'POST':
        context['form'] = UploadSpectraForm(request.POST, request.FILES)
        if context['form'].is_valid():
            spectrum = ParseSpectraFile(request.FILES['spectrum_file'])
            if spectrum is not None:
                return HttpResponseRedirect('/spectra/edit/1')
            else:
                context['error_message'] = "Could not save spectrum"
        else:
            context['error_message'] = "Form was not valid"
    else:
        context['form'] = UploadSpectraForm()
        context['error_message'] = "Request Method was not POST"
    return render(request, 'spectra/upload.html', context) 

def edit(request, spectrum_id):
    spectrum = get_object_or_404(Spectrum, pk=spectrum_id)
    return render(request, 'spectra/edit.html', {'spectrum': spectrum})