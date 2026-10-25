"""Stream an exact Git snapshot and public request metadata into a private gzip archive."""
import os
import re
import subprocess
import sys
import tarfile
from pathlib import Path


def pack(repo, sha, output, metadata):
    if not re.fullmatch('[a-f0-9]{40}', sha):
        raise ValueError('invalid_source_sha')
    output = Path(output)
    descriptor = os.open(output, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    process = subprocess.Popen(['git', 'archive', '--format=tar', '--prefix=source/', sha],
                               cwd=repo, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
    try:
        with os.fdopen(descriptor, 'wb') as stream, tarfile.open(fileobj=stream, mode='w|gz') as target:
            with tarfile.open(fileobj=process.stdout, mode='r|') as source:
                for member in source:
                    target.addfile(member, source.extractfile(member) if member.isfile() else None)
            if process.wait() != 0:
                raise RuntimeError('source_archive_failed')
            for name in ['request.json', 'recipient-public.pem']:
                target.add(Path(metadata) / name, arcname=name, recursive=False)
    except BaseException:
        if process.poll() is None:
            process.kill()
        process.wait()
        output.unlink(missing_ok=True)
        raise
    finally:
        process.stdout.close()


if __name__ == '__main__':
    pack(*sys.argv[1:])
