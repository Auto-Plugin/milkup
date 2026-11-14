from pathlib import Path
import subprocess

root = Path('/workspace/milkup-render-timing-diagnostic')
base = '065882e4ac8c638c2fe8eb6f7050ff9228e95ecc'
assert subprocess.check_output(['git','rev-parse','HEAD'],cwd=root,text=True).strip() == base
assert not subprocess.check_output(['git','status','--porcelain'],cwd=root,text=True).strip(), 'Refuse to overwrite a dirty diagnostic checkout'

def block(lines, indent=''):
    return indent + '// DIAGNOSTIC-BEGIN\n' + '\n'.join(indent + line if line else '' for line in lines.split('\n')) + '\n' + indent + '// DIAGNOSTIC-END\n'

def insert(s, anchor, added, where='before'):
    assert s.count(anchor) == 1, (anchor, s.count(anchor))
    return s.replace(anchor, added + anchor if where == 'before' else anchor + added)

p=root/'packages/plugin/src/worker-supervisor.ts';s=p.read_text()
s=block("import { createRenderTimingDiagnostic, diagnosticResultMatches } from './render-timing-diagnostic'")+s
s=insert(s,'  let closed = false\n  let active:',block("const diagnostic = createRenderTimingDiagnostic('supervisor', value => scope.postMessage(value))",'  '))
s=insert(s,'    // Stop execution before informing a possibly blocked page.',block("diagnostic.mark('supervisor-expire', id, active.deadline)",'    '))
s=insert(s,"    send({ protocol, type: 'control', event: 'timeout', id })\n",block("diagnostic.flush()",'    '),'after')
s=insert(s,'          const job = active\n',block("if (job && diagnosticResultMatches(message, job.id)) {\n  diagnostic.mark('supervisor-result-handler', job.id, job.deadline)\n}",'          '),'after')
s=insert(s,'              expire(job.id)\n',block("diagnostic.mark('supervisor-result-late', job.id, job.deadline)",'              '))
s=insert(s,'            active = undefined\n',block("diagnostic.mark('supervisor-result-accepted', job.id, job.deadline)",'            '),'after')
s=insert(s,'          sendChild(message)\n',block("diagnostic.flush()",'          '),'after')
s=insert(s,"          timer: setTimeout(() => expire(id), DOCUMENT_PRESENTATION_LIMITS.timeoutMs),\n        }\n",block("diagnostic.mark('supervisor-dispatch', id, active.deadline)",'        '),'after')
s=insert(s,'      child.postMessage(message)\n',block("diagnostic.flush()",'      '),'after')
p.write_text(s)

p=root/'packages/plugin/src/document-render-rpc.ts';s=p.read_text()
s=block("import { bindRenderTimingRequest, createRenderTimingDiagnostic } from './render-timing-diagnostic'")+s
s=insert(s,'  const pending = new Map<string, AbortController>()\n',block("const diagnostic = createRenderTimingDiagnostic('child', value => endpoint.postMessage(value))",'  '),'after')
s=insert(s,'    if (disposed) return\n    endpoint.postMessage({\n',block("diagnostic.mark('child-result-post-enter', id)",'    '))
# The guard remains first in production order. The diagnostic hook must not record a post for disposed servers.
s=s.replace(block("diagnostic.mark('child-result-post-enter', id)",'    ')+'    if (disposed) return\n', '    if (disposed) return\n'+block("diagnostic.mark('child-result-post-enter', id)",'    '))
s=insert(s,"      ...(ok ? { value } : { error: failure(error).code }),\n    })\n",block("diagnostic.mark('child-result-post-return', id)\ndiagnostic.flush()",'    '),'after')
s=insert(s,"    if (message.type !== 'render' || pending.has(jobId)) return\n",block("diagnostic.mark('child-receive', jobId)\ndiagnostic.flush()",'    '),'after')
s=insert(s,'      if (pending.size) throw new DocumentPresentationError(\'busy\')\n',block("bindRenderTimingRequest(request, jobId, diagnostic)",'      '))
p.write_text(s)

p=root/'packages/plugin/src/isolation-module-host.ts';s=p.read_text()
s=block("import { traceRenderTimingRequest } from './render-timing-diagnostic'")+s
s=insert(s,'      renderControllers.add(controller)\n',block("let diagnosticProviderEntered = false\nlet diagnosticProviderSettled = false",'      '),'after')
s=insert(s,'        const value = await renderer(request, {\n',block("diagnosticProviderEntered = true\ntraceRenderTimingRequest(input, 'provider-enter', true)",'        '))
s=insert(s,'          signal: controller.signal,\n        })\n',block("diagnosticProviderSettled = true\ntraceRenderTimingRequest(input, 'provider-fulfilled')",'        '),'after')
s=insert(s,'        return copyDocumentPresentationResult(value, request, declaration)\n',block("traceRenderTimingRequest(input, 'output-validation-enter')",'        '))
s=insert(s,'      } finally {\n        renderControllers.delete(controller)\n',block("if (diagnosticProviderEntered && !diagnosticProviderSettled) {\n  traceRenderTimingRequest(input, 'provider-rejected', true)\n}",'        '),where='after')
# Place the diagnostic finally observation before the existing cleanup without changing cleanup order.
old='      } finally {\n        renderControllers.delete(controller)\n'+block("if (diagnosticProviderEntered && !diagnosticProviderSettled) {\n  traceRenderTimingRequest(input, 'provider-rejected', true)\n}",'        ')
new='      } finally {\n'+block("if (diagnosticProviderEntered && !diagnosticProviderSettled) {\n  traceRenderTimingRequest(input, 'provider-rejected', true)\n}",'        ')+'        renderControllers.delete(controller)\n'
assert old in s;s=s.replace(old,new)
p.write_text(s)
