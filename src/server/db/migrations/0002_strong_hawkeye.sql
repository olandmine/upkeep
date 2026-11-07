CREATE TABLE `budget_anchor_changes` (
	`budget_id` text NOT NULL,
	`effective_date` text NOT NULL,
	`user_id` text NOT NULL,
	PRIMARY KEY(`budget_id`, `effective_date`),
	FOREIGN KEY (`budget_id`) REFERENCES `budgets`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `budget_line_categories` (
	`line_id` text NOT NULL,
	`category_id` text NOT NULL,
	PRIMARY KEY(`line_id`, `category_id`),
	FOREIGN KEY (`line_id`) REFERENCES `budget_lines`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `budget_lines` (
	`id` text PRIMARY KEY NOT NULL,
	`budget_id` text NOT NULL,
	`kind` text NOT NULL,
	`name` text NOT NULL,
	`amount_cents` integer NOT NULL,
	`saver_account_id` text,
	`sort_order` integer NOT NULL,
	`created_at` text NOT NULL,
	`archived_at` text,
	FOREIGN KEY (`budget_id`) REFERENCES `budgets`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `budget_lines_budget_idx` ON `budget_lines` (`budget_id`);--> statement-breakpoint
CREATE TABLE `budgets` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`owner_user_id` text,
	`anchor_user_id` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`owner_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`anchor_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `budgets_owner_user_id_unique` ON `budgets` (`owner_user_id`);--> statement-breakpoint
CREATE TABLE `pay_events` (
	`user_id` text NOT NULL,
	`pay_date` text NOT NULL,
	`source` text NOT NULL,
	`transaction_id` text,
	`amount_cents` integer,
	`extra_tx_ids_json` text DEFAULT '[]' NOT NULL,
	`derived_at` text NOT NULL,
	PRIMARY KEY(`user_id`, `pay_date`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `pay_exclusions` (
	`user_id` text NOT NULL,
	`transaction_id` text NOT NULL,
	PRIMARY KEY(`user_id`, `transaction_id`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `pay_plan_items` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`pay_date` text NOT NULL,
	`target_kind` text NOT NULL,
	`line_id` text,
	`saver_account_id` text,
	`amount_cents` integer NOT NULL,
	`sort_order` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`line_id`) REFERENCES `budget_lines`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `pay_plan_items_plan_idx` ON `pay_plan_items` (`user_id`,`pay_date`);--> statement-breakpoint
CREATE TABLE `pay_plans` (
	`user_id` text NOT NULL,
	`pay_date` text NOT NULL,
	`customised` integer DEFAULT false NOT NULL,
	PRIMARY KEY(`user_id`, `pay_date`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `pay_schedules` (
	`user_id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`description_match` text NOT NULL,
	`min_amount_cents` integer NOT NULL,
	`frequency_days` integer DEFAULT 14 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `period_lines` (
	`budget_id` text NOT NULL,
	`period_start` text NOT NULL,
	`line_id` text NOT NULL,
	`amount_cents` integer NOT NULL,
	`sort_order` integer NOT NULL,
	PRIMARY KEY(`budget_id`, `period_start`, `line_id`),
	FOREIGN KEY (`budget_id`) REFERENCES `budgets`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`line_id`) REFERENCES `budget_lines`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `plan_template_items` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`target_kind` text NOT NULL,
	`line_id` text,
	`saver_account_id` text,
	`amount_cents` integer NOT NULL,
	`sort_order` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`line_id`) REFERENCES `budget_lines`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `plan_templates` (
	`user_id` text PRIMARY KEY NOT NULL,
	`expected_income_cents` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
ALTER TABLE `transactions` ADD `transaction_type` text;--> statement-breakpoint
UPDATE `transactions` SET `transaction_type` = json_extract(`raw_json`, '$.attributes.transactionType') WHERE `transaction_type` IS NULL;