#!/usr/bin/env python3
"""Read-only installer assessment using extracted functions and local fixtures.

Run with IVLYRICS_SOURCE_ROOT=/path/to/checkout or --source-root /path/to/checkout.
Only download_source and cmd_update are extracted; the installer is never sourced.
Exit 1 means an invalid archive reached an inert update collaborator.
"""

import argparse
import gzip
import hashlib
import io
import json
import os
from pathlib import Path
import random
import re
import shlex
import shutil
import subprocess
import tarfile
import tempfile


DEFAULT_ROOT = str(Path(__file__).resolve().parents[2])
EFFECTS = {"spotify_quit", "heal_links", "cmd_backup", "sync_app_dir",
           "cleanup_work_tmp", "apply_spicetify", "spotify_launch_now_if_owed"}


def extract_function(source, name):
    match = re.search(r"^" + re.escape(name) + r"\(\) \{\n.*?^\}", source,
                      re.MULTILINE | re.DOTALL)
    if match is None:
        raise RuntimeError(f"Could not extract {name}")
    return match.group(0)


def archive_bytes(missing_index=False):
    # Required files deliberately precede a large asset and a final file.
    # Cutting the compressed stream halfway leaves the two required files intact.
    payloads = [("manifest.json", b'{"name":"synthetic-fixture"}\n')]
    if not missing_index:
        payloads.append(("index.js", b"// Synthetic inert fixture.\n"))
    payloads += [
        ("asset.bin", random.Random(20261006).randbytes(128 * 1024)),
        ("tail.js", b"// This file follows the large asset.\n"),
    ]
    stream = io.BytesIO()
    with tarfile.open(fileobj=stream, mode="w", format=tarfile.USTAR_FORMAT) as tar:
        directory = tarfile.TarInfo("fixture-source")
        directory.type = tarfile.DIRTYPE
        directory.mode = 0o755
        tar.addfile(directory)
        for name, data in payloads:
            member = tarfile.TarInfo("fixture-source/" + name)
            member.size = len(data)
            member.mode = 0o644
            tar.addfile(member, io.BytesIO(data))
    return gzip.compress(stream.getvalue(), mtime=0)


def run_case(base, bin_dir, functions, case, mode, archive, bash, real_tar):
    case_dir = base / (case + "-" + mode)
    case_dir.mkdir()
    work = case_dir / "work"
    work.mkdir()
    events = case_dir / "events.txt"
    events.touch()
    q = shlex.quote
    script = f"""set -euo pipefail
CASE_ROOT={q(str(case_dir))}
WORK_FIXTURE={q(str(work))}
ARCHIVE_FIXTURE={q(str(archive))}
EVENT_LOG={q(str(events))}
REAL_TAR={q(real_tar)}
TAR_CASE={q(case)}
REPO=synthetic/inert
REF=fixture
APP_NAME=ivLyrics
APP_DIR="$CASE_ROOT/inert-app"
WORK_TMP="$WORK_FIXTURE"

record() {{ printf '%s\\n' "$*" >> "$EVENT_LOG"; }}
require_macos() {{ :; }}
require_command() {{ :; }}
log() {{ record "log:$*"; }}
die() {{ record "die:$*"; printf '%s\\n' "$*" >&2; exit 1; }}
installed_version() {{ printf 'synthetic'; }}
protection_state() {{ printf 'unprotected'; }}
mktemp() {{ printf '%s' "$WORK_FIXTURE"; }}

# Inert local copy: no curl binary is available on PATH.
curl() {{
  [ "$#" -eq 6 ] && [ "$1" = '-fsSL' ] && [ "$2" = '--connect-timeout' ] &&
    [ "$3" = 20 ] && [ "$4" = 'https://codeload.github.com/synthetic/inert/tar.gz/fixture' ] &&
    [ "$5" = '-o' ] && [ "$6" = "$WORK_FIXTURE/src.tar.gz" ] || exit 90
  cp "$ARCHIVE_FIXTURE" "$6"
}}

# Real tar is restricted to the archive and extraction destination owned here.
tar() {{
  [ "$#" -eq 4 ] && [ "$1" = '-xzf' ] && [ "$2" = "$WORK_FIXTURE/src.tar.gz" ] &&
    [ "$3" = '-C' ] && [ "$4" = "$WORK_FIXTURE" ] || exit 91
  local status=0
  record "tar_shell_flags:$-"
  case "$TAR_CASE" in
    inert_empty_failure) status=73 ;;
    inert_partial_failure)
      mkdir "$WORK_FIXTURE/fixture-source"
      printf '{{}}' > "$WORK_FIXTURE/fixture-source/manifest.json"
      printf '// inert' > "$WORK_FIXTURE/fixture-source/index.js"
      status=73 ;;
    *) if "$REAL_TAR" "$@"; then status=0; else status=$?; fi ;;
  esac
  record "tar_status:$status"
  return "$status"
}}
"""
    for effect in sorted(EFFECTS):
        script += f'{effect}() {{ record "{effect}"; }}\n'
    # Additional defense: a future function change cannot execute app binaries.
    for app in ("spicetify", "rsync", "osascript", "launchctl", "open", "pgrep", "pkill"):
        script += f'{app}() {{ record "unexpected_app:{app}"; return 92; }}\n'
    script += "\n" + functions + "\n"
    script += 'download_source "$REF"\n' if mode == "direct" else "cmd_update\n"
    script += "record reached_end\n"
    script_file = case_dir / "isolated.sh"
    script_file.write_text(script)
    result = subprocess.run(
        [bash, "--noprofile", "--norc", str(script_file)],
        env={"PATH": str(bin_dir), "TMPDIR": str(case_dir), "LC_ALL": "C"},
        cwd=case_dir, capture_output=True, text=True, timeout=10,
    )
    event_lines = events.read_text().splitlines()
    source_dir = work / "fixture-source"
    file_sizes = {str(p.relative_to(source_dir)): p.stat().st_size
                  for p in source_dir.rglob("*") if p.is_file()}
    attempted = [x for x in event_lines if x in EFFECTS or x.startswith("unexpected_app:")]
    tar_statuses = [int(x.split(":", 1)[1]) for x in event_lines if x.startswith("tar_status:")]
    valid = case == "normal"
    complete_fixture = file_sizes == {"manifest.json": 29, "index.js": 28,
                                      "asset.bin": 131072, "tail.js": 38}
    normal_effects = not attempted if mode == "direct" else (
        "sync_app_dir" in attempted and "apply_spicetify" in attempted)
    safety_passed = ((result.returncode == 0 and complete_fixture and normal_effects) if valid else
                     (result.returncode != 0 and not attempted))
    return {
        "case": case, "mode": mode, "status": result.returncode,
        "tar_statuses": tar_statuses, "update_attempts": attempted,
        "files_extracted": file_sizes, "stdout": result.stdout,
        "stderr": result.stderr, "events": event_lines,
        "safety_passed": safety_passed,
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-root", default=os.environ.get("IVLYRICS_SOURCE_ROOT", DEFAULT_ROOT))
    parser.add_argument("--report", type=Path)
    parser.add_argument("--keep-fixtures", action="store_true")
    args = parser.parse_args()
    installer = Path(args.source_root).resolve() / "scripts" / "ivlyrics"
    source = installer.read_text()
    functions = "\n\n".join(extract_function(source, name)
                              for name in ("download_source", "cmd_update"))
    bash, real_tar = shutil.which("bash"), shutil.which("tar")
    if not bash or not real_tar:
        raise RuntimeError("bash and tar are required")
    base = Path(tempfile.mkdtemp(prefix="ivlyrics-archive-fixtures-"))
    try:
        bin_dir = base / "bin"
        bin_dir.mkdir()
        # tar invokes gzip internally. All other external commands are fixture IO.
        for name in ("cp", "mkdir", "find", "head", "gzip"):
            path = shutil.which(name)
            if path is None:
                raise RuntimeError(f"{name} is required")
            (bin_dir / name).symlink_to(path)
        archives = {}
        full = archive_bytes()
        for name, data in (("normal", full), ("truncated", full[:len(full) // 2]),
                           ("missing_index", archive_bytes(missing_index=True))):
            archives[name] = base / (name + ".tar.gz")
            archives[name].write_bytes(data)
        results = []
        for case in ("normal", "truncated", "missing_index", "inert_empty_failure", "inert_partial_failure"):
            archive = archives.get(case, archives["normal"])
            for mode in ("direct", "update"):
                results.append(run_case(base, bin_dir, functions, case, mode, archive, bash, real_tar))
        report = {
            "source": str(installer),
            "source_sha256": hashlib.sha256(source.encode()).hexdigest(),
            "bash": subprocess.check_output([bash, "--version"], text=True).splitlines()[0],
            "tar": subprocess.check_output([real_tar, "--version"], text=True).splitlines()[0],
            "archive_bytes": {k: p.stat().st_size for k, p in archives.items()},
            "fixtures": str(base) if args.keep_fixtures else "removed after run",
            "results": results,
            "safe": all(result["safety_passed"] for result in results),
        }
        text = json.dumps(report, indent=2) + "\n"
        if args.report:
            args.report.write_text(text)
        print(text, end="")
        return 0 if report["safe"] else 1
    finally:
        if not args.keep_fixtures:
            shutil.rmtree(base)


if __name__ == "__main__":
    raise SystemExit(main())
