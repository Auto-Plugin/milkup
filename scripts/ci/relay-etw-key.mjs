// Rewrap only the per-trace AES key for a single analysis runner. The original
// private key never leaves the authorized local workspace. The original GCM AAD
// is unchanged; unseal still authenticates all bytes before publishing plaintext.
import { constants, createHash, privateDecrypt, publicEncrypt } from 'node:crypto'
import { open, readFile, writeFile } from 'node:fs/promises'
import { createReadStream } from 'node:fs'
import { pathToFileURL } from 'node:url'
export async function relay(input, privateKeyPath, recipientPath, output, analysisRun) {
  if (!/^\d{8,20}$/.test(analysisRun)) throw Error('Exact analysis run required')
  const magic = Buffer.from('MILKUP-ETW-SEALED-1\n')
  const file = await open(input, 'r')
  let header
  try {
    const prefix = Buffer.alloc(magic.length + 4)
    await file.read(prefix, 0, prefix.length, 0)
    if (!prefix.subarray(0, magic.length).equals(magic)) throw Error('Invalid sealed input')
    const n = prefix.readUInt32BE(magic.length)
    if (n < 32 || n > 8192) throw Error('Header budget')
    const b = Buffer.alloc(n)
    await file.read(b, 0, n, prefix.length)
    header = JSON.parse(b)
  } finally {
    await file.close()
  }
  const recipient = await readFile(recipientPath)
  const key = privateDecrypt(
    {
      key: await readFile(privateKeyPath),
      oaepHash: 'sha256',
      padding: constants.RSA_PKCS1_OAEP_PADDING,
    },
    Buffer.from(header.wrappedKey, 'base64'),
  )
  try {
    const hash = createHash('sha256')
    for await (const b of createReadStream(input)) hash.update(b)
    const result = {
      schema: 1,
      analysisRun,
      traceSha256: hash.digest('hex'),
      recipientSha256: createHash('sha256').update(recipient).digest('hex'),
      wrappedKey: publicEncrypt(
        { key: recipient, oaepHash: 'sha256', padding: constants.RSA_PKCS1_OAEP_PADDING },
        key,
      ).toString('base64'),
    }
    await writeFile(output, JSON.stringify(result, null, 2) + '\n', { flag: 'wx', mode: 0o600 })
    return result
  } finally {
    key.fill(0)
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [input, priv, pub, out, run] = process.argv.slice(2)
  const r = await relay(input, priv, pub, out, run)
  console.log(
    JSON.stringify({
      analysisRun: r.analysisRun,
      traceSha256: r.traceSha256,
      recipientSha256: r.recipientSha256,
    }),
  )
}
