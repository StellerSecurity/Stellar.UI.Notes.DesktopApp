import hashlib
import importlib.util
import io
from pathlib import Path
import struct
import tarfile
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('linux_build_inputs', Path(__file__).with_name('linux-build-inputs.py'))
inputs = importlib.util.module_from_spec(spec)
spec.loader.exec_module(inputs)


class InputTests(unittest.TestCase):
    def fixture(self, root, duplicate=False, symlink=False, corrupt=False):
        data = bytearray(64)
        data[:6] = b'\x7fELF\x02\x01'
        struct.pack_into('<H', data, 18, 62)
        item = {'destination': 'mksquashfs', 'size': len(data), 'sha256': hashlib.sha256(data).hexdigest()}
        archive = root / 'input.tar.gz'
        with tarfile.open(archive, 'w:gz') as output:
            for _ in range(2 if duplicate else 1):
                member = tarfile.TarInfo('./selected')
                if symlink:
                    member.type, member.linkname = tarfile.SYMTYPE, '/outside'
                    output.addfile(member)
                else:
                    member.size = len(data)
                    output.addfile(member, io.BytesIO(bytes(data[:-1]) + (b'x' if corrupt else bytes(data[-1:]))))
            extra = tarfile.TarInfo('../unselected-shell')
            extra.size = 4
            output.addfile(extra, io.BytesIO(b'exit'))
        return archive, {'./selected': item}

    def test_selects_only_verified_regular_elf(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            archive, files = self.fixture(root)
            tools = root / 'tools'
            tools.mkdir()
            inputs.select_tools(archive, tools, files)
            self.assertTrue((tools / 'mksquashfs').is_file())
            self.assertEqual((tools / 'mksquashfs').stat().st_mode & 0o777, 0o600)
            self.assertEqual(list((tools / 'lib' / 'x64').iterdir()), [])
            self.assertEqual(list((root / 'lib').iterdir()), [])
            self.assertFalse((root / 'unselected-shell').exists())

    def test_rejects_unsafe_selected_members(self):
        for option in ('duplicate', 'symlink', 'corrupt'):
            with self.subTest(option=option), tempfile.TemporaryDirectory() as folder:
                root = Path(folder)
                archive, files = self.fixture(root, **{option: True})
                tools = root / 'tools'
                tools.mkdir()
                with self.assertRaises(ValueError):
                    inputs.select_tools(archive, tools, files)

    def test_rejects_wrong_architecture(self):
        with self.assertRaises(ValueError):
            inputs.verify_elf(b'\x7fELF' + b'\0' * 60)

    def test_rejects_digest_and_length_changes(self):
        item = {'size': 4, 'sha256': hashlib.sha256(b'test').hexdigest()}
        inputs.verify(b'test', item)
        for data in (b'bad!', b'test!'):
            with self.assertRaises(ValueError):
                inputs.verify(data, item)


if __name__ == '__main__':
    unittest.main()
