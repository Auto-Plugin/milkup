"""Tiny synthetic GNU map-option check; never builds/runs Milkup or WebKit."""
import argparse
import json
from pathlib import Path
import subprocess
import build_provenance_plan as p


def run(out):
    p.r.require(not out.exists(),'Fresh synthetic evidence');out.mkdir()
    cmds=[]
    def command(args):
        z=subprocess.run(args,cwd=out,capture_output=True,text=True,timeout=20)
        p.r.require(len(z.stdout)+len(z.stderr)<1024**2,'Bounded tiny probe output')
        cmds.append({'argv':args,'exitCode':z.returncode,'stdout':z.stdout,'stderr':z.stderr})
        p.r.require(z.returncode==0,'Synthetic tool command failed');return z.stdout
    version=command(['/usr/bin/ld','--version']);p.r.require(version.startswith('GNU ld '),'GNU-only tested option recipe')
    sources={'main.c':'int used(void); int main(void) { return used(); }\n',
             'selected.c':'int used(void) { return 0; } int discarded_in_selected(void) { return 7; }\n',
             'not_selected.c':'int never_referenced(void) { return 9; }\n'}
    for name,text in sources.items():
        (out/name).write_text(text)
        command(['/usr/bin/cc','-g','-ffunction-sections','-fdata-sections','-c',name,'-o',name+'.o'])
    command(['/usr/bin/ar','rcs','libprobe.a','selected.c.o','not_selected.c.o'])
    base=['/usr/bin/cc','main.c.o','libprobe.a','-Wl,--gc-sections','-o','candidate']
    command(base);before=p.r.digest(out/'candidate')
    command(base+['-Wl,-Map,candidate.map,--cref']);after=p.r.digest(out/'candidate')
    text=(out/'candidate.map').read_text();p.r.require(len(text)<1024**2,'Bounded synthetic map')
    p.r.require(before==after,'Map/cref must preserve exact fixture output bytes')
    included=text.split('Discarded input sections',1)[0]
    p.r.require('Archive member included' in included and 'libprobe.a(selected.c.o)' in included
                and 'libprobe.a(not_selected.c.o)' not in included,'Map identifies selected archive member')
    discarded=text.split('Discarded input sections',1)[1].split('Memory Configuration',1)[0]
    p.r.require('.text.discarded_in_selected' in discarded,'Selected archive member can still contain discarded code')
    result={'status':'synthetic-gnu-map-check-passed-not-original-linker-or-runtime',
            'compilerSha256':p.r.digest(Path('/usr/bin/cc')),'linkerSha256':p.r.digest(Path('/usr/bin/ld')),
            'linkerVersion':version,'commands':cmds,'beforeSha256':before,'afterSha256':after,
            'mapSha256':p.r.digest(out/'candidate.map'),'runtimeExecuted':False,
            'originalTargetToolchainTested':False,'completeSbom':False}
    (out/'receipt.json').write_text(json.dumps(result,indent=2)+'\n');return result


if __name__=='__main__':
    a=argparse.ArgumentParser();a.add_argument('output',type=Path);args=a.parse_args()
    print(run(args.output)['status'])
