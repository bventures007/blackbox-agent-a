"""Host secret-loss/security tests use disposable installations, never live keys."""
import concurrent.futures
import os
from pathlib import Path
import sys
import tempfile
import unittest
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from host_runtime import compose_config,native_config,protected_read,RuntimeConfigError


class HostRuntimeTest(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.root=Path(self.tmp.name);self.runtime=self.root/'runtime'
    def tearDown(self):self.tmp.cleanup()
    def test_native_existing_missing_key_never_regenerated(self):
        value=native_config(self.runtime,True);original=(self.runtime/'native.json').read_bytes()
        for key in ['data','internal']:
            path=self.runtime/'secrets'/key;good=path.read_bytes();path.unlink()
            with self.assertRaisesRegex(RuntimeConfigError,'Missing|unsafe'):native_config(self.runtime,True)
            self.assertFalse(path.exists());self.assertEqual(original,(self.runtime/'native.json').read_bytes())
            path.write_bytes(good);path.chmod(0o600)
        self.assertEqual(value,native_config(self.runtime))
    def test_native_missing_db_configuration_cannot_replace_existing_database(self):
        native_config(self.runtime,True);(self.runtime/'pg').mkdir();(self.runtime/'native.json').unlink()
        with self.assertRaisesRegex(RuntimeConfigError,'no replacement credentials'):native_config(self.runtime,True)
        self.assertFalse((self.runtime/'native.json').exists())
    def test_native_secret_corruption_permissions_and_symlinks_fail_closed(self):
        native_config(self.runtime,True);path=self.runtime/'secrets/data';good=path.read_bytes()
        path.write_bytes(b'bad')
        with self.assertRaises(RuntimeConfigError):native_config(self.runtime)
        path.write_bytes(good);path.chmod(0o644)
        with self.assertRaises(RuntimeConfigError):native_config(self.runtime)
        path.chmod(0o600);path.rename(self.root/'saved');path.symlink_to(self.root/'saved')
        with self.assertRaises(RuntimeConfigError):native_config(self.runtime)
        self.assertEqual(good,(self.root/'saved').read_bytes())
    def test_new_compose_unique_and_normal_start_never_initializes(self):
        with self.assertRaises(RuntimeConfigError):compose_config(self.runtime)
        self.assertFalse((self.runtime/'compose.env').exists())
        a=compose_config(self.runtime,True,18751);b=compose_config(self.root/'second',True,18752)
        self.assertNotEqual(a['BB_PROJECT'],b['BB_PROJECT']);self.assertNotEqual(a['BB_DB_PASSWORD'],b['BB_DB_PASSWORD'])
        self.assertEqual(a,compose_config(self.runtime));self.assertEqual(a,compose_config(self.runtime,True,18751))
        with self.assertRaisesRegex(RuntimeConfigError,'different port'):compose_config(self.runtime,True,18752)
        self.assertEqual('18751',compose_config(self.runtime)['BB_PORT'])
    def test_compose_missing_configuration_or_keys_never_replaced(self):
        compose_config(self.runtime,True);key=(self.runtime/'secrets/data').read_bytes();env=(self.runtime/'compose.env').read_bytes()
        (self.runtime/'compose.env').unlink()
        with self.assertRaisesRegex(RuntimeConfigError,'no replacement'):compose_config(self.runtime,True)
        self.assertFalse((self.runtime/'compose.env').exists());self.assertEqual(key,(self.runtime/'secrets/data').read_bytes())
        (self.runtime/'compose.env').write_bytes(env);(self.runtime/'compose.env').chmod(0o600);(self.runtime/'secrets/data').unlink()
        with self.assertRaises(RuntimeConfigError):compose_config(self.runtime,True)
        self.assertFalse((self.runtime/'secrets/data').exists())
        self.assertTrue(compose_config(self.runtime,require_keys=False)) # stop/status still available
    def test_concurrent_initialization_and_dotenv_injection(self):
        with concurrent.futures.ThreadPoolExecutor(max_workers=8) as executor:
            results=list(executor.map(lambda _:compose_config(self.runtime,True),range(8)))
        self.assertTrue(all(x==results[0] for x in results))
        path=self.runtime/'compose.env';original=path.read_bytes()
        for extra in [b'BB_PORT=1\n',b'BB_DB_PASSWORD=oops\n',b'COMPOSE_FILE=other\n',b'BB_PROJECT=unrelated\n']:
            path.write_bytes(original+extra)
            with self.assertRaises(RuntimeConfigError):compose_config(self.runtime)
        path.write_bytes(original)
    def test_legacy_project_and_both_native_compose_preserve_same_keys(self):
        a=compose_config(self.runtime,True);p=self.runtime/'compose.env';p.write_text('\n'.join(line for line in p.read_text().splitlines() if not line.startswith(('BB_PROJECT=','BB_PORT=')))+'\n')
        if os.getuid()==501 and os.getgid()==20:
            p.write_text('\n'.join(line for line in p.read_text().splitlines() if not line.startswith(('BB_UID=','BB_GID=')))+'\n')
        key=(self.runtime/'secrets/data').read_bytes();self.assertNotIn('BB_PROJECT',compose_config(self.runtime))
        native_config(self.runtime,True);self.assertEqual(key,(self.runtime/'secrets/data').read_bytes())
    def test_existing_directory_and_hardlink_rejected_without_modification(self):
        self.runtime.mkdir(mode=0o755)
        with self.assertRaises(RuntimeConfigError):compose_config(self.runtime,True)
        self.runtime.chmod(0o700);compose_config(self.runtime,True)
        path=self.runtime/'secrets/data';os.link(path,self.root/'linked')
        with self.assertRaises(RuntimeConfigError):protected_read(path)
        self.assertEqual(path.read_bytes(),(self.root/'linked').read_bytes())


if __name__=='__main__':unittest.main()
