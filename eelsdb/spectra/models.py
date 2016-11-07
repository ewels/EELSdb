from django.db import models
from datetime import date


class Spectrum(models.Model):
    """
    Main Spectrum model class
    One created for every spectrum in the database.
    """
    TITLE = models.CharField('Title', max_length=200, unique=True)
    
    FORMULA = models.CharField('Formula', max_length=200)
    SOURCE = models.CharField('Source', max_length=200, blank=True)
    PURITY = models.CharField('Purity', max_length=200, blank=True)
    COMMENTS = models.TextField('Comments', blank=True)
    
    MICROSCOPE = models.CharField('Microscope', max_length=200)
    GUNTYPE = models.CharField('Guntype', max_length=200)
    BEAMENERGY = models.DecimalField('Incident Beam Energy', max_digits=10, decimal_places=3)
    RESOLUTION = models.DecimalField('Resolution', max_digits=10, decimal_places=3)
    MONOCHROMATED = models.BooleanField('Monochromated')
    
    CONVERGENCE = models.DecimalField('Convergence Semi-angle', max_digits=10, decimal_places=3)
    COLLECTION = models.DecimalField('Collection Semi-angle', max_digits=10, decimal_places=3)
    PROBESIZE = models.DecimalField('Probe Size', max_digits=10, decimal_places=3)
    BEAMCURRENT = models.DecimalField('Beam Current', max_digits=10, decimal_places=3)
    INTEGRATETIME = models.DurationField('Integration Time')
    READOUTS = models.IntegerField('Number of Readouts')
    DETECTOR = models.CharField('Detector', max_length=200)
    
    # TODO:
    # EDGES
    # MIN
    # MAX
    # STEPSIZE
    # ELEMENT
    # ZEROLOSS_DECONV
    
    ACQUISITION_MODE_CHOICES = (
        ('imaging', 'Imaging'),
        ('diffraction', 'Diffraction'),
        ('stem', 'STEM'),
        ('xas_electron_yield', 'XAS Electron Yield'),
        ('xas_transmission', 'XAS Transmission'),
        ('fluorescence', 'Fluorescence')
    )
    ACQUISITION_MODE = models.CharField(
        'Acquisition mode',
        max_length = 20,
        choices = ACQUISITION_MODE_CHOICES
    )

    DARKCURRENT = models.BooleanField('Dark Current Correction')
    GAINVARIATION = models.BooleanField('Gain Variation Spectrum')
    CALIBRATION = models.CharField('Calibration', max_length=200)
    THICKNESS = models.DecimalField('Relative Thickness', max_digits=10, decimal_places=3)
    DECONV_FOURIER_LOG = models.BooleanField('Fourier-log')
    DECONV_FOURIER_RATIO = models.BooleanField('Fourier-ratio')
    DECONV_STEPHENS_DECONVOLUTION = models.BooleanField("Stephen's deconvolution")
    DECONV_RICHARDSON_LUCY = models.BooleanField('Richardson-Lucy')
    DECONV_MAXIMUM_ENTROPY = models.BooleanField('Maximum-Entropy')
    DECONV_OTHER = models.CharField('Other Deconvolution', max_length=200)
    
    LICENCE_AGREE = models.BooleanField('Licence Agreement')
    
    submit_date = models.DateTimeField('date submitted')
    pub_date = models.DateTimeField('date published')
    
    def __str__(self):
        return self.TITLE


class Reference(models.Model):
    """
    Spectrum Reference model
    Each spectrum can have any number of references. The object
    is designed to handle references of different types (URLs, papers)
    """
    SPECTRUM = models.ForeignKey(Spectrum, on_delete=models.CASCADE)
    
    TITLE = models.CharField(max_length=200)
    FREETEXT = models.CharField(max_length=200)
    DOI = models.CharField(max_length=200)
    URL = models.CharField(max_length=200)
    AUTHORS = models.CharField(max_length=200)
    JOURNAL = models.CharField(max_length=200)
    VOLUME = models.CharField(max_length=200)
    ISSUE = models.CharField(max_length=200)
    PAGE = models.CharField(max_length=200)
    YEAR = models.IntegerField(default=date.today().year)
    
    
    def __str__(self):
        return self.TITLE
    
    