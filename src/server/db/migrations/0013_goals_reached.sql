CREATE TABLE `archived_goals` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`owner_user_id` text,
	`saver_name` text NOT NULL,
	`name` text NOT NULL,
	`kind` text NOT NULL,
	`target_cents` integer NOT NULL,
	`debt_name` text,
	`debt_paid_off` integer DEFAULT false NOT NULL,
	`reached_on` text NOT NULL,
	`archived_at` text NOT NULL,
	FOREIGN KEY (`owner_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `goal_celebrations_seen` (
	`account_id` text NOT NULL,
	`user_id` text NOT NULL,
	`reached_on` text NOT NULL,
	PRIMARY KEY(`account_id`, `user_id`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
ALTER TABLE `goals` ADD `reached_on` text;