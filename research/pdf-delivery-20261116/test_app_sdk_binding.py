"""Real pkg-config/ELF mechanics with synthetic libraries, never app acceptance."""
import copy
import importlib.util
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest
from unittest.mock import patch

import app_sdk_binding as b
import package_boundary


class Binding(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory(prefix='sdk-binding-fixture-');self.addCleanup(self.tmp.cleanup)
        self.root=Path(self.tmp.name);self.build=self.root/'sdk';self.build.mkdir()
        self.recipe=json.loads((Path(__file__).parent/'qa-final-path-profile.json').read_text())
        self.pc=self.root/'derived';self.pc.mkdir();self.host=self.root/'synthetic-host';self.host.mkdir()
        for name in ['glib-2.0','gobject-2.0','gtk+-3.0','libsoup-3.0']:
            (self.host/(name+'.pc')).write_text(f'Name: {name}\nDescription: synthetic only\nVersion: 99.0\nLibs:\nCflags:\n')
        for name in b.MODULES:
            self.write_pc(name)
        self.binding={'buildPrefix':str(self.build),'finalPrefix':self.recipe['prefix'],'environment':{'PKG_CONFIG_PATH':str(self.pc)},'pkgConfig':[{'module':name,'derivedSha256':b.digest(self.pc/(name+'.pc'))} for name in b.MODULES]}
        self.env={k:v for k,v in os.environ.items() if not k.startswith('PKG_CONFIG')};self.env['PKG_CONFIG_LIBDIR']=str(self.host)

    def original(self,name):
        lib='javascriptcoregtk-4.1' if name.startswith('javascriptcore') else 'webkit2gtk-4.1'
        required='glib-2.0 gobject-2.0' if name.startswith('javascriptcore') else 'glib-2.0 gtk+-3.0 libsoup-3.0 javascriptcoregtk-4.1'
        return f'prefix={self.recipe["prefix"]}\nlibdir={self.recipe["lib"]}\nincludedir=${{prefix}}/include\nName: {name}\nDescription: synthetic only\nVersion: 2.54.2\nRequires: {required}\nLibs: -L${{libdir}} -l{lib}\nCflags: -I${{includedir}}/webkitgtk-4.1\n'.encode()

    def write_pc(self,name):
        (self.pc/(name+'.pc')).write_bytes(b.derive_pc(self.original(name),self.recipe,self.build))

    def test_dirty_or_wrong_product_stops_before_any_output(self):
        with patch.object(b.subprocess,'check_output',return_value='f'*40+'\n'):
            with self.assertRaisesRegex(ValueError,'source SHA'):b.source_identity(self.root,b.install_gate.APPLICATION_SHA)
        with patch.object(b.subprocess,'check_output',side_effect=[b.install_gate.APPLICATION_SHA+'\n','?? injected.ts\n']):
            with self.assertRaisesRegex(ValueError,'Clean product'):b.source_identity(self.root,b.install_gate.APPLICATION_SHA)

    def test_real_pkgconfig_resolves_all_three_modules_and_guard_flags(self):
        r=b.verify_pkgconfig(self.binding,self.env)
        self.assertEqual(len(r['modules']),3)
        for row in r['modules']:
            self.assertIn('-Wl,-rpath,'+self.recipe['lib'],row['flags'])
            self.assertNotIn('-I/usr/include/webkitgtk-4.1',row['flags'])

    def test_wrong_sdk_prefix_version_existing_rpath_and_alias_rejected(self):
        original=self.original('webkit2gtk-4.1')
        for bad in [original.replace(b'Version: 2.54.2',b'Version: 2.52.6'),original.replace(self.recipe['prefix'].encode(),b'/usr'),original+b'Extra: rpath\n']:
            with self.assertRaises(ValueError):b.derive_pc(bad,self.recipe,self.build)
        alias=self.root/'alias';alias.symlink_to(self.build,target_is_directory=True)
        with self.assertRaisesRegex(ValueError,'aliases'):b.derive_pc(original,self.recipe,alias)

    def test_missing_rpath_system_fallback_and_global_sysroot_rejected(self):
        p=self.pc/'webkit2gtk-web-extension-4.1.pc'
        p.write_bytes(p.read_bytes().replace((' -Wl,-rpath,'+self.recipe['lib']).encode(),b''))
        # Its JSC dependency also contributes an RPATH; removing both detects loss.
        q=self.pc/'javascriptcoregtk-4.1.pc';q.write_bytes(q.read_bytes().replace((' -Wl,-rpath,'+self.recipe['lib']).encode(),b''))
        with self.assertRaisesRegex(ValueError,'Derived SDK identity'):b.verify_pkgconfig(self.binding,self.env)
        self.write_pc('webkit2gtk-web-extension-4.1');self.write_pc('javascriptcoregtk-4.1')
        env={**self.env,'PKG_CONFIG_SYSROOT_DIR':'/unrelated'}
        with self.assertRaisesRegex(ValueError,'sysroot'):b.verify_pkgconfig(self.binding,env)
        shutil.move(str(p),self.host/p.name)
        with self.assertRaisesRegex(ValueError,'Derived SDK identity'):b.verify_pkgconfig(self.binding,self.env)

    def test_real_synthetic_guard_link_has_final_rpath_and_private_needed(self):
        if not shutil.which('cc'):self.skipTest('Real C compiler unavailable')
        lib=self.build/'lib/x86_64-linux-gnu';lib.mkdir(parents=True)
        for name,symbol in [('javascriptcoregtk-4.1','jsc'),('webkit2gtk-4.1','web')]:
            src=self.root/(symbol+'.c');src.write_text(f'int fixture_{symbol}(void){{return 1;}}')
            subprocess.run(['cc','-shared','-fPIC',str(src),'-Wl,--build-id','-Wl,-soname,lib'+name+'.so.0','-o',str(lib/('lib'+name+'.so'))],check=True,capture_output=True)
        flags=b.verify_pkgconfig(self.binding,self.env)['modules'][-1]['flags']
        src=self.root/'guard.c';src.write_text('extern int fixture_web(void); int fixture_guard(void){return fixture_web();}')
        out=self.root/'guard.so'
        subprocess.run(['cc','-shared','-fPIC','-O2','-Wl,-z,relro,-z,now','-Wl,--build-id',str(src),'-o',str(out),*flags],check=True,capture_output=True)
        elf=package_boundary.elf(out)
        self.assertEqual(elf['searchPath'],self.recipe['lib'])
        self.assertIn('libwebkit2gtk-4.1.so.0',elf['needed'])
        # Deliberately never execute this synthetic library.


if __name__=='__main__':unittest.main()
