#!/usr/bin/env python3
"""Package build/stage/unpacked into build/unaligned.apk.

Android 11+ (enforced on 14) is strict about two things that a naive
"zip everything with deflate" produces wrong:

  * ``resources.arsc`` must be STORED (uncompressed) and 4-byte aligned,
  * ``AndroidManifest.xml`` should be the first entry.

Getting either wrong makes the package installer fail with the bare message
"App not installed" and no further explanation, so this script gets it right
and ``verify_apk.py`` re-checks the signed result.
"""
import os
import sys
import zipfile

STAGE = "build/stage/unpacked"
OUT = "build/unaligned.apk"

# entries that must not be deflated
STORE = {"resources.arsc"}


def entry_rank(name: str):
    if name == "AndroidManifest.xml":
        return (0, name)
    if name == "resources.arsc":
        return (1, name)
    if name == "classes.dex":
        return (2, name)
    return (3, name)


def main() -> int:
    if not os.path.isdir(STAGE):
        print(f"missing {STAGE} — run this after unpacking base.apk", file=sys.stderr)
        return 1

    names = []
    for root, _dirs, files in os.walk(STAGE):
        for f in files:
            p = os.path.join(root, f)
            names.append(os.path.relpath(p, STAGE).replace(os.sep, "/"))
    names.sort(key=entry_rank)

    if os.path.exists(OUT):
        os.remove(OUT)

    with zipfile.ZipFile(OUT, "w") as zf:
        for name in names:
            src = os.path.join(STAGE, name)
            method = zipfile.ZIP_STORED if name in STORE else zipfile.ZIP_DEFLATED
            zf.write(src, name, compress_type=method)

    print(f"packaged {len(names)} entries -> {OUT}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
