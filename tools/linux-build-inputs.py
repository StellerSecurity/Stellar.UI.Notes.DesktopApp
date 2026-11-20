#!/usr/bin/env python3
"""Prepare explicitly reviewed Linux inputs without executing vendor code."""
import hashlib
import json
import os
from pathlib import Path
import platform
import struct
import sys
import tarfile
import tempfile
import urllib.parse
import urllib.request
import zipfile

SPEC = json.loads(Path(__file__).with_suffix('.json').read_text())


def verify(data, item):
    if len(data) != item['size'] or hashlib.sha256(data).hexdigest() != item['sha256']:
        raise ValueError('Linux input integrity mismatch')


def verify_elf(data):
    if (len(data) < 64 or data[:6] != b'\x7fELF\x02\x01'
            or struct.unpack_from('<H', data, 18)[0] != 62):
        raise ValueError('Expected Linux x64 ELF')


def download(item, directory):
    target = directory / item['name']
    request = urllib.request.Request(item['url'], headers={'User-Agent': 'Stellar-reviewed-Linux-build'})
    with urllib.request.urlopen(request, timeout=180) as response:
        final = urllib.parse.urlparse(response.url)
        if final.scheme != 'https' or final.hostname not in (
                'github.com', 'release-assets.githubusercontent.com', 'objects.githubusercontent.com'):
            raise ValueError('Unexpected Linux input origin')
        digest, length = hashlib.sha256(), 0
        with target.open('xb') as output:
            os.chmod(target, 0o600)
            while chunk := response.read(1024 * 1024):
                length += len(chunk)
                if length > item['size']:
                    raise ValueError('Oversized Linux input')
                output.write(chunk)
                digest.update(chunk)
        if length != item['size'] or digest.hexdigest() != item['sha256']:
            raise ValueError('Downloaded Linux input integrity mismatch')
    return target


def select_tools(archive_file, directory, files=None):
    files = SPEC['appimage']['files'] if files is None else files
    with tarfile.open(archive_file, 'r:gz') as archive:
        members = archive.getmembers()
        for source, item in files.items():
            matches = [member for member in members if member.name == source]
            if len(matches) != 1 or not matches[0].isreg() or matches[0].size != item['size']:
                raise ValueError('Missing, duplicate or unsafe selected tool')
            data = archive.extractfile(matches[0]).read(item['size'] + 1)
            verify(data, item)
            verify_elf(data)
            destination = Path(item['destination'])
            if destination.is_absolute() or '..' in destination.parts:
                raise ValueError('Unsafe tool destination')
            target = directory / destination
            target.parent.mkdir(parents=True, exist_ok=True)
            with target.open('xb') as output:
                output.write(data)
            os.chmod(target, 0o700 if item.get('execute') else 0o600)
    # Use agent-maintained system libraries. Never load the bundle's old codec
    # libraries, generic shell wrappers, optional icon tools or Mac utilities.
    (directory / 'lib' / 'x64').mkdir(parents=True)
    # mksquashfs RUNPATH is $ORIGIN/../lib; keep that private location empty too.
    (directory.parent / 'lib').mkdir()


def prepare(base):
    if platform.system() != 'Linux' or platform.machine() not in ('x86_64', 'amd64'):
        raise ValueError('Prepare only on Linux x64 CI')
    if not base.is_absolute() or not base.is_dir():
        raise ValueError('Expected existing absolute CI temporary directory')
    directory = Path(tempfile.mkdtemp(prefix='notes-reviewed-linux-', dir=base))
    electron = download(SPEC['electron'], directory)
    with zipfile.ZipFile(electron) as archive:
        if archive.read('version').decode().strip() != '44.9.3':
            raise ValueError('Electron version mismatch')
    appimage = download(SPEC['appimage'], directory)
    tools = directory / 'tools'
    tools.mkdir()
    select_tools(appimage, tools)
    result = {'electronZip': str(electron), 'appimageTools': str(tools)}
    (directory / 'prepared.json').write_text(json.dumps(result, indent=2) + '\n')
    return result


if __name__ == '__main__':
    try:
        print(json.dumps(prepare(Path(sys.argv[1]))))
    except Exception as error:
        print('Linux input preparation rejected: ' + str(error), file=sys.stderr)
        sys.exit(1)
