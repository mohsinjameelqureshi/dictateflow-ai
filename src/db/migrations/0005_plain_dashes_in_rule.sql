--- Plain hyphens in the seeded "Enhance prompt" rule.
--- 
--- The rule is shown verbatim in the Transform editor, so its punctuation is
--- user-visible text rather than source formatting. Em dashes are replaced with
--- plain hyphens to match the rest of the app's copy.
--- 
--- Guarded on the 0004 text, for the reason 0003 and 0004 both give: a rule
--- that no longer matches is a rule the user has edited, and their edit
--- outranks a cosmetic repair. Both literals are wrapped in
--- replace(..., char(13), '') because this repository is checked out with
--- core.autocrlf=true (see 0002).
UPDATE `transforms`
SET `rule` = replace('Rewrite the text as a clear, well-structured prompt for an AI assistant.

Always restructure it. Never return the text unchanged or nearly unchanged,
even if it already reads well - reshaping it is the entire purpose of this
rewrite, and returning it as-is is a failure.

The text was dictated aloud, so fix the grammar, the false starts and the
half-finished sentences that come from speaking rather than typing.

Write it in the first person, as the author speaking. Never describe them
from the outside - no "the user is", no "the author wants". This goes
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
itself. Return only the rewritten prompt.', char(13), '');
