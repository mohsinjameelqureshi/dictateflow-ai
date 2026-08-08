---
name: groq-bench
description: Measure TypeFlow AI transcription latency reproducibly and log results, so performance claims rest on numbers instead of intuition. Use when answering open questions §15.1 (does connection reuse recover 200-400ms?) and §15.2 (does chunked upload deliver?), when latency regresses, or before claiming any optimization worked.
---

# Groq latency benchmark

§3's numbers exist because they were measured. Every future performance claim
must clear the same bar. This skill is the harness that makes that cheap.

## The baseline (do not re-litigate)

```
Cold single request, ~15s of speech:

  STT (Whisper Turbo)      1900 – 2100 ms
  LLM cleanup (Llama 70B)    260 –  310 ms
  ─────────────────────────────────────────
  Total                    2200 – 2400 ms
```

Already tested and ruled out: **audio format is not the bottleneck.** 44.1kHz
stereo → 16kHz mono cut file size 67% and saved ~150ms, inside run-to-run
noise. At 228x real-time, actual transcription compute for a 15s clip is ~70ms.
**~95% of the 1900ms is network round-trip, TLS handshake, and free-tier queue
time.**

The consequence: optimizations that reduce *bytes* or *compute* will not move
the number. Only optimizations that reduce *round-trips* or *perceived* wait
time will. Both open questions are of that kind, which is why they are the
ones worth measuring.

## Method

**Fixed input.** Keep a small set of pre-recorded WAVs (~5s, ~15s, ~60s) in
`bench/fixtures/`. Never benchmark against live speech — the input has to be
byte-identical across runs or the comparison is meaningless.

`bench/fixtures/` is gitignored in full. The sources are recordings of a real
voice and this repo is public, so they are never committed. Supply two clips
of your own as `source-a.wav` (~8s) and `source-b.wav` (~11s), 16kHz mono
16-bit, then `node bench/make-fixtures.mjs` derives the rest. Running it
without them prints instructions rather than a stack trace.

**Segment the timing.** A single total is not actionable. Record separately:

```ts
interface BenchSample {
  fixture: string        // which WAV
  variant: string        // 'baseline' | 'keepalive' | 'chunked'
  dnsMs: number
  tlsMs: number          // 0 on a reused connection — this is the signal
  uploadMs: number
  serverMs: number
  totalMs: number
  perceivedMs: number    // key-release → text inserted. The number that matters.
  at: string             // ISO timestamp
}
```

`perceivedMs` is the product metric. `totalMs` is the diagnostic. For chunked
upload they diverge sharply — that divergence *is* the win.

**N ≥ 10 per variant, report the distribution.** Free-tier queue time is
variable. Report median and p90, not mean. A mean over 3 runs on a shared free
tier is noise with a decimal point.

**Interleave variants.** Run baseline/variant/baseline/variant rather than ten
of each. Groq's free-tier load drifts over minutes; blocked runs bake that
drift into the result.

**Append, never overwrite.** Results go to `bench/results.jsonl`, one JSON
object per line. The history is the point — it is what catches a regression
three phases from now.

## Open question §15.1 — connection reuse

**Hypothesis:** a long-lived client in the main process amortises DNS + TCP +
TLS across requests. Expected recovery: 200–400ms.

**Test:** same fixture, cold client per request vs. one shared client reused
across all requests.

**Confirming evidence:** `tlsMs` drops to ~0 on requests after the first, and
median `totalMs` falls by 200–400ms. If `tlsMs` drops but `totalMs` does not,
the time was queue time all along and the optimization is worthless — record
that outcome, it is just as valuable.

## Open question §15.2 — chunked upload

**Hypothesis:** streaming audio in ~5s chunks *during* recording converts most
of the wall-clock into perceived-zero time. §3 calls this the single largest
win available and the main reason the app will feel fast.

**Test:** measure `perceivedMs` (key-release → insertion), not `totalMs`.
Total work may well go *up* — more requests, more overhead. That is fine and
expected. The claim is about perceived latency only.

**Confirming evidence:** `perceivedMs` for a 60s clip approaches `perceivedMs`
for a 5s clip, because everything but the final chunk was already uploaded.
Flat scaling with clip length is the whole hypothesis.

Watch for: chunk-boundary word splitting, and whether Whisper's accuracy drops
when it loses full-utterance context. A latency win paid for in accuracy is
not a win — check transcript quality against the same fixture's baseline
output, not just the clock.

## Also worth logging

- **HTTP 429 rate** per variant. Chunked upload multiplies request count; if
  it trips free-tier limits the approach has a ceiling the timings won't show.
- **25MB limit** (§15.4). A 16kHz mono WAV hits it around 13 minutes. Log
  fixture sizes so the real ceiling is known rather than guessed.

## Reporting

State median and p90 with N, and name what was *not* controlled — time of day,
network, free-tier load. §3 is credible because it says what it ruled out.
Match that standard.

If a hypothesis fails, write the negative result into `CLAUDE.md` §15. A ruled-out
optimization is a permanent gain: it stops the idea from being re-proposed.
