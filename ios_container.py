"""Resolve one app sandbox inside an explicitly selected disposable simulator."""
import argparse
import plistlib
import uuid
from pathlib import Path


def resolve_container(devices_root, device, bundle):
    uuid.UUID(device)
    root = Path(devices_root).resolve() / device / 'data/Containers/Data/Application'
    matches = []
    for metadata in root.glob('*/.com.apple.mobile_container_manager.metadata.plist'):
        candidate = metadata.parent.resolve()
        if not candidate.is_relative_to(root.resolve()):
            continue
        try:
            with metadata.open('rb') as stream:
                value = plistlib.load(stream)
        except (OSError, plistlib.InvalidFileException):
            continue
        if value.get('MCMMetadataIdentifier') == bundle:
            matches.append(candidate)
    if len(matches) != 1:
        raise ValueError('app_container_missing_or_ambiguous')
    return matches[0]


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('device')
    parser.add_argument('bundle')
    parser.add_argument('--devices-root', type=Path, default=Path.home() / 'Library/Developer/CoreSimulator/Devices')
    args = parser.parse_args()
    print(resolve_container(args.devices_root, args.device, args.bundle))
