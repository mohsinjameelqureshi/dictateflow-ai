--- Make the seeded "Enhance prompt" rule write in the author's own voice.
---
--- MEASURED: with the 0003 rule, Gemini produced "The user is a full-stack
--- engineer seeking to shift careers". Correct content, wrong person. The
--- result is pasted into the author's own chat box as their own prompt, so a
--- third-person description of them reads as someone else's notes about them.
--- The rule described what to include and never said whose voice to use.
---
--- Guarded on the 0003 text, for the reason 0003 gives: a rule that no longer
--- matches is a rule the user has edited, and their edit outranks this repair.
--- Both literals are wrapped in replace(..., char(13), '') because this
--- repository is checked out with core.autocrlf=true (see 0002).
UPDATE `transforms`
SET `rule` = replace('Rewrite the text as a clear, well-structured prompt for an AI assistant.

Always restructure it. Never return the text unchanged or nearly unchanged,
even if it already reads well — reshaping it is the entire purpose of this
rewrite, and returning it as-is is a failure.

The text was dictated aloud, so fix the grammar, the false starts and the
half-finished sentences that come from speaking rather than typing.

Write it in the first person, as the author speaking. Never describe them
from the outside — no "the user is", no "the author wants". This goes
straight into their chat box as their own words.

Produce, in this order:
- one sentence stating exactly what is being asked for
- any background they gave about themselves or their situation, in their voice
- a short bulleted list of what the answer must cover, one bullet per thing
  they asked about

Keep every requirement, constraint, name, number and piece of context the
author gave. Add no requirement they did not state. Never answer the request
itself. Return only the rewritten prompt.', char(13), '')
WHERE `rule` = replace('Rewrite the text as a clear, well-structured prompt for an AI assistant.

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
itself. Return only the rewritten prompt.', char(13), '');
