import {
  createCipheriv,
  createDecipheriv,
  publicEncrypt,
  privateDecrypt,
  randomBytes,
  constants,
  createHash,
} from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import { open, readFile, link, rm, stat, writeFile } from 'node:fs/promises'
import { pipeline } from 'node:stream/promises'
import { pathToFileURL } from 'node:url'
const magic = Buffer.from('MILKUP-ETW-SEALED-1\n')
const limit = 2 * 1024 ** 3
export async function seal(input, publicKey, output) {
  const size = (await stat(input)).size
  if (size <= 0 || size > limit) throw Error('Bounded nonempty ETL required')
  const key = randomBytes(32),
    nonce = randomBytes(12)
  const wrappedKey = publicEncrypt(
    {
      key: await readFile(publicKey),
      oaepHash: 'sha256',
      padding: constants.RSA_PKCS1_OAEP_PADDING,
    },
    key,
  )
  const header = Buffer.from(
    JSON.stringify({
      size,
      nonce: nonce.toString('base64'),
      wrappedKey: wrappedKey.toString('base64'),
    }),
  )
  const length = Buffer.alloc(4)
  length.writeUInt32BE(header.length)
  const prefix = Buffer.concat([magic, length, header])
  const cipher = createCipheriv('aes-256-gcm', key, nonce)
  cipher.setAAD(prefix)
  const temp = output + '.partial'
  await writeFile(temp, prefix, { flag: 'wx', mode: 0o600 })
  try {
    await pipeline(createReadStream(input), cipher, createWriteStream(temp, { flags: 'a' }))
    const f = await open(temp, 'a')
    try {
      await f.write(cipher.getAuthTag())
    } finally {
      await f.close()
    }
    await link(temp, output)
    await rm(temp)
  } catch (e) {
    await rm(temp, { force: true })
    throw e
  } finally {
    key.fill(0)
  }
  return {
    bytes: (await stat(output)).size,
    algorithm: 'RSA-OAEP-SHA256/AES-256-GCM',
    rawBytes: size,
  }
}
export async function unseal(input, privateKey, output, relayEnvelope) {
  const f = await open(input, 'r')
  let header, prefix, size
  try {
    const begin = Buffer.alloc(magic.length + 4)
    await f.read(begin, 0, begin.length, 0)
    if (!begin.subarray(0, magic.length).equals(magic)) throw Error('Invalid sealed trace')
    const n = begin.readUInt32BE(magic.length)
    if (n < 32 || n > 8192) throw Error('Header budget')
    const body = Buffer.alloc(n)
    await f.read(body, 0, n, begin.length)
    header = JSON.parse(body)
    prefix = Buffer.concat([begin, body])
    size = (await f.stat()).size
    if (
      !Number.isSafeInteger(header.size) ||
      header.size <= 0 ||
      header.size > limit ||
      size !== prefix.length + header.size + 16
    )
      throw Error('Length mismatch')
  } finally {
    await f.close()
  }
  const key = privateDecrypt(
    {
      key: await readFile(privateKey),
      oaepHash: 'sha256',
      padding: constants.RSA_PKCS1_OAEP_PADDING,
    },
    Buffer.from(
      relayEnvelope
        ? JSON.parse(await readFile(relayEnvelope, 'utf8')).wrappedKey
        : header.wrappedKey,
      'base64',
    ),
  )
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(header.nonce, 'base64'))
  decipher.setAAD(prefix)
  const tail = await open(input, 'r')
  const tag = Buffer.alloc(16)
  try {
    await tail.read(tag, 0, 16, size - 16)
  } finally {
    await tail.close()
  }
  decipher.setAuthTag(tag)
  const temp = output + '.partial'
  await writeFile(temp, Buffer.alloc(0), { flag: 'wx', mode: 0o600 })
  try {
    await pipeline(
      createReadStream(input, { start: prefix.length, end: size - 17 }),
      decipher,
      createWriteStream(temp, { flags: 'w', mode: 0o600 }),
    )
    await link(temp, output)
    await rm(temp)
  } catch (e) {
    await rm(temp, { force: true })
    throw e
  } finally {
    key.fill(0)
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [mode, input, key, output, relayEnvelope] = process.argv.slice(2)
  if (mode !== 'seal' && mode !== 'unseal') throw Error('Explicit mode required')
  const result = await (mode === 'seal' ? seal : unseal)(input, key, output, relayEnvelope)
  const hash = createHash('sha256')
  for await (const b of createReadStream(output)) hash.update(b)
  console.log(JSON.stringify({ ...result, sha256: hash.digest('hex') }))
}
