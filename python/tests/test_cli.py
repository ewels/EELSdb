import pytest

from eelsdb import __version__
from eelsdb.cli import main


def test_version(capsys):
    with pytest.raises(SystemExit):
        main(["--version"])
    assert __version__ in capsys.readouterr().out
