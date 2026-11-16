"""Official isolated-runner SDK prerequisites, no engine build/system WebKit change.

Both apt plans are validated before either install. Uses the same official
dependency recipe as the completed build, in a private apt metadata directory.
"""
import json
import os
from pathlib import Path
import re
import subprocess
import sys

import current_tu_gate as current


def main(root):
    assert os.getuid()!=0 and os.environ.get('GITHUB_ACTIONS')=='true'
    release=Path('/etc/os-release').read_text()
    assert 'VERSION_ID="26.04"' in release and re.search(r'^ID=ubuntu$',release,re.M)
    root.mkdir(exist_ok=False)
    def run(name,args,seconds):
        (root/(name+'-command.json')).write_text(json.dumps(args)+'\n')
        with (root/(name+'.log')).open('w') as out:
            subprocess.run(args,stdout=out,stderr=subprocess.STDOUT,timeout=seconds,check=True)
        return (root/(name+'.log')).read_text()
    text=current.official_sources(Path('/etc/apt/sources.list.d/ubuntu.sources').read_text(),lambda p:Path(p).read_text())
    (root/'official.sources').write_text(text)
    for p in ['lists/partial','cache/archives/partial']:(root/p).mkdir(parents=True)
    conf=root/'apt.conf';conf.write_text(f'Dir::Etc::sourcelist "{root}/official.sources";\nDir::Etc::sourceparts "-";\nDir::State::lists "{root}/lists";\nDir::Cache "{root}/cache";\nAcquire::Languages "none";\n')
    run('update',['apt-get','-c',str(conf),'update'],150)
    metadata=run('metadata',['apt-cache','-c',str(conf),'showsrc','webkit2gtk'],30)
    versions=sorted(set(re.findall(r'^Version: ([0-9A-Za-z.+:~\-]+)$',metadata,re.M)));assert versions
    version=versions[0]
    for v in versions[1:]:
        if subprocess.run(['dpkg','--compare-versions',v,'gt',version]).returncode==0:version=v
    plans=[['build-dep','webkit2gtk='+version],['install',*current.EXTRA_SDK_PACKAGES]]
    for i,plan in enumerate(plans):
        current.validate_apt_plan(run('plan-'+str(i),['apt-get','-c',str(conf),'--simulate','--no-install-recommends','--no-remove',*plan],60))
    for i,plan in enumerate(plans):
        run('install-'+str(i),['sudo','apt-get','-c',str(conf),'-y','--no-install-recommends','--no-remove',*plan],300)
    run('packages',['dpkg-query','-W','-f=${binary:Package}\t${Version}\t${Architecture}\n'],30)
    (root/'scope.json').write_text(json.dumps({'dependencySourceVersion':version,'engineBuilt':False,'runtimeInstalled':False,'source':'Official signed Ubuntu archive; no system WebKit changes permitted by plan'})+'\n')


if __name__=='__main__':main(Path(sys.argv[1]))
