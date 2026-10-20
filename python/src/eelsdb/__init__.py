from importlib.metadata import version

__version__ = version("eelsdb")


def load(spectrum, api=None):
    """One EELSdb spectrum (id or slug) as a HyperSpy signal with its metadata. Imports HyperSpy on first use."""
    from eelsdb.loader import load as _load

    return _load(spectrum, api)
