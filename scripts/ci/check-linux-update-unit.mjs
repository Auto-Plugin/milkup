import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {pathToFileURL} from 'node:url'

export function requireLoopbackTest(log) {
  assert.equal((log.match(/^test updates::ci_fixture::tests::download_is_exact_loopback_origin_and_path \.\.\. ok$/gm)??[]).length,1,'exact named test must execute once')
  const summaries=log.match(/^test result: .*$/gm)??[]
  assert.equal(summaries.length,1,'one test summary required')
  assert.match(summaries[0],/^test result: ok\. 1 passed; 0 failed; 0 ignored; 0 measured; \d+ filtered out; finished in [\d.]+s$/)
}
if (process.argv[1]&&pathToFileURL(process.argv[1]).href===import.meta.url) {
  assert.equal(process.argv.length,3)
  requireLoopbackTest(await readFile(process.argv[2],'utf8'))
  console.log('Exact single loopback unit test verified')
}
