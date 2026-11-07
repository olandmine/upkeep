ALTER TABLE `users` ADD `connect_up_answered` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `users` ADD `up_handle_left_blank` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `users` ADD `given_password` text;--> statement-breakpoint
ALTER TABLE `users` ADD `getting_started_hidden` integer DEFAULT false NOT NULL;
--> statement-breakpoint
UPDATE `users` SET `connect_up_answered` = 1, `getting_started_hidden` = 1
WHERE `id` IN (SELECT `user_id` FROM `up_connections`);
