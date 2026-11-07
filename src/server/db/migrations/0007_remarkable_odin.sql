CREATE TABLE `debt_entries` (
	`id` text PRIMARY KEY NOT NULL,
	`debt_id` text NOT NULL,
	`kind` text NOT NULL,
	`date` text NOT NULL,
	`amount_cents` integer NOT NULL,
	`note` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`debt_id`) REFERENCES `debts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `debt_entries_debt_date_idx` ON `debt_entries` (`debt_id`,`date`);--> statement-breakpoint
CREATE TABLE `debt_interest_edits` (
	`debt_id` text NOT NULL,
	`charge_date` text NOT NULL,
	`amount_cents` integer NOT NULL,
	PRIMARY KEY(`debt_id`, `charge_date`),
	FOREIGN KEY (`debt_id`) REFERENCES `debts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `debt_rates` (
	`id` text PRIMARY KEY NOT NULL,
	`debt_id` text NOT NULL,
	`from_date` text NOT NULL,
	`rate_bp` integer NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`debt_id`) REFERENCES `debts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `debt_rates_debt_from_idx` ON `debt_rates` (`debt_id`,`from_date`);--> statement-breakpoint
ALTER TABLE `debts` ADD `interest_calc` text DEFAULT 'on_charge' NOT NULL;--> statement-breakpoint
ALTER TABLE `debts` ADD `interest_charge` text DEFAULT 'monthly' NOT NULL;--> statement-breakpoint
ALTER TABLE `debts` ADD `interest_charge_day` integer;--> statement-breakpoint
ALTER TABLE `debts` ADD `interest_charge_date` text;--> statement-breakpoint
UPDATE `debts` SET `interest_calc` = 'daily', `interest_charge` = 'monthly', `interest_charge_day` = 1 WHERE `kind` = 'ato';--> statement-breakpoint
UPDATE `debts` SET `interest_calc` = 'on_charge', `interest_charge` = 'yearly', `interest_charge_date` = '06-01' WHERE `kind` = 'hecs';--> statement-breakpoint
UPDATE `debts` SET `interest_calc` = 'on_charge', `interest_charge` = 'monthly', `interest_charge_day` = 1 WHERE `kind` = 'bnpl';--> statement-breakpoint
UPDATE `debts` SET `interest_calc` = 'on_charge', `interest_charge` = 'monthly', `interest_charge_day` = CAST(substr((SELECT min(`as_of`) FROM `debt_balances` WHERE `debt_id` = `debts`.`id`), 9, 2) AS INTEGER) WHERE `kind` IN ('loan', 'credit_card');--> statement-breakpoint
INSERT INTO `debt_rates` (`id`, `debt_id`, `from_date`, `rate_bp`, `created_at`) SELECT lower(hex(randomblob(16))), `id`, (SELECT min(`as_of`) FROM `debt_balances` WHERE `debt_id` = `debts`.`id`), `rate_bp`, `created_at` FROM `debts`;--> statement-breakpoint
ALTER TABLE `debts` DROP COLUMN `rate_bp`;