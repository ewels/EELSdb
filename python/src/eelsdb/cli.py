import argparse

from eelsdb import __version__


def main(argv=None):
    parser = argparse.ArgumentParser(prog="eelsdb", description="Tools for the EELS Data Base")
    parser.add_argument("--version", action="version", version=f"eelsdb {__version__}")
    parser.parse_args(argv)
    parser.print_help()
