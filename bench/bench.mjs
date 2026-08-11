import https from 'node:https'
import { appendFileSync, readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { performance } from 'node:perf_hooks'

/**
 * Groq transcription latency harness (§3, §15).
 *
 *   GROQ_API_KEY=gsk_... node bench/bench.mjs --n 10 --fixture medium
 *
 * Uses raw `https.request` rather than the SDK or fetch on purpose: socket
 * events are the only way to see DNS, TCP and TLS separately, and "tlsMs
 * drops to ~0 on the second request" is precisely the evidence §15.1 asks
 * for. The SDK would hide it.
 *
 * Variants are INTERLEAVED, never blocked. Groq's free-tier load drifts over
 * minutes, and ten of one followed by ten of the other bakes that drift into
 * the result as if it were the effect.
 */

const HERE = dirname(fileURLToPath(import.meta.url))
const RESULTS = join(HERE, 'results.jsonl')
const MODEL = 'whisper-large-v3-turbo'

const KEY = process.env.GROQ_API_KEY
if (!KEY) {
  console.error(
    'GROQ_API_KEY is not set.\n\n' +
      'The app keeps its key in safeStorage, which only the Electron main\n' +
      'process can decrypt, so the bench needs its own copy in the environment:\n\n' +
      '  GROQ_API_KEY=gsk_... node bench/bench.mjs\n',
  )
  process.exit(1)
}

/* ---------------------------------------------------------------- args ---- */

const args = process.argv.slice(2)
const arg = (name, fallback) => {
  const i = args.indexOf(`--${name}`)
  return i === -1 ? fallback : args[i + 1]
}

const N = Number(arg('n', 10))
const FIXTURE = arg('fixture', 'medium')
const VARIANTS = arg('variants', 'cold,keepalive').split(',')

/* ------------------------------------------------------------ request ---- */

/** One shared agent — this is the whole point of the `keepalive` variant. */
const keepAliveAgent = new https.Agent({ keepAlive: true, maxSockets: 4 })

function multipart(wav, boundary) {
  const field = (name, value) =>
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`,
    )

  return Buffer.concat([
    field('model', MODEL),
    field('response_format', 'json'),
    field('language', 'en'),
    Buffer.from(
      `--${boundary}\r\n` +
        `Content-Disposition: form-data; name="file"; filename="clip.wav"\r\n` +
        `Content-Type: audio/wav\r\n\r\n`,
    ),
    wav,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ])
}

function transcribe(wav, { reuse }) {
  return new Promise((resolve) => {
    const boundary = `----dictateflow${Math.random().toString(16).slice(2)}`
    const body = multipart(wav, boundary)

    const started = performance.now()
    let tSocket = 0
    let tLookup = 0
    let tConnect = 0
    let tSecure = 0
    let tSent = 0
    let tFirstByte = 0
    let reused = false

    const req = https.request(
      {
        host: 'api.groq.com',
        path: '/openai/v1/audio/transcriptions',
        method: 'POST',
        // A fresh agent per request forces a full DNS + TCP + TLS handshake,
        // which is what the app did before the client was made long-lived.
        agent: reuse ? keepAliveAgent : new https.Agent({ keepAlive: false }),
        headers: {
          authorization: `Bearer ${KEY}`,
          'content-type': `multipart/form-data; boundary=${boundary}`,
          'content-length': body.length,
        },
      },
      (res) => {
        const chunks = []
        res.on('data', (c) => {
          if (!tFirstByte) tFirstByte = performance.now()
          chunks.push(c)
        })
        res.on('end', () => {
          const totalMs = performance.now() - started
          const raw = Buffer.concat(chunks).toString('utf8')

          let text = ''
          try {
            text = JSON.parse(raw).text ?? ''
          } catch {
            text = ''
          }

          resolve({
            status: res.statusCode,
            text: text.trim(),
            reused,
            dnsMs: reused ? 0 : round(tLookup - tSocket),
            tcpMs: reused ? 0 : round(tConnect - (tLookup || tSocket)),
            tlsMs: reused ? 0 : round(tSecure - tConnect),
            uploadMs: round(tSent - (tSecure || tSocket)),
            serverMs: round((tFirstByte || performance.now()) - tSent),
            totalMs: round(totalMs),
            // Nothing is uploaded until the key is released, so for a single
            // request these are the same number. Chunked upload is the whole
            // reason they are recorded separately.
            perceivedMs: round(totalMs),
          })
        })
      },
    )

    req.on('socket', (socket) => {
      tSocket = performance.now()
      if (!socket.connecting) {
        // Handed an already-open socket: no handshake to pay for.
        reused = true
        return
      }
      socket.once('lookup', () => (tLookup = performance.now()))
      socket.once('connect', () => (tConnect = performance.now()))
      socket.once('secureConnect', () => (tSecure = performance.now()))
    })

    req.on('finish', () => (tSent = performance.now()))
    req.on('error', (err) =>
      resolve({ status: 0, error: err.message, totalMs: round(performance.now() - started) }),
    )

    req.end(body)
  })
}

const round = (n) => Math.round(n * 10) / 10

/* -------------------------------------------------------------- stats ---- */

function quantile(values, q) {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const i = Math.min(sorted.length - 1, Math.floor(q * (sorted.length - 1)))
  return sorted[i]
}

/* --------------------------------------------------------------- main ---- */

const wav = readFileSync(join(HERE, 'fixtures', `${FIXTURE}.wav`))
const seconds = (wav.length - 44) / 32000

console.log(
  `fixture ${FIXTURE}.wav  ${seconds.toFixed(1)}s  ${(wav.length / 1024).toFixed(0)}KB\n` +
    `variants ${VARIANTS.join(' vs ')}, N=${N} each, interleaved\n`,
)

const samples = []
const at = new Date().toISOString()

for (let i = 0; i < N; i++) {
  for (const variant of VARIANTS) {
    const result = await transcribe(wav, { reuse: variant === 'keepalive' })
    const sample = { fixture: FIXTURE, seconds: round(seconds), variant, at, run: i, ...result }
    samples.push(sample)
    appendFileSync(RESULTS, JSON.stringify(sample) + '\n')

    const flag = result.status === 429 ? ' RATE-LIMITED' : result.status !== 200 ? ` HTTP ${result.status}` : ''
    console.log(
      `  ${String(i + 1).padStart(2)} ${variant.padEnd(10)} ` +
        `total ${String(result.totalMs).padStart(7)}ms  ` +
        `tls ${String(result.tlsMs ?? 0).padStart(6)}ms  ` +
        `server ${String(result.serverMs ?? 0).padStart(7)}ms` +
        flag,
    )
  }
}

console.log('\n--- median / p90 over N=' + N + ' ---')
for (const variant of VARIANTS) {
  const ok = samples.filter((s) => s.variant === variant && s.status === 200)
  const totals = ok.map((s) => s.totalMs)
  const tls = ok.map((s) => s.tlsMs)
  const rateLimited = samples.filter((s) => s.variant === variant && s.status === 429).length

  console.log(
    `${variant.padEnd(10)} n=${ok.length}  ` +
      `total ${quantile(totals, 0.5)} / ${quantile(totals, 0.9)}ms   ` +
      `tls ${quantile(tls, 0.5)}ms` +
      (rateLimited ? `   429s: ${rateLimited}` : ''),
  )
}

// A latency win paid for in accuracy is not a win.
const transcripts = new Set(samples.filter((s) => s.status === 200).map((s) => s.text))
console.log(
  `\ndistinct transcripts across all runs: ${transcripts.size}` +
    (transcripts.size > 1 ? '  <- variants disagree, compare before trusting timings' : ''),
)
console.log(`\nappended ${samples.length} samples to bench/results.jsonl`)
