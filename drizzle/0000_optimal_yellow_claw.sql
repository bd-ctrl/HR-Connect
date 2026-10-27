CREATE TABLE `login_challenges` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`browser_hash` text NOT NULL,
	`callback_hash` text NOT NULL,
	`state` text NOT NULL,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`employee_id` text,
	`nickname` text
);
--> statement-breakpoint
CREATE INDEX `login_challenges_owner_created` ON `login_challenges` (`owner_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `login_sessions` (
	`token_hash` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`employee_id` text NOT NULL,
	`nickname` text NOT NULL,
	`expires_at` integer NOT NULL
);
