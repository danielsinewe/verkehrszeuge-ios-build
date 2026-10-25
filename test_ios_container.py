import plistlib
import tempfile
import unittest
import uuid
from pathlib import Path
from ios_container import resolve_container


class ContainerTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.device = str(uuid.uuid4())
        self.apps = self.root / self.device / 'data/Containers/Data/Application'
        self.apps.mkdir(parents=True)

    def container(self, bundle):
        target = self.apps / str(uuid.uuid4())
        target.mkdir()
        with (target / '.com.apple.mobile_container_manager.metadata.plist').open('wb') as f:
            plistlib.dump({'MCMMetadataIdentifier': bundle}, f)
        return target

    def test_selects_exact_bundle(self):
        self.container('other.app')
        expected = self.container('app.example')
        self.assertEqual(resolve_container(self.root, self.device, 'app.example'), expected)

    def test_rejects_missing(self):
        with self.assertRaises(ValueError):
            resolve_container(self.root, self.device, 'missing.app')

    def test_rejects_ambiguous(self):
        self.container('app.example')
        self.container('app.example')
        with self.assertRaises(ValueError):
            resolve_container(self.root, self.device, 'app.example')

    def test_does_not_follow_outside_sandbox(self):
        outside = self.root / 'outside'
        outside.mkdir()
        with (outside / '.com.apple.mobile_container_manager.metadata.plist').open('wb') as f:
            plistlib.dump({'MCMMetadataIdentifier': 'app.example'}, f)
        (self.apps / 'link').symlink_to(outside, target_is_directory=True)
        with self.assertRaises(ValueError):
            resolve_container(self.root, self.device, 'app.example')

    def test_rejects_device_path_injection(self):
        with self.assertRaises(ValueError):
            resolve_container(self.root, '../device', 'app.example')


if __name__ == '__main__':
    unittest.main()
