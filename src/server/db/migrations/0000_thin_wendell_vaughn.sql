CREATE TABLE `account_connections` (
	`account_id` text NOT NULL,
	`connection_id` text NOT NULL,
	PRIMARY KEY(`account_id`, `connection_id`),
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`connection_id`) REFERENCES `up_connections`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `accounts` (
	`id` text PRIMARY KEY NOT NULL,
	`display_name` text NOT NULL,
	`account_type` text NOT NULL,
	`ownership` text NOT NULL,
	`owner_user_id` text,
	`balance_cents` integer NOT NULL,
	`currency` text NOT NULL,
	`color_index` integer NOT NULL,
	`hidden` integer DEFAULT false NOT NULL,
	`up_created_at` text NOT NULL,
	`raw_json` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`owner_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `categories` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`parent_id` text
);
--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`created_at` text NOT NULL,
	`last_seen_at` text NOT NULL,
	`expires_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `sync_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`connection_id` text NOT NULL,
	`kind` text NOT NULL,
	`status` text NOT NULL,
	`started_at` text NOT NULL,
	`finished_at` text,
	`transactions_upserted` integer DEFAULT 0 NOT NULL,
	`transactions_deleted` integer DEFAULT 0 NOT NULL,
	`error` text,
	FOREIGN KEY (`connection_id`) REFERENCES `up_connections`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `sync_runs_connection_started_idx` ON `sync_runs` (`connection_id`,`started_at`);--> statement-breakpoint
CREATE TABLE `tags` (
	`label` text PRIMARY KEY NOT NULL
);
--> statement-breakpoint
CREATE TABLE `transaction_tags` (
	`transaction_id` text NOT NULL,
	`label` text NOT NULL,
	PRIMARY KEY(`transaction_id`, `label`),
	FOREIGN KEY (`transaction_id`) REFERENCES `transactions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `transactions` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`status` text NOT NULL,
	`amount_cents` integer NOT NULL,
	`currency` text NOT NULL,
	`foreign_amount_cents` integer,
	`foreign_currency` text,
	`description` text NOT NULL,
	`message` text,
	`raw_text` text,
	`category_id` text,
	`parent_category_id` text,
	`is_categorizable` integer NOT NULL,
	`round_up_cents` integer,
	`cashback_cents` integer,
	`card_method` text,
	`card_suffix` text,
	`transfer_account_id` text,
	`is_transfer` integer NOT NULL,
	`performing_customer` text,
	`performed_by_user_id` text,
	`created_at` text NOT NULL,
	`settled_at` text,
	`deleted_at` text,
	`raw_json` text NOT NULL,
	`synced_at` text NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`performed_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `transactions_account_created_idx` ON `transactions` (`account_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `transactions_created_id_idx` ON `transactions` (`created_at`,`id`);--> statement-breakpoint
CREATE INDEX `transactions_category_idx` ON `transactions` (`category_id`);--> statement-breakpoint
CREATE INDEX `transactions_status_idx` ON `transactions` (`status`);--> statement-breakpoint
CREATE TABLE `up_connections` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`token_ciphertext` text NOT NULL,
	`status` text NOT NULL,
	`last_error` text,
	`last_synced_at` text,
	`backfill_completed_at` text,
	`last_reconciled_at` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `up_connections_user_id_unique` ON `up_connections` (`user_id`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`username` text NOT NULL,
	`display_name` text NOT NULL,
	`password_hash` text NOT NULL,
	`up_display_name` text,
	`negative_style` text DEFAULT 'minus' NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_username_unique` ON `users` (`username`);