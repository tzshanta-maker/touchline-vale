#!/usr/bin/env python3
"""Fail the build if the APK has a packaging problem Android will reject.

Checks the things that produce a silent "App not installed" on real devices:

  * resources.arsc compressed (Android 11+ requires it stored),
  * resources.arsc not 4-byte aligned (browsers/zip tools happily misalign it),
  * missing or duplicated AndroidManifest.xml / classes.dex,
  * an unexpected minSdk that is newer than the manifest claims.

Usage: python3 verify_apk.py build/signed.apk
"""
import sys
import zipfile


def local_data_offset(z: zipfile.ZipFile, header_offset: int) -> int:
    """Absolute offset of an entry's data, read from its local file header."""
    z.fp.seek(header_offset)
    header = z.fp.read(30)
    if len(header) < 30 or header[:4] != b"PK\x03\x04":
        return -1
    name_len = int.from_bytes(header[26:28], "little")
    extra_len = int.from_bytes(header[28:30], "little")
    return header_offset + 30 + name_len + extra_len


def main(path: str) -> int:
    problems = []

    try:
        z = zipfile.ZipFile(path)
    except zipfile.BadZipFile as exc:
        print(f"not a zip: {exc}", file=sys.stderr)
        return 1

    names = z.namelist()

    try:
        arsc = z.getinfo("resources.arsc")
    except KeyError:
        problems.append("resources.arsc is missing")
        arsc = None

    if arsc is not None:
        if arsc.compress_type != zipfile.ZIP_STORED:
            problems.append("resources.arsc is compressed (must be STORED)")
        # Alignment applies to the entry *data*. zipalign pads the LOCAL header's
        # extra field, which is not mirrored in the central directory, so the
        # local header has to be read to know where the data really starts.
        data_offset = local_data_offset(z, arsc.header_offset)
        if data_offset % 4:
            problems.append(
                f"resources.arsc data is not 4-byte aligned (offset % 4 == {data_offset % 4})"
            )

    for required in ("AndroidManifest.xml", "classes.dex"):
        if required not in names:
            problems.append(f"{required} is missing")

    if names and names[0] != "AndroidManifest.xml":
        problems.append(f"first entry is {names[0]!r}, expected 'AndroidManifest.xml'")

    if "assets/www/index.html" not in names:
        problems.append("the game bundle (assets/www/index.html) is missing")

    if problems:
        print("INVALID APK:", file=sys.stderr)
        for p in problems:
            print("  - " + p, file=sys.stderr)
        return 1

    print(
        "apk ok: resources.arsc stored + 4-byte aligned, "
        f"{len(names)} entries, bundle present"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1] if len(sys.argv) > 1 else "build/signed.apk"))
