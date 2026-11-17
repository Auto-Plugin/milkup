"""Read-only separate consumer; no configure, build, package or upload operation."""
import json,os,pathlib,sys
import hosted_admission as a
import durable_probe as d
P=pathlib.Path
def verify(path,expected):
 a.pins();d.require(d.sha(path)==expected,'Exact producer manifest')
 m=json.loads(path.read_text());d.require(m['schema']==1 and m['harnessSha']==os.environ['GITHUB_SHA']and m['fullBuildAdmitted']is False,'New-run identity')
 source=P(m['sourceRoot']);build=P(m['buildRoot']);root=path.parent.resolve()
 d.require(source.is_relative_to(root)and build.is_relative_to(root)and P(m['archive']).is_relative_to(root),'Same private run roots')
 d.require(d.sha(P(m['archive']))==a.SOURCE and m['archiveSha256']==a.SOURCE and m['patchSha256']==d.PINS['normal-path-2.54.2.patch'],'Source/archive pins')
 # Re-read the actual regular tree. Producer derived expectations directly from pinned archive.
 d.require(m['aliases']=={a.ALIAS:a.LINK},'Exact archive alias');a.verify_source(source,m['sourceFiles'],m['aliases'])
 for n,h in m['metadata'].items():d.require(n in a.META and d.sha(build/n)==h,'Same immutable configured graph')
 d.require(set(m['metadata'])==set(a.META),'Complete configuration metadata set')
 for row in m['tools'].values():d.require(d.sha(P(row['resolved']))==row['sha256'],'Same actual tool bytes')
 for n,h in m['generatedFiles'].items():
  a.relative(n);p=build/n;d.require(not p.is_symlink()and d.sha(p)==h,'Actual generated input bytes')
 d.require(len(json.loads((build/'compile_commands.json').read_text()))==m['compilerTargets']==2833,'Actual target count')
 sys.path.insert(0,str(d.RESEARCH));import package_boundary as b
 profile=d.product_check();cache=b.cache_values(build/'CMakeCache.txt')
 d.require(all(cache.get(k)==v for k,v in m['configureOptions'].items())and all(m['configureOptions'].get(k)==v for k,v in profile['cmake'].items()),'Same product options')
 d.require(m['configuration']['api']=='4.1'and m['configuration']['configSha256']==d.sha(build/'cmakeconfig.h'),'Actual GTK3 API4.1 configuration')
 return True
if __name__=='__main__':verify(P(sys.argv[1]),sys.argv[2])
