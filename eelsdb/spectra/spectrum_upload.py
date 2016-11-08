from django import forms
from django.utils import timezone

from .models import Spectrum

class UploadSpectraForm(forms.Form):
    spectrum_file = forms.FileField()

def ParseSpectraFile(fn):
    
    filename = fn.name
    
    s = Spectrum(TITLE=filename, submit_date=timezone.now(), pub_date=timezone.now())
    
    # TODO: Save this spectrum..
    
    return s
    