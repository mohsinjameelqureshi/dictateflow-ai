CREATE TABLE `transforms` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`rule` text NOT NULL,
	`shortcut` text DEFAULT '' NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`hit_count` integer DEFAULT 0 NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `transforms_sort_idx` ON `transforms` (`sort_order`);
--> statement-breakpoint
--- The seeded default (docs/transform-feature-plan.md §3.1).
--- Seeded HERE rather than at startup so that deleting it deletes it. A
--- startup seed would resurrect a rule the user threw away, every launch.
--- `created_at` is drizzle's `mode: 'timestamp'`, which is SECONDS.
---
--- The rule is wrapped in replace(..., char(13), '') because this repository
--- is checked out with core.autocrlf=true: the literal newlines below arrive
--- as CRLF on a fresh clone, and every one of them would be embedded in the
--- stored rule. Writing the file with LF does not help — git rewrites it. The
--- stored text has to match DEFAULT_TRANSFORM_RULE in shared/types.ts exactly.
INSERT INTO `transforms` (`name`, `rule`, `shortcut`, `enabled`, `hit_count`, `sort_order`, `created_at`)
VALUES (
	'Enhance prompt',
	replace('Rewrite the text as a clear, well-structured prompt for an AI assistant.

Keep every requirement, constraint, name, number and piece of context the
author gave. State the task first, then the specifics. Use short paragraphs
or bullets where that makes the request easier to follow.

Do not answer the request, do not add requirements the author did not state,
and do not pad it with filler. If the text is already a good prompt, return
it close to unchanged.', char(13), ''),
	'Ctrl+Alt+E',
	1,
	0,
	0,
	CAST(strftime('%s', 'now') AS INTEGER)
);
