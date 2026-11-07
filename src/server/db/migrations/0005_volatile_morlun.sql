CREATE TABLE `flow_layouts` (
	`user_id` text NOT NULL,
	`key` text NOT NULL,
	`positions_json` text NOT NULL,
	`updated_at` text NOT NULL,
	PRIMARY KEY(`user_id`, `key`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
