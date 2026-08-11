import { readFileSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Builds the benchmark fixtures from two real recordings.
 *
 * The sources must be real speech, not a synthetic tone — Whisper's timing
 * depends on what it is decoding, and a sine wave measures nothing useful.
 * They must also be 16kHz mono 16-bit, byte-identical in format to what the
 * app records, so the number reflects the real pipeline.
 *
 * NOTHING IN bench/fixtures/ IS COMMITTED, and that is deliberate: a recording
 * of someone's voice is personal data, and this repo is public. Supply your
 * own. The easiest way is to dictate twice in the app and copy the WAVs out of
 * `%APPDATA%\dictateflow-ai\recordings\`:
 *
 *   bench/fixtures/source-a.wav   ~8s of speech
 *   bench/fixtures/source-b.wav   ~11s of speech
 *
 * Then the derived fixtures (short/medium/long) are generated on demand —
 * keeping ~2.5MB of deterministic concatenations in git would buy nothing
 * even if the audio were shareable.
 *
 *   node bench/make-fixtures.mjs
 */

const HERE = join(dirname(fileURLToPath(import.meta.url)), 'fixtures')

const RATE = 16000
const BYTES_PER_SAMPLE = 2

function readPcm(name) {
  let buf
  try {
    buf = readFileSync(join(HERE, name))
  } catch (err) {
    if (err.code !== 'ENOENT') throw err
    // The sources are intentionally not in the repo. Say so here rather than
    // letting a bare ENOENT imply the checkout is broken.
    throw new Error(
      `bench/fixtures/${name} is missing.\n\n` +
        'Benchmark sources are not committed — they are recordings of a real\n' +
        'voice and this repo is public. Supply your own two clips as\n' +
        'bench/fixtures/source-a.wav (~8s) and source-b.wav (~11s),\n' +
        '16kHz mono 16-bit. Dictating twice in the app and copying the WAVs\n' +
        'out of %APPDATA%\\dictateflow-ai\\recordings\\ is the quickest way.',
    )
  }
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
