from django.conf.urls import url

from . import views

app_name = 'spectra'
urlpatterns = [
    ###### WEB URLs
    # /spectra/
    url(r'^$', views.index, name='index'),
    
    # /spectra/5/
    url(r'^(?P<spectrum_id>[0-9]+)/$', views.detail, name='detail'),
    
    # /spectra/upload/
    url(r'^upload/$', views.upload, name='upload'),
    
    # /spectra/edit/
    url(r'^edit/(?P<spectrum_id>[0-9]+)$', views.edit, name='edit'),
    
    ###### API URLs
    # 
]