CREATE TABLE `debt_balances` (
	`id` text PRIMARY KEY NOT NULL,
	`debt_id` text NOT NULL,
	`as_of` text NOT NULL,
	`balance_cents` integer NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`debt_id`) REFERENCES `debts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `debt_balances_debt_as_of_idx` ON `debt_balances` (`debt_id`,`as_of`);--> statement-breakpoint
CREATE TABLE `debt_repayment_exclusions` (
	`debt_id` text NOT NULL,
	`transaction_id` text NOT NULL,
	PRIMARY KEY(`debt_id`, `transaction_id`),
	FOREIGN KEY (`debt_id`) REFERENCES `debts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `debts` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_user_id` text,
	`kind` text NOT NULL,
	`name` text NOT NULL,
	`rate_bp` integer NOT NULL,
	`repayment_cents` integer NOT NULL,
	`repayment_frequency` text NOT NULL,
	`repayment_match` text,
	`created_by_user_id` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`owner_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `debts_repayment_match_idx` ON `debts` (`repayment_match`);--> statement-breakpoint
CREATE TABLE `goals` (
	`account_id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`target_cents` integer NOT NULL,
	`target_date` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `payoff_settings` (
	`scope` text PRIMARY KEY NOT NULL,
	`extra_cents` integer DEFAULT 0 NOT NULL,
	`include_hecs` integer DEFAULT false NOT NULL
);
