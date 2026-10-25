import json
import subprocess
import tarfile
import tempfile
import unittest
from pathlib import Path
from pack_build import pack


class PackTests(unittest.TestCase):
    def test_snapshot_is_streamed_and_only_public_request_metadata_is_added(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            repo = root / 'repo'
            repo.mkdir()
            def git(*args):
                return subprocess.check_output(['git', '-c', 'user.name=QA', '-c', 'user.email=qa@example.invalid',
                    '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', *args], cwd=repo).decode().strip()
            git('init', '-q')
            (repo / 'source.txt').write_text('committed source')
            git('add', 'source.txt')
            git('commit', '-qm', 'fixture')
            sha = git('rev-parse', 'HEAD')
            (repo / 'source.txt').write_text('uncommitted source')
            metadata = root / 'metadata'
            metadata.mkdir()
            (metadata / 'request.json').write_text(json.dumps({'sourceSha': sha}))
            (metadata / 'recipient-public.pem').write_text('public recipient only')
            (metadata / 'distribution.key').write_text('must never enter input')
            output = root / 'input.tar.gz'
            pack(repo, sha, output, metadata)
            self.assertEqual(output.stat().st_mode & 0o777, 0o600)
            with tarfile.open(output) as archive:
                self.assertEqual(set(archive.getnames()), {'source', 'source/source.txt', 'request.json', 'recipient-public.pem'})
                self.assertEqual(archive.extractfile('source/source.txt').read(), b'committed source')
                self.assertEqual(json.load(archive.extractfile('request.json'))['sourceSha'], sha)
            self.assertFalse((root / 'input.tar').exists())

    def test_bad_sha_fails_before_writing(self):
        with tempfile.TemporaryDirectory() as temporary:
            output = Path(temporary) / 'input.tar.gz'
            with self.assertRaises(ValueError):
                pack(temporary, '../bad', output, temporary)
            self.assertFalse(output.exists())


if __name__ == '__main__':
    unittest.main()
