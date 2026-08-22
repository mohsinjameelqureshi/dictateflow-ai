--- Repair the seeded "Enhance prompt" rule (MEASURED failure).
---
--- The rule shipped in 0002 ended with "If the text is already a good prompt,
--- return it close to unchanged." Both Groq and Gemini took that branch on a
--- dictated request and returned it VERBATIM — every word identical. The models
--- were not disobeying: a spoken request that states a goal and asks a question
--- genuinely reads as "already a good prompt". The escape hatch was the bug.
---
--- Guarded on the OLD TEXT, not on the id. A row whose rule no longer matches
--- what 0002 wrote is a rule the user has edited, and their edit outranks this
--- repair — the same reason 0002 seeds in a migration rather than at startup.
--- A user who deleted the rule gets nothing back, which is also correct.
---
--- Both literals are wrapped in replace(..., char(13), '') for the reason 0002
--- documents: this repository is checked out with core.autocrlf=true, so the
--- newlines below arrive as CRLF on a fresh clone and would otherwise be
--- embedded in the comparison AND in the replacement.
UPDATE `transforms`
SET `rule` = replace('Rewrite the text as a clear, well-structured prompt for an AI assistant.

Always restructure it. Never return the text unchanged or nearly unchanged,
even if it already reads well — reshaping it is the entire purpose of this
rewrite, and returning it as-is is a failure.

The text was dictated aloud, so fix the grammar, the false starts and the
half-finished sentences that come from speaking rather than typing.

Produce, in this order:
- one sentence stating exactly what is being asked for
- any background the author gave about themselves or their situation
- a short bulleted list of what the answer must cover, one bullet per thing
  the author asked about

Keep every requirement, constraint, name, number and piece of context the
author gave. Add no requirement they did not state. Never answer the request
itself. Return only the rewritten prompt.', char(13), '')
WHERE `rule` = replace('Rewrite the text as a clear, well-structured prompt for an AI assistant.

Keep every requirement, constraint, name, number and piece of context the
author gave. State the task first, then the specifics. Use short paragraphs
or bullets where that makes the request easier to follow.

Do not answer the request, do not add requirements the author did not state,
and do not pad it with filler. If the text is already a good prompt, return
it close to unchanged.', char(13), '');
