import argparse
import json
import sys

from eelsdb import __version__

SEVERITY_ORDER = {"error": 0, "warning": 1, "info": 2}


def check(args):
    from eelsdb import checks
    from eelsdb.io import read_spectrum

    try:
        sp = read_spectrum(args.file)
    except Exception as e:  # any reader failure means the file is unusable
        findings = [checks.Finding("unreadable", "error", f"The file could not be read: {e}")]
    else:
        elements = args.elements.split(",") if args.elements else checks.formula_elements(args.formula)
        findings = checks.run_all(
            sp.energy, sp.intensity,
            spectrum_type=args.type,
            formula=args.formula,
            elements=elements,
            edges=args.edges.split(";") if args.edges else (),
            edge_table=checks.exspy_edge_table() if elements else None,
            thickness=args.thickness,
            header_axis=sp.header_axis,
        )
    findings.sort(key=lambda f: SEVERITY_ORDER[f.severity])
    if args.json:
        print(json.dumps([f.as_dict() for f in findings], indent=1))
    elif not findings:
        print(f"{args.file}: no problems found")
    else:
        for f in findings:
            print(f"{f.severity.upper():8} {f.code}: {f.message}")
    return 1 if any(f.severity == "error" for f in findings) else 0


def main(argv=None):
    parser = argparse.ArgumentParser(prog="eelsdb", description="Tools for the EELS Data Base")
    parser.add_argument("--version", action="version", version=f"eelsdb {__version__}")
    sub = parser.add_subparsers(dest="command")

    p = sub.add_parser("check", help="check a spectrum file offline")
    p.add_argument("file")
    p.add_argument("--type", choices=["coreloss", "lowloss", "zeroloss", "xrayabs"], help="spectrum type")
    p.add_argument("--formula", help="chemical formula, e.g. Fe2O3")
    p.add_argument("--elements", help="comma-separated element symbols (default: from the formula)")
    p.add_argument("--edges", help="semicolon-separated edges, e.g. 'Fe_L2,3;O_K'")
    p.add_argument("--thickness", type=float, help="stated thickness in t/λ")
    p.add_argument("--json", action="store_true", help="print findings as JSON")
    p.set_defaults(func=check)

    args = parser.parse_args(argv)
    if not args.command:
        parser.print_help()
        return 0
    return args.func(args)


if __name__ == "__main__":
    sys.exit(main())
