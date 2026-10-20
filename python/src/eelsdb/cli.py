import argparse
import json
import sys
from pathlib import Path

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


def login(args):
    import getpass
    import webbrowser

    from eelsdb.client import ApiError, Client, load_config, save_config, site_url

    api = args.api or load_config()["api"]
    url = f"{site_url(api)}/account/tokens/"
    print(f"Create a token at {url} (opening it in your browser), then paste it here.")
    webbrowser.open(url)
    token = getpass.getpass("Token: ").strip()
    try:
        me = Client(api, token).me()
    except ApiError as e:
        print(f"That token did not work ({e.message}).", file=sys.stderr)
        return 1
    save_config(api, token)
    print(f"Signed in as {me['display_name']}. Token saved.")
    return 0


SUBMIT_FIELDS = ["title", "type", "formula", "elements", "edges", "keywords", "source_purity", "description", "microscope",
                 "detector", "gun_type", "acquisition_mode", "beam_energy", "convergence", "collection", "resolution_ev",
                 "dispersion_ev", "monochromated", "integration_time_s", "readouts", "ref_doi", "thickness_t_lambda"]


def submit(args):
    from eelsdb import checks
    from eelsdb.client import ApiError, Client
    from eelsdb.io import read_any

    path = Path(args.path)
    if path.is_dir():
        # A folder: every spectrum file with a same-named .json file of form fields next to it.
        jobs = [(f, json.loads(f.with_suffix(".json").read_text())) for f in sorted(path.iterdir())
                if f.suffix.lower() in (".msa", ".dm3", ".dm4", ".txt", ".csv", ".emd", ".hspy") and f.with_suffix(".json").exists()]
        if not jobs:
            print(f"No spectrum files with a matching .json file in {path}.", file=sys.stderr)
            return 1
    else:
        jobs = [(path, {k: getattr(args, k) for k in SUBMIT_FIELDS if getattr(args, k, None) is not None})]

    client = Client()
    failed = 0
    for file, fields in jobs:
        fields.setdefault("title", file.stem)
        # Values not given are sent as "unknown", which the form accepts.
        fields.setdefault("beam_energy_choice", "other" if "beam_energy" in fields else "unknown")
        for angle in ("convergence", "collection"):
            if angle not in fields:
                fields[f"{angle}_unknown"] = "1"
        try:
            sp = read_any(file)
            found = checks.run_all(sp.energy, sp.intensity, spectrum_type=fields.get("type"), formula=fields.get("formula"),
                                   header_axis=sp.header_axis) if sp.energy is not None else []
            fields["checks"] = json.dumps({"cli": True, "findings": [f.as_dict() for f in found]})
            errors = [f for f in found if f.severity == "error"]
            if errors and not args.force:
                print(f"{file.name}: not submitted, the checks found errors (use --force to submit anyway):", file=sys.stderr)
                for f in errors:
                    print(f"  {f.message}", file=sys.stderr)
                failed += 1
                continue
        except Exception as e:  # the server still accepts files this machine cannot read
            print(f"{file.name}: could not check locally ({e}); submitting anyway.", file=sys.stderr)
        try:
            out = client.submit(fields, file)
            print(f"{file.name}: submitted as {out['slug']} (waiting for review)")
        except ApiError as e:
            print(f"{file.name}: {e.message} {json.dumps(e.errors) if e.errors else ''}", file=sys.stderr)
            failed += 1
    return 1 if failed else 0


def export(args):
    from eelsdb.export import main as run_export

    return run_export(args.out, args.upload)


def review(args):
    import tempfile
    import webbrowser

    from eelsdb.client import Client
    from eelsdb.review import process

    client = Client()
    queue = client.queue()
    if args.id:
        queue = [q for q in queue if q["id"] == args.id]
    if not queue:
        print("Nothing to review.")
        return 0
    for item in queue:
        detail = client.submission(item["id"])
        print(f"\n#{item['id']} {item['title']} ({item['kind']}, from {item['submitter']})")
        work = Path(tempfile.mkdtemp(prefix=f"eelsdb-review-{item['id']}-"))
        # An edit with a new file is reviewed on that file; otherwise on the spectrum's original.
        original = next((f for role in ("edit", "original") for f in detail["files"] if f["role"] == role), None)
        if not original:
            print("  No file to check; decide on the website.")
            continue
        path = client.download(item["id"], original["role"], work / Path(original["filename"]).name)
        result = process(detail, path, work)
        for f in result["findings"]:
            print(f"  {f.severity.upper():8} {f.message}")
        print(f"  Review page: {result['report']}")
        if not args.no_browser:
            webbrowser.open(result["report"].as_uri())
        try:
            choice = input("  [a]pprove, [c]hanges requested, [r]eject, [s]kip? ").strip().lower()[:1]
        except EOFError:
            print("\nStopped.")
            return 0
        if choice == "a":
            for role, out in result["outputs"].items():
                client.upload(item["id"], role, out)
            client.processing(item["id"], result["record"])
            client.decide(item["id"], "approve")
            print("  Published.")
        elif choice in ("c", "r"):
            notes = input("  Notes for the submitter: ").strip()
            client.decide(item["id"], "request_changes" if choice == "c" else "reject", notes)
            print("  Done.")
    return 0


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

    p = sub.add_parser("login", help="save an API token for submit and review")
    p.add_argument("--api", help="API address (default https://api.eelsdb.eu)")
    p.set_defaults(func=login)

    p = sub.add_parser("submit", help="submit a spectrum file, or a folder of files with .json fields")
    p.add_argument("path")
    p.add_argument("--type", choices=["coreloss", "lowloss", "zeroloss", "xrayabs"])
    for field in SUBMIT_FIELDS:
        if field != "type":
            p.add_argument(f"--{field.replace('_', '-')}", dest=field)
    p.add_argument("--force", action="store_true", help="submit even if the local checks find errors")
    p.set_defaults(func=submit)

    p = sub.add_parser("export", help="build the zip of all public spectra and metadata")
    p.add_argument("--out", default="eelsdb-spectra.zip")
    p.add_argument("--upload", action="store_true", help="admins: upload it for the Downloads page")
    p.set_defaults(func=export)

    p = sub.add_parser("review", help="moderators: reprocess and decide on queued submissions")
    p.add_argument("--id", type=int, help="only this submission")
    p.add_argument("--no-browser", action="store_true", help="do not open the review page")
    p.set_defaults(func=review)

    args = parser.parse_args(argv)
    if not args.command:
        parser.print_help()
        return 0
    return args.func(args)


if __name__ == "__main__":
    sys.exit(main())
