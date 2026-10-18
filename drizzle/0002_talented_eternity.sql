CREATE TABLE `discount_types` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`percent_bp` integer NOT NULL,
	`tax_treatment` text DEFAULT 'standard' NOT NULL,
	`requires_id_reference` integer DEFAULT false NOT NULL,
	`requires_customer_name` integer DEFAULT false NOT NULL,
	`applies_to` text,
	`cap_minor` integer,
	`active` integer DEFAULT true NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT "discount_types_percent_bp_check" CHECK("discount_types"."percent_bp" >= 0 and "discount_types"."percent_bp" <= 10000),
	CONSTRAINT "discount_types_tax_treatment_check" CHECK("discount_types"."tax_treatment" in ('standard', 'vat_exempt'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `discount_types_name_unique` ON `discount_types` (`name`);--> statement-breakpoint
ALTER TABLE `products` ADD `resellable` integer DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `prescriptions` ADD `patient_dob` text;--> statement-breakpoint
ALTER TABLE `sale_discounts` ADD `discount_type_id` text REFERENCES discount_types(id);--> statement-breakpoint
ALTER TABLE `sale_discounts` ADD `customer_name` text;--> statement-breakpoint
CREATE INDEX `sale_discounts_type_idx` ON `sale_discounts` (`discount_type_id`);--> statement-breakpoint
ALTER TABLE `sales` ADD `request_hash` text;--> statement-breakpoint
-- Cold-chain products are not resellable by policy (FR-POS-9); new products
-- still default resellable=1.
UPDATE `products` SET `resellable` = 0 WHERE `cold_chain` = 1;