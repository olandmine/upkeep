CREATE TABLE `debt_repayment_links` (
	`transaction_id` text PRIMARY KEY NOT NULL,
	`debt_id` text NOT NULL,
	FOREIGN KEY (`debt_id`) REFERENCES `debts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `debt_repayment_rules` (
	`id` text PRIMARY KEY NOT NULL,
	`debt_id` text NOT NULL,
	`match` text NOT NULL,
	FOREIGN KEY (`debt_id`) REFERENCES `debts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `debt_repayment_rules_match_idx` ON `debt_repayment_rules` (`match`);--> statement-breakpoint
INSERT INTO `debt_repayment_rules` (`id`, `debt_id`, `match`) SELECT lower(hex(randomblob(16))), `id`, `repayment_match` FROM `debts` WHERE `repayment_match` IS NOT NULL;--> statement-breakpoint
DROP INDEX `debts_repayment_match_idx`;--> statement-breakpoint
ALTER TABLE `debts` DROP COLUMN `repayment_match`;