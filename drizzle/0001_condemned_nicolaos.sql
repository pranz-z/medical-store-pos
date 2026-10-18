CREATE TABLE `approval_tokens` (
	`id` text PRIMARY KEY NOT NULL,
	`approver_id` text NOT NULL,
	`requester_id` text NOT NULL,
	`action` text NOT NULL,
	`payload_hash` text NOT NULL,
	`reason` text,
	`expires_at` integer NOT NULL,
	`used_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`approver_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`requester_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `approval_tokens_lookup_idx` ON `approval_tokens` (`action`,`requester_id`,`expires_at`);--> statement-breakpoint
CREATE INDEX `approval_tokens_approver_idx` ON `approval_tokens` (`approver_id`,`created_at`);--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_payments` (
	`id` text PRIMARY KEY NOT NULL,
	`sale_id` text NOT NULL,
	`method` text NOT NULL,
	`amount` integer NOT NULL,
	`tendered` integer,
	`change_given` integer DEFAULT 0 NOT NULL,
	`reference` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`sale_id`) REFERENCES `sales`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "payments_method_check" CHECK("__new_payments"."method" in ('cash', 'card', 'ewallet', 'other')),
	CONSTRAINT "payments_amount_check" CHECK("__new_payments"."amount" >= 0),
	CONSTRAINT "payments_change_given_check" CHECK("__new_payments"."change_given" >= 0)
);
--> statement-breakpoint
-- drizzle-kit emits a copy of every new column; only copy what existed before
-- (tendered stays NULL, change_given defaults to 0 on pre-M2 rows).
INSERT INTO `__new_payments`("id", "sale_id", "method", "amount", "reference", "created_at", "updated_at") SELECT "id", "sale_id", "method", "amount", "reference", "created_at", "updated_at" FROM `payments`;--> statement-breakpoint
DROP TABLE `payments`;--> statement-breakpoint
ALTER TABLE `__new_payments` RENAME TO `payments`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `payments_sale_idx` ON `payments` (`sale_id`);