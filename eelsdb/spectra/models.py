from django.db import models
from datetime import date


class Spectrum(models.Model):
    """
    Main Spectrum model class
    One created for every spectrum in the database. We allow everything to be
    blank and empty at model level so that we can save a draft of whatever
    we like. The form then adds field requirements for publishing.
    """
    
    DRAFT = 'draft'
    READY = 'ready'
    PUBLISHED = 'published'
    STATUS_CHOICES = (
        (DRAFT, 'Draft'),
        (READY, 'Awaiting moderation'),
        (PUBLISHED, 'Published'),
    )
    STATUS = models.CharField(max_length=10, choices=STATUS_CHOICES, default='draft')
    
    TITLE = models.CharField('Title', max_length=200, blank=True)
    
    FORMULA = models.CharField('Formula', max_length=200, blank=True)
    SOURCE = models.CharField('Source', max_length=200, blank=True)
    PURITY = models.CharField('Purity', max_length=200, blank=True)
    COMMENTS = models.TextField('Comments', blank=True)
    
    MICROSCOPE = models.CharField('Microscope', max_length=200, blank=True)
    GUNTYPE = models.CharField('Guntype', max_length=200, blank=True)
    BEAMENERGY = models.DecimalField('Incident Beam Energy', max_digits=10, decimal_places=3, null=True, blank=True)
    RESOLUTION = models.DecimalField('Resolution', max_digits=10, decimal_places=3, null=True, blank=True)
    MONOCHROMATED = models.BooleanField('Monochromated', default=False)
    
    CONVERGENCE = models.DecimalField('Convergence Semi-angle', max_digits=10, decimal_places=3, null=True, blank=True)
    COLLECTION = models.DecimalField('Collection Semi-angle', max_digits=10, decimal_places=3, null=True, blank=True)
    PROBESIZE = models.DecimalField('Probe Size', max_digits=10, decimal_places=3, null=True, blank=True)
    BEAMCURRENT = models.DecimalField('Beam Current', max_digits=10, decimal_places=3, null=True, blank=True)
    INTEGRATETIME = models.DurationField('Integration Time', null=True, blank=True)
    READOUTS = models.IntegerField('Number of Readouts', null=True, blank=True)
    DETECTOR = models.CharField('Detector', max_length=200, blank=True)
    
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
        choices = ACQUISITION_MODE_CHOICES,
        null=True,
        blank=True
    )

    DARKCURRENT = models.BooleanField('Dark Current Correction', default=False)
    GAINVARIATION = models.BooleanField('Gain Variation Spectrum', default=False)
    CALIBRATION = models.CharField('Calibration', max_length=200, blank=True)
    THICKNESS = models.DecimalField('Relative Thickness', max_digits=10, decimal_places=3, null=True, blank=True)
    DECONV_FOURIER_LOG = models.BooleanField('Fourier-log', default=False)
    DECONV_FOURIER_RATIO = models.BooleanField('Fourier-ratio', default=False)
    DECONV_STEPHENS_DECONVOLUTION = models.BooleanField("Stephen's deconvolution", default=False)
    DECONV_RICHARDSON_LUCY = models.BooleanField('Richardson-Lucy', default=False)
    DECONV_MAXIMUM_ENTROPY = models.BooleanField('Maximum-Entropy', default=False)
    DECONV_OTHER = models.CharField('Other Deconvolution', max_length=200, blank=True)
    
    LICENCE_AGREE = models.BooleanField('Licence Agreement', default=False)
    
    submit_date = models.DateTimeField('date submitted', blank=True)
    pub_date = models.DateTimeField('date published', blank=True)
    
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
    
    