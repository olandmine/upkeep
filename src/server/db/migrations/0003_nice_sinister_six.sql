CREATE TABLE `period_line_categories` (
	`budget_id` text NOT NULL,
	`period_start` text NOT NULL,
	`line_id` text NOT NULL,
	`category_id` text NOT NULL,
	PRIMARY KEY(`budget_id`, `period_start`, `line_id`, `category_id`),
	FOREIGN KEY (`budget_id`,`period_start`,`line_id`) REFERENCES `period_lines`(`budget_id`,`period_start`,`line_id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `period_line_categories` (`budget_id`, `period_start`, `line_id`, `category_id`) SELECT pl.`budget_id`, pl.`period_start`, pl.`line_id`, blc.`category_id` FROM `period_lines` pl JOIN `budget_line_categories` blc ON blc.`line_id` = pl.`line_id`;