import assert from 'node:assert/strict'
import { createServer } from 'node:https'
import { createHash, generateKeyPairSync } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { readFile, writeFile, stat, rename } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { signedFixture } from './signing-fixture.mjs'

const hash = (bytes) => createHash('sha256').update(bytes).digest('hex')
export async function startFixture({
  artifact,
  openssl,
  directory,
  maxMs = 600000,
  dotnetCertificate = process.platform === 'win32',
}) {
  assert(artifact.length > 0 && artifact.length < 32 * 1024 * 1024)
  assert(path.isAbsolute(directory) && path.isAbsolute(openssl))
  // Signing key stays in this process. The trusted certificate tool receives
  // the TLS key via stdin and returns only its public certificate: no key file
  // or trust-store edit. Windows uses built-in .NET CertificateRequest in pwsh.
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
  const key = privateKey.export({ type: 'pkcs8', format: 'pem' })
  const certificateArgs = dotnetCertificate
    ? [
        '-NoLogo',
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        `
      $ErrorActionPreference='Stop'
      Add-Type -TypeDefinition @'
using System;
using System.Net;
using System.Security.Cryptography;
using System.Security.Cryptography.X509Certificates;
public static class EphemeralLoopbackCertificate {
 public static string Create(string pem) {
  using var rsa=RSA.Create();
  rsa.ImportFromPem(pem);
  var request=new CertificateRequest("CN=127.0.0.1",rsa,HashAlgorithmName.SHA256,RSASignaturePadding.Pkcs1);
  var san=new SubjectAlternativeNameBuilder();san.AddIpAddress(IPAddress.Loopback);
  request.CertificateExtensions.Add(san.Build());
  request.CertificateExtensions.Add(new X509BasicConstraintsExtension(true,false,0,true));
  using var cert=request.CreateSelfSigned(DateTimeOffset.UtcNow.AddMinutes(-1),DateTimeOffset.UtcNow.AddHours(2));
  return cert.ExportCertificatePem();
 }
}
'@
      [Console]::Out.Write([EphemeralLoopbackCertificate]::Create([Console]::In.ReadToEnd()))
    `,
      ]
    : [
        'req',
        '-new',
        '-x509',
        '-key',
        '/dev/stdin',
        '-outform',
        'PEM',
        '-days',
        '1',
        '-subj',
        '/CN=127.0.0.1',
        '-addext',
        'subjectAltName=IP:127.0.0.1',
        '-addext',
        'basicConstraints=critical,CA:TRUE',
      ]
  // Node uses a Unix socket for piped stdin; a shell pipe lets OpenSSL open
  // /dev/stdin without persisting the key. Command text is fixed, tool is argv.
  const cert = execFileSync(
    dotnetCertificate ? openssl : '/bin/sh',
    dotnetCertificate
      ? certificateArgs
      : ['-c', 'cat | "$@"', 'certificate', openssl, ...certificateArgs],
    {
      input: key,
      timeout: 15000,
      maxBuffer: 16384,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    },
  )
  const signed = signedFixture({ artifact })
  const wrongAuthority = signedFixture({ artifact })
  const corrupt = Buffer.from(artifact)
  corrupt[corrupt.length - 1] ^= 1
  const issuedAt = Math.floor(Date.now() / 1000)
  const record = {
    schema: 1,
    status: 'starting',
    artifactBytes: artifact.length,
    artifactSha256: hash(artifact),
    certificateSha256: hash(cert),
    requests: [],
    transferredBytes: 0,
    scope:
      'Loopback HTTPS; ephemeral in-memory test authority; no system trust or production channel changes',
  }
  let serial = Promise.resolve()
  const persist = () => {
    const bytes = JSON.stringify(record, null, 2)
    serial = serial.then(async () => {
      await writeFile(path.join(directory, 'endpoint-report.json.tmp'), bytes)
      await rename(
        path.join(directory, 'endpoint-report.json.tmp'),
        path.join(directory, 'endpoint-report.json'),
      )
    })
    return serial
  }
  const modePath = path.join(directory, 'endpoint-mode.txt')
  await writeFile(modePath, 'bad-manifest')
  let envelope
  const server = createServer({ key, cert }, async (req, res) => {
    try {
      assert(['127.0.0.1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress))
      assert.equal(req.method, 'GET')
      assert(record.requests.length < 64, 'Request budget')
      assert((await stat(modePath)).size < 64)
      const mode = (await readFile(modePath, 'utf8')).trim()
      assert(['bad-manifest', 'download-error', 'bad-artifact', 'valid'].includes(mode))
      let bytes,
        status = 200
      if (req.url === '/manifest.json')
        bytes = mode === 'bad-manifest' ? wrongAuthority.envelope() : envelope
      else if (req.url === '/candidate.exe') {
        if (mode === 'download-error') {
          bytes = Buffer.from('controlled download unavailable')
          status = 503
        } else bytes = mode === 'bad-artifact' ? corrupt : artifact
      } else {
        bytes = Buffer.from('not found')
        status = 404
      }
      record.transferredBytes += bytes.length
      assert(record.transferredBytes <= 96 * 1024 * 1024, 'Transfer budget')
      record.requests.push({
        at: new Date().toISOString(),
        method: req.method,
        path: req.url,
        mode,
        status,
        bytes: bytes.length,
        sha256: hash(bytes),
      })
      await persist()
      res.writeHead(status, {
        'content-type':
          req.url === '/manifest.json' ? 'application/json' : 'application/octet-stream',
        'content-length': bytes.length,
        'cache-control': 'no-store',
      })
      res.end(bytes)
    } catch (error) {
      record.status = 'failed'
      record.error = String(error)
      await persist()
      res.writeHead(500)
      res.end('fixture failure')
    }
  })
  server.requestTimeout = 15000
  server.headersTimeout = 10000
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const base = `https://127.0.0.1:${server.address().port}`
  signed.config.endpoints = [`${base}/manifest.json`]
  signed.statement.release.version = '2.0.0-beta.11'
  signed.statement.release.notes = 'Isolated native updater acceptance; not a production release'
  signed.statement.release.milkup = { sequence: 2, issuedAt, expiresAt: issuedAt + 3600 }
  signed.statement.release.platforms['windows-x86_64'].url = `${base}/candidate.exe`
  Object.assign(wrongAuthority.statement, signed.statement) // same payload, different signing authority
  envelope = signed.envelope()
  await writeFile(path.join(directory, 'accepted-manifest.json'), envelope)
  await writeFile(
    path.join(directory, 'public-fixture.json'),
    JSON.stringify(
      {
        scope: 'isolated-in-app-update-not-for-distribution',
        expiresAt: issuedAt + 3600,
        channel: signed.config,
        certificatePem: cert.toString('utf8'),
      },
      null,
      2,
    ),
  )
  record.status = 'listening'
  record.endpoint = base
  await persist()
  let stopped = false
  const stop = async (reason = 'requested') => {
    if (stopped) return
    stopped = true
    clearTimeout(timer)
    server.closeAllConnections()
    await new Promise((resolve) => server.close(resolve))
    record.stopReason = reason
    record.status = reason === 'requested' && record.status !== 'failed' ? 'closed' : 'failed'
    await persist()
  }
  const timer = setTimeout(() => void stop('deadline'), maxMs)
  return { cert, base, record, stop }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const [directory, installer, openssl] = process.argv.slice(2)
  assert.equal(process.platform, 'win32')
  assert.equal(process.env.GITHUB_ACTIONS, 'true')
  const artifact = await readFile(installer)
  assert.equal(hash(artifact), 'e4deb93fc3500cb3b49c7da94c6e777e47ea09851e0f9e6dd3b94aba31cc9f75')
  const fixture = await startFixture({ artifact, openssl, directory })
  const poll = setInterval(async () => {
    if (fixture.record.status === 'failed') {
      clearInterval(poll)
      await fixture.stop('failed')
      process.exitCode = 1
      return
    }
    if (
      await stat(path.join(directory, 'endpoint-stop')).then(
        () => true,
        () => false,
      )
    ) {
      clearInterval(poll)
      await fixture.stop()
    }
  }, 250)
}
