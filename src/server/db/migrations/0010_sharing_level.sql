ALTER TABLE `users` ADD `sharing_level` text;
--> statement-breakpoint
UPDATE `users` SET `sharing_level` = 'full' WHERE `id` IN (SELECT `user_id` FROM `up_connections`);
