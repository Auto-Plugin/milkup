import json
import os
from pathlib import Path
import select
import struct
import subprocess
import sys
import tempfile
import unittest
import calibrate as c


class Contracts(unittest.TestCase):
    def test_frames_are_bounded_and_partial_retained(self):
        raw=b'{"type":"rendering"}'
        wire=struct.pack('<I',len(raw))+raw
        self.assertEqual(c.decode_frames(wire[:7]),([],wire[:7]))
        self.assertEqual(c.decode_frames(wire),([{'type':'rendering'}],b''))
        with self.assertRaises(AssertionError):c.decode_frames(struct.pack('<I',20000))
        raw=b'{"type":"printed"}'
        with self.assertRaises(AssertionError):c.decode_frames(struct.pack('<I',len(raw))+raw)

    def test_exact_reference_rejects_missing_or_wrong_page_coordinates(self):
        p=[{'words':[{'text':'TAA','box':[30,40,50,60]}]}]
        self.assertEqual(c.compare_reference(p,p),[])
        self.assertTrue(c.compare_reference([],p))
        self.assertTrue(c.compare_reference([{'words':[]}],p))
        self.assertTrue(c.compare_reference([{'words':[{'text':'TAA','box':[30,42,50,62]}]}],p))

    def test_chain_keeps_native_table_and_text_identical(self):
        from lxml import html
        for name in ['baseline','short-edge','long-room','short-room']:
            before=(c.HERE/'fixtures'/f'{name}.html').read_text();after=c.chain(before)
            self.assertEqual(before.split('<table>')[1].split('</table>')[0],after.split('<table>')[1].split('</table>')[0])
            a,b=html.fromstring(before),html.fromstring(after)
            self.assertEqual(a.xpath('//body')[0].text_content(),b.xpath('//body')[0].text_content())
            self.assertFalse(b.xpath('//*[@role or @aria-hidden]'))
            self.assertEqual(len(b.xpath('//caption')),0)

    def test_provenance_hashes(self):
        p=json.loads((c.HERE/'fixture-provenance.json').read_text())
        for name,digest in p['fixtures'].items():self.assertEqual(c.sha((c.HERE/'fixtures'/name).read_bytes()),digest)

    def test_fd_transfer_and_stop_eof(self):
        with tempfile.TemporaryDirectory(prefix='mkcal-contract-') as tmp:
            helper=Path(tmp)/'fake'
            helper.write_text('#!'+sys.executable+'\nimport os,select,struct,json\nn=struct.unpack("<I",os.read(0,4))[0]\na=json.loads(os.read(0,n))\nassert a=={"test":True}\nb=b\'{"type":"pdf"}\'\nos.write(3,struct.pack("<I",len(b))+b)\nassert select.select([4],[],[],3)[0]\nassert os.read(4,1)==b""\n')
            helper.chmod(0o700)
            rr,rw=os.pipe2(os.O_CLOEXEC);sr,sw=os.pipe2(os.O_CLOEXEC|os.O_NONBLOCK)
            p=subprocess.Popen([sys.executable,str(c.HERE/'launch_helper.py'),str(helper),str(rw),str(sr),str(os.getpid())],pass_fds=(rw,sr),stdin=subprocess.PIPE)
            os.close(rw);os.close(sr)
            try:
                data=b'{"test":true}';p.stdin.write(struct.pack('<I',len(data))+data);p.stdin.flush()
                self.assertTrue(select.select([rr],[],[],3)[0])
                self.assertEqual(c.decode_frames(os.read(rr,100)),([{'type':'pdf'}],b''))
                os.close(sw);sw=-1;p.stdin.close();self.assertEqual(p.wait(timeout=3),0)
            finally:
                os.close(rr)
                if sw>=0:os.close(sw)
                if p.poll() is None:p.wait(timeout=4)


if __name__=='__main__':unittest.main()
