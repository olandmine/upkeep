CREATE TABLE `debt_repayment_rule_people` (
	`rule_id` text NOT NULL,
	`user_id` text NOT NULL,
	PRIMARY KEY(`rule_id`, `user_id`),
	FOREIGN KEY (`rule_id`) REFERENCES `debt_repayment_rules`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `debt_repayment_rule_people` (`rule_id`, `user_id`)
SELECT r.`id`, c.`user_id` FROM `debt_repayment_rules` r
JOIN `debts` d ON d.`id` = r.`debt_id` AND d.`owner_user_id` IS NULL
CROSS JOIN `up_connections` c;
