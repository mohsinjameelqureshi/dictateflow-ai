import { readFileSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Builds the benchmark fixtures from two real recordings.
 *
 * The sources are the actual Phase 0 spike captures — real speech at 16kHz
 * mono 16-bit, byte-identical to what the app records, so the measurement
 * reflects the real pipeline rather than a synthetic tone.
 *
 * Only the two sources are committed. The fixtures are DERIVED and generated
 * on demand: keeping ~2.5MB of concatenations in git buys nothing when the
 * concatenation is deterministic.
 *
 *   node bench/make-fixtures.mjs
 */

const HERE = join(dirname(fileURLToPath(import.meta.url)), 'fixtures')

const RATE = 16000
const BYTES_PER_SAMPLE = 2

function readPcm(name) {
  const buf = readFileSync(join(HERE, name))
  if (buf.length < 44 || buf.toString('ascii', 0, 4) !== 'RIFF') {
    throw new Error(`${name} is not a WAV file`)
  }
  const channels = buf.readUInt16LE(22)
  const rate = buf.readUInt32LE(24)
  const bits = buf.readUInt16LE(34)
  if (channels !== 1 || rate !== RATE || bits !== 16) {
    throw new Error(`${name}: expected 16kHz mono 16-bit, got ${rate}Hz ${channels}ch ${bits}bit`)
  }
  // The app writes a canonical 44-byte header, so the data chunk starts there.
  return buf.subarray(44)
}

function writeWav(name, pcm) {
  const header = Buffer.alloc(44)
  header.write('RIFF', 0, 'ascii')
  header.writeUInt32LE(36 + pcm.length, 4)
  header.write('WAVE', 8, 'ascii')
  header.write('fmt ', 12, 'ascii')
  header.writeUInt32LE(16, 16)
  header.writeUInt16LE(1, 20) // PCM
  header.writeUInt16LE(1, 22) // mono
  header.writeUInt32LE(RATE, 24)
  header.writeUInt32LE(RATE * BYTES_PER_SAMPLE, 28)
  header.writeUInt16LE(BYTES_PER_SAMPLE, 32)
  header.writeUInt16LE(16, 34)
  header.write('data', 36, 'ascii')
  header.writeUInt32LE(pcm.length, 40)

  const out = Buffer.concat([header, pcm])
  writeFileSync(join(HERE, name), out)

  const seconds = pcm.length / (RATE * BYTES_PER_SAMPLE)
  console.log(
    `${name.padEnd(18)} ${seconds.toFixed(2).padStart(6)}s  ${(out.length / 1024)
      .toFixed(0)
      .padStart(5)} KB`,
  )
}

const a = readPcm('source-a.wav')
const b = readPcm('source-b.wav')

// Whole utterances, never cut mid-word: a clipped word would show up as a
// transcript difference and be mistaken for a chunk-boundary defect later.
writeWav('short.wav', a) //  ~7.8s
writeWav('medium.wav', Buffer.concat([a, b])) // ~18.4s
writeWav('long.wav', Buffer.concat([a, b, a, b, a, b])) // ~55.2s

console.log(
  '\nNote: long.wav repeats the same two utterances. That is fine for latency —\n' +
    'the input is identical across every variant, which is what makes the\n' +
    'comparison valid — but do not read anything into its transcript beyond\n' +
    'whether chunked output differs from baseline output on the SAME file.',
)
