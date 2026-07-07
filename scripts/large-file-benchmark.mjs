#!/usr/bin/env node
import { createReadStream, createWriteStream } from 'node:fs'
import { mkdir, open, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, resolve } from 'node:path'
import { performance } from 'node:perf_hooks'

const MIB = 1024 * 1024

const options = parseArgs(process.argv.slice(2))
const targetBytes = options.sizeMib * MIB
const outputPath = resolve(options.out ?? `${tmpdir()}/milkup-large-${options.sizeMib}mib.md`)
const chunkSize = options.chunkSizeKib * 1024

await mkdir(dirname(outputPath), { recursive: true })

const startedAt = new Date().toISOString()
const generated = options.skipGenerate
  ? await stat(outputPath).then((entry) => ({ bytes: entry.size, durationMs: 0 }))
  : await generateSyntheticMarkdown(outputPath, targetBytes)
const scanned = await scanFile(outputPath, chunkSize)
const sampled = await sampleChunks(outputPath, generated.bytes)

const report = {
  startedAt,
  file: outputPath,
  requestedSizeMib: options.sizeMib,
  actualSizeBytes: generated.bytes,
  chunkSizeBytes: chunkSize,
  generate: {
    durationMs: round(generated.durationMs),
    throughputMibPerSecond: throughput(generated.bytes, generated.durationMs),
    skipped: options.skipGenerate,
  },
  scan: {
    durationMs: round(scanned.durationMs),
    throughputMibPerSecond: throughput(scanned.bytes, scanned.durationMs),
    bytes: scanned.bytes,
    lineCount: scanned.lineCount,
  },
  samples: sampled,
}

console.log(JSON.stringify(report, null, 2))

function parseArgs(args) {
  const parsed = {
    sizeMib: 16,
    out: undefined,
    chunkSizeKib: 1024,
    skipGenerate: false,
  }

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]

    if (arg === '--') {
      continue
    }

    if (arg === '--skip-generate') {
      parsed.skipGenerate = true
      continue
    }

    const next = args[index + 1]

    if (arg === '--size-mib' && next) {
      parsed.sizeMib = parsePositiveInteger(next, arg)
      index += 1
      continue
    }

    if (arg === '--out' && next) {
      parsed.out = next
      index += 1
      continue
    }

    if (arg === '--chunk-size-kib' && next) {
      parsed.chunkSizeKib = parsePositiveInteger(next, arg)
      index += 1
      continue
    }

    throw new Error(`Unknown or incomplete argument: ${arg}`)
  }

  return parsed
}

function parsePositiveInteger(value, name) {
  const parsed = Number(value)

  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer`)
  }

  return parsed
}

async function generateSyntheticMarkdown(path, targetSizeBytes) {
  const started = performance.now()
  const stream = createWriteStream(path, { encoding: 'utf8' })
  let bytes = 0
  let index = 0

  bytes += await write(stream, '# Synthetic Large Markdown\n\n')

  while (bytes < targetSizeBytes) {
    const line =
      index % 128 === 0
        ? `\n\`\`\`ts\nexport const marker${index} = ${index}\n\`\`\`\n\n`
        : `- repeated item ${String(index).padStart(9, '0')}: **bold** [link](./target.md) marker-${index}\n`
    const lineBytes = Buffer.byteLength(line)
    const remaining = targetSizeBytes - bytes

    if (lineBytes <= remaining) {
      bytes += await write(stream, line)
    } else {
      bytes += await write(stream, 'x'.repeat(remaining))
    }

    index += 1
  }

  await closeStream(stream)

  return {
    bytes,
    durationMs: performance.now() - started,
  }
}

function write(stream, text) {
  return new Promise((resolveWrite, rejectWrite) => {
    stream.write(text, (error) => {
      if (error) {
        rejectWrite(error)
        return
      }

      resolveWrite(Buffer.byteLength(text))
    })
  })
}

function closeStream(stream) {
  return new Promise((resolveClose, rejectClose) => {
    stream.end((error) => {
      if (error) {
        rejectClose(error)
        return
      }

      resolveClose()
    })
  })
}

function scanFile(path, highWaterMark) {
  return new Promise((resolveScan, rejectScan) => {
    const started = performance.now()
    const stream = createReadStream(path, { highWaterMark })
    let bytes = 0
    let lineCount = 0

    stream.on('data', (chunk) => {
      bytes += chunk.byteLength

      for (const byte of chunk) {
        if (byte === 10) {
          lineCount += 1
        }
      }
    })
    stream.on('error', rejectScan)
    stream.on('end', () => {
      resolveScan({
        bytes,
        lineCount,
        durationMs: performance.now() - started,
      })
    })
  })
}

async function sampleChunks(path, fileSizeBytes) {
  const sampleSize = Math.min(4096, fileSizeBytes)
  const positions = [
    0,
    Math.max(0, Math.floor(fileSizeBytes / 2) - Math.floor(sampleSize / 2)),
    Math.max(0, fileSizeBytes - sampleSize),
  ]
  const handle = await open(path, 'r')

  try {
    const samples = []

    for (const position of positions) {
      const buffer = Buffer.alloc(sampleSize)
      const started = performance.now()
      const result = await handle.read(buffer, 0, sampleSize, position)

      samples.push({
        position,
        bytesRead: result.bytesRead,
        durationMs: round(performance.now() - started),
      })
    }

    return samples
  } finally {
    await handle.close()
  }
}

function throughput(bytes, durationMs) {
  if (durationMs === 0) {
    return null
  }

  return round(bytes / MIB / (durationMs / 1000))
}

function round(value) {
  return Math.round(value * 100) / 100
}
