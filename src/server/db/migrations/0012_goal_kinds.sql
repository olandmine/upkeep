ALTER TABLE `goals` ADD `kind` text DEFAULT 'save' NOT NULL;--> statement-breakpoint
ALTER TABLE `goals` ADD `debt_id` text REFERENCES debts(id);--> statement-breakpoint
ALTER TABLE `goals` ADD `start_cents` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `goals` ADD `started_at` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `goals` ADD `start_target_cents` integer;--> statement-breakpoint
ALTER TABLE `goals` ADD `followed_debt_name` text;--> statement-breakpoint
CREATE UNIQUE INDEX `goals_debt_idx` ON `goals` (`debt_id`);--> statement-breakpoint
UPDATE `goals` SET `started_at` = `created_at`,
  `start_cents` = COALESCE((SELECT `balance_cents` FROM `accounts` WHERE `id` = `goals`.`account_id`)
    - COALESCE((SELECT SUM(`amount_cents`) FROM `transactions` WHERE `account_id` = `goals`.`account_id`
        AND `deleted_at` IS NULL AND `created_at` >= `goals`.`created_at`), 0), 0);
