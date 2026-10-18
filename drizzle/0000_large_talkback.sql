CREATE TABLE `branches` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`address` text,
	`tax_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `accounts` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`provider_id` text NOT NULL,
	`user_id` text NOT NULL,
	`access_token` text,
	`refresh_token` text,
	`id_token` text,
	`access_token_expires_at` integer,
	`refresh_token_expires_at` integer,
	`scope` text,
	`password` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `accounts_user_idx` ON `accounts` (`user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `accounts_provider_account_uq` ON `accounts` (`provider_id`,`account_id`);--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`token` text NOT NULL,
	`user_id` text NOT NULL,
	`expires_at` integer NOT NULL,
	`ip_address` text,
	`user_agent` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sessions_token_unique` ON `sessions` (`token`);--> statement-breakpoint
CREATE INDEX `sessions_user_idx` ON `sessions` (`user_id`);--> statement-breakpoint
CREATE INDEX `sessions_expires_idx` ON `sessions` (`expires_at`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`email` text NOT NULL,
	`email_verified` integer DEFAULT false NOT NULL,
	`image` text,
	`role` text DEFAULT 'cashier' NOT NULL,
	`branch_id` text,
	`pin_hash` text,
	`active` integer DEFAULT true NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "users_role_check" CHECK("users"."role" in ('owner', 'manager', 'pharmacist', 'cashier', 'auditor'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_unique` ON `users` (`email`);--> statement-breakpoint
CREATE INDEX `users_branch_idx` ON `users` (`branch_id`);--> statement-breakpoint
CREATE INDEX `users_role_idx` ON `users` (`role`);--> statement-breakpoint
CREATE TABLE `verifications` (
	`id` text PRIMARY KEY NOT NULL,
	`identifier` text NOT NULL,
	`value` text NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `verifications_identifier_idx` ON `verifications` (`identifier`);--> statement-breakpoint
CREATE TABLE `categories` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `categories_name_unique` ON `categories` (`name`);--> statement-breakpoint
CREATE TABLE `product_barcodes` (
	`id` text PRIMARY KEY NOT NULL,
	`barcode` text NOT NULL,
	`product_id` text NOT NULL,
	`unit_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`unit_id`) REFERENCES `product_units`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `product_barcodes_barcode_unique` ON `product_barcodes` (`barcode`);--> statement-breakpoint
CREATE INDEX `product_barcodes_product_idx` ON `product_barcodes` (`product_id`);--> statement-breakpoint
CREATE TABLE `product_prices` (
	`id` text PRIMARY KEY NOT NULL,
	`product_id` text NOT NULL,
	`unit_id` text NOT NULL,
	`price` integer NOT NULL,
	`effective_from` integer NOT NULL,
	`effective_to` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`unit_id`) REFERENCES `product_units`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "product_prices_price_check" CHECK("product_prices"."price" >= 0)
);
--> statement-breakpoint
CREATE INDEX `product_prices_lookup_idx` ON `product_prices` (`product_id`,`unit_id`,`effective_from`);--> statement-breakpoint
CREATE TABLE `product_units` (
	`id` text PRIMARY KEY NOT NULL,
	`product_id` text NOT NULL,
	`name` text NOT NULL,
	`factor_to_base` integer NOT NULL,
	`is_default_sale` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "product_units_factor_to_base_check" CHECK("product_units"."factor_to_base" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `product_units_product_name_uq` ON `product_units` (`product_id`,`name`);--> statement-breakpoint
CREATE INDEX `product_units_product_idx` ON `product_units` (`product_id`);--> statement-breakpoint
CREATE TABLE `products` (
	`id` text PRIMARY KEY NOT NULL,
	`sku` text NOT NULL,
	`name` text NOT NULL,
	`generic_name` text,
	`strength` text,
	`form` text,
	`manufacturer` text,
	`category_id` text,
	`base_unit` text NOT NULL,
	`tax_class_id` text,
	`requires_rx` integer DEFAULT false NOT NULL,
	`controlled_schedule` text,
	`cold_chain` integer DEFAULT false NOT NULL,
	`sellable_loose` integer DEFAULT true NOT NULL,
	`storage_notes` text,
	`reorder_level` integer DEFAULT 0 NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`tax_class_id`) REFERENCES `tax_classes`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "products_reorder_level_check" CHECK("products"."reorder_level" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `products_sku_unique` ON `products` (`sku`);--> statement-breakpoint
CREATE INDEX `products_name_idx` ON `products` (`name`);--> statement-breakpoint
CREATE INDEX `products_generic_name_idx` ON `products` (`generic_name`);--> statement-breakpoint
CREATE INDEX `products_category_idx` ON `products` (`category_id`);--> statement-breakpoint
CREATE TABLE `tax_classes` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`rate_bp` integer NOT NULL,
	`price_includes_tax` integer DEFAULT true NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT "tax_classes_rate_bp_check" CHECK("tax_classes"."rate_bp" >= 0 and "tax_classes"."rate_bp" <= 10000)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `tax_classes_name_unique` ON `tax_classes` (`name`);--> statement-breakpoint
CREATE TABLE `po_lines` (
	`id` text PRIMARY KEY NOT NULL,
	`po_id` text NOT NULL,
	`product_id` text NOT NULL,
	`qty_ordered` integer NOT NULL,
	`qty_received` integer DEFAULT 0 NOT NULL,
	`unit_cost` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`po_id`) REFERENCES `purchase_orders`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "po_lines_qty_ordered_check" CHECK("po_lines"."qty_ordered" > 0),
	CONSTRAINT "po_lines_qty_received_check" CHECK("po_lines"."qty_received" >= 0),
	CONSTRAINT "po_lines_unit_cost_check" CHECK("po_lines"."unit_cost" >= 0)
);
--> statement-breakpoint
CREATE INDEX `po_lines_po_idx` ON `po_lines` (`po_id`);--> statement-breakpoint
CREATE INDEX `po_lines_product_idx` ON `po_lines` (`product_id`);--> statement-breakpoint
CREATE TABLE `purchase_orders` (
	`id` text PRIMARY KEY NOT NULL,
	`branch_id` text NOT NULL,
	`supplier_id` text NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`expected_date` text,
	`notes` text,
	`created_by` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`supplier_id`) REFERENCES `suppliers`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "purchase_orders_status_check" CHECK("purchase_orders"."status" in ('draft', 'sent', 'partially_received', 'received', 'cancelled'))
);
--> statement-breakpoint
CREATE INDEX `purchase_orders_branch_idx` ON `purchase_orders` (`branch_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `purchase_orders_supplier_status_idx` ON `purchase_orders` (`supplier_id`,`status`);--> statement-breakpoint
CREATE TABLE `supplier_invoices` (
	`id` text PRIMARY KEY NOT NULL,
	`supplier_id` text NOT NULL,
	`po_id` text,
	`number` text NOT NULL,
	`amount` integer NOT NULL,
	`due_date` text,
	`paid_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`supplier_id`) REFERENCES `suppliers`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`po_id`) REFERENCES `purchase_orders`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "supplier_invoices_amount_check" CHECK("supplier_invoices"."amount" >= 0)
);
--> statement-breakpoint
CREATE INDEX `supplier_invoices_supplier_idx` ON `supplier_invoices` (`supplier_id`,`due_date`);--> statement-breakpoint
CREATE INDEX `supplier_invoices_paid_idx` ON `supplier_invoices` (`paid_at`);--> statement-breakpoint
CREATE TABLE `suppliers` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`contact` text,
	`terms_days` integer,
	`lead_time_days` integer,
	`active` integer DEFAULT true NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT "suppliers_terms_days_check" CHECK("suppliers"."terms_days" is null or "suppliers"."terms_days" >= 0),
	CONSTRAINT "suppliers_lead_time_days_check" CHECK("suppliers"."lead_time_days" is null or "suppliers"."lead_time_days" >= 0)
);
--> statement-breakpoint
CREATE INDEX `suppliers_name_idx` ON `suppliers` (`name`);--> statement-breakpoint
CREATE TABLE `batches` (
	`id` text PRIMARY KEY NOT NULL,
	`product_id` text NOT NULL,
	`branch_id` text NOT NULL,
	`batch_no` text NOT NULL,
	`expiry_date` text NOT NULL,
	`cost_per_base_unit` integer NOT NULL,
	`qty_received` integer NOT NULL,
	`qty_remaining` integer NOT NULL,
	`supplier_id` text,
	`received_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`supplier_id`) REFERENCES `suppliers`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "batches_qty_remaining_nonnegative" CHECK("batches"."qty_remaining" >= 0),
	CONSTRAINT "batches_qty_received_nonnegative" CHECK("batches"."qty_received" >= 0),
	CONSTRAINT "batches_cost_per_base_unit_check" CHECK("batches"."cost_per_base_unit" >= 0)
);
--> statement-breakpoint
CREATE INDEX `batches_fefo_idx` ON `batches` (`product_id`,`branch_id`,`expiry_date`) WHERE "batches"."qty_remaining" > 0;--> statement-breakpoint
CREATE INDEX `batches_expiry_idx` ON `batches` (`branch_id`,`expiry_date`);--> statement-breakpoint
CREATE INDEX `batches_supplier_idx` ON `batches` (`supplier_id`);--> statement-breakpoint
CREATE TABLE `stock_movements` (
	`id` text PRIMARY KEY NOT NULL,
	`batch_id` text NOT NULL,
	`type` text NOT NULL,
	`qty_delta` integer NOT NULL,
	`ref_type` text,
	`ref_id` text,
	`reason` text,
	`user_id` text,
	`at` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`batch_id`) REFERENCES `batches`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "stock_movements_type_check" CHECK("stock_movements"."type" in ('receipt', 'sale', 'return', 'adjust', 'transfer', 'writeoff'))
);
--> statement-breakpoint
CREATE INDEX `stock_movements_batch_at_idx` ON `stock_movements` (`batch_id`,`at`);--> statement-breakpoint
CREATE INDEX `stock_movements_ref_idx` ON `stock_movements` (`ref_type`,`ref_id`);--> statement-breakpoint
CREATE TABLE `controlled_register` (
	`id` text PRIMARY KEY NOT NULL,
	`product_id` text NOT NULL,
	`batch_id` text NOT NULL,
	`movement_id` text NOT NULL,
	`balance_after` integer NOT NULL,
	`pharmacist_id` text,
	`prescription_id` text,
	`patient_name` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`batch_id`) REFERENCES `batches`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`movement_id`) REFERENCES `stock_movements`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`pharmacist_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`prescription_id`) REFERENCES `prescriptions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `controlled_register_product_idx` ON `controlled_register` (`product_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `controlled_register_movement_idx` ON `controlled_register` (`movement_id`);--> statement-breakpoint
CREATE TABLE `customers` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`phone` text,
	`dob` text,
	`allergies` text,
	`notes` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `customers_name_idx` ON `customers` (`name`);--> statement-breakpoint
CREATE INDEX `customers_phone_idx` ON `customers` (`phone`);--> statement-breakpoint
CREATE TABLE `prescription_items` (
	`id` text PRIMARY KEY NOT NULL,
	`prescription_id` text NOT NULL,
	`product_id` text NOT NULL,
	`qty_prescribed` integer NOT NULL,
	`qty_dispensed` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`prescription_id`) REFERENCES `prescriptions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "prescription_items_qty_prescribed_check" CHECK("prescription_items"."qty_prescribed" > 0),
	CONSTRAINT "prescription_items_qty_dispensed_check" CHECK("prescription_items"."qty_dispensed" >= 0)
);
--> statement-breakpoint
CREATE INDEX `prescription_items_prescription_idx` ON `prescription_items` (`prescription_id`);--> statement-breakpoint
CREATE INDEX `prescription_items_product_idx` ON `prescription_items` (`product_id`);--> statement-breakpoint
CREATE TABLE `prescriptions` (
	`id` text PRIMARY KEY NOT NULL,
	`customer_id` text,
	`patient_name` text NOT NULL,
	`patient_age` integer,
	`prescriber_name` text,
	`prescriber_license` text,
	`issued_on` text,
	`image_url` text,
	`notes` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "prescriptions_patient_age_check" CHECK("prescriptions"."patient_age" is null or ("prescriptions"."patient_age" >= 0 and "prescriptions"."patient_age" <= 130))
);
--> statement-breakpoint
CREATE INDEX `prescriptions_customer_idx` ON `prescriptions` (`customer_id`);--> statement-breakpoint
CREATE INDEX `prescriptions_issued_idx` ON `prescriptions` (`issued_on`);--> statement-breakpoint
CREATE TABLE `payments` (
	`id` text PRIMARY KEY NOT NULL,
	`sale_id` text NOT NULL,
	`method` text NOT NULL,
	`amount` integer NOT NULL,
	`reference` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`sale_id`) REFERENCES `sales`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "payments_method_check" CHECK("payments"."method" in ('cash', 'card', 'ewallet')),
	CONSTRAINT "payments_amount_check" CHECK("payments"."amount" >= 0)
);
--> statement-breakpoint
CREATE INDEX `payments_sale_idx` ON `payments` (`sale_id`);--> statement-breakpoint
CREATE TABLE `receipt_counters` (
	`branch_id` text PRIMARY KEY NOT NULL,
	`next_no` integer DEFAULT 1 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "receipt_counters_next_no_check" CHECK("receipt_counters"."next_no" >= 1)
);
--> statement-breakpoint
CREATE TABLE `refund_lines` (
	`id` text PRIMARY KEY NOT NULL,
	`refund_id` text NOT NULL,
	`sale_line_id` text NOT NULL,
	`product_id` text NOT NULL,
	`batch_id` text NOT NULL,
	`unit_id` text NOT NULL,
	`qty_base` integer NOT NULL,
	`unit_price` integer NOT NULL,
	`discount` integer DEFAULT 0 NOT NULL,
	`tax_rate` integer DEFAULT 0 NOT NULL,
	`tax_amount` integer DEFAULT 0 NOT NULL,
	`line_total` integer NOT NULL,
	`restocked` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`refund_id`) REFERENCES `refunds`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`sale_line_id`) REFERENCES `sale_lines`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`batch_id`) REFERENCES `batches`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`unit_id`) REFERENCES `product_units`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "refund_lines_qty_base_check" CHECK("refund_lines"."qty_base" > 0)
);
--> statement-breakpoint
CREATE INDEX `refund_lines_refund_idx` ON `refund_lines` (`refund_id`);--> statement-breakpoint
CREATE INDEX `refund_lines_sale_line_idx` ON `refund_lines` (`sale_line_id`);--> statement-breakpoint
CREATE TABLE `refunds` (
	`id` text PRIMARY KEY NOT NULL,
	`sale_id` text NOT NULL,
	`approved_by` text,
	`reason` text,
	`total` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`sale_id`) REFERENCES `sales`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`approved_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "refunds_total_check" CHECK("refunds"."total" >= 0)
);
--> statement-breakpoint
CREATE INDEX `refunds_sale_idx` ON `refunds` (`sale_id`);--> statement-breakpoint
CREATE TABLE `sale_discounts` (
	`id` text PRIMARY KEY NOT NULL,
	`sale_id` text NOT NULL,
	`type` text NOT NULL,
	`id_reference` text,
	`amount` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`sale_id`) REFERENCES `sales`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "sale_discounts_amount_check" CHECK("sale_discounts"."amount" >= 0)
);
--> statement-breakpoint
CREATE INDEX `sale_discounts_sale_idx` ON `sale_discounts` (`sale_id`);--> statement-breakpoint
CREATE TABLE `sale_lines` (
	`id` text PRIMARY KEY NOT NULL,
	`sale_id` text NOT NULL,
	`product_id` text NOT NULL,
	`batch_id` text NOT NULL,
	`unit_id` text NOT NULL,
	`qty_base` integer NOT NULL,
	`unit_price` integer NOT NULL,
	`discount` integer DEFAULT 0 NOT NULL,
	`tax_rate` integer DEFAULT 0 NOT NULL,
	`tax_amount` integer DEFAULT 0 NOT NULL,
	`line_total` integer NOT NULL,
	`prescription_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`sale_id`) REFERENCES `sales`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`batch_id`) REFERENCES `batches`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`unit_id`) REFERENCES `product_units`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`prescription_id`) REFERENCES `prescriptions`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "sale_lines_qty_base_check" CHECK("sale_lines"."qty_base" > 0),
	CONSTRAINT "sale_lines_unit_price_check" CHECK("sale_lines"."unit_price" >= 0),
	CONSTRAINT "sale_lines_discount_check" CHECK("sale_lines"."discount" >= 0)
);
--> statement-breakpoint
CREATE INDEX `sale_lines_sale_idx` ON `sale_lines` (`sale_id`);--> statement-breakpoint
CREATE INDEX `sale_lines_product_idx` ON `sale_lines` (`product_id`);--> statement-breakpoint
CREATE INDEX `sale_lines_batch_idx` ON `sale_lines` (`batch_id`);--> statement-breakpoint
CREATE TABLE `sales` (
	`id` text PRIMARY KEY NOT NULL,
	`receipt_no` integer NOT NULL,
	`branch_id` text NOT NULL,
	`shift_id` text,
	`cashier_id` text NOT NULL,
	`customer_id` text,
	`status` text DEFAULT 'completed' NOT NULL,
	`idempotency_key` text NOT NULL,
	`subtotal` integer NOT NULL,
	`discount_total` integer DEFAULT 0 NOT NULL,
	`tax_total` integer DEFAULT 0 NOT NULL,
	`total` integer NOT NULL,
	`rounding` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`shift_id`) REFERENCES `shifts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`cashier_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "sales_status_check" CHECK("sales"."status" in ('completed', 'voided', 'refunded', 'partially_refunded'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sales_idempotency_key_unique` ON `sales` (`idempotency_key`);--> statement-breakpoint
CREATE UNIQUE INDEX `sales_branch_receipt_uq` ON `sales` (`branch_id`,`receipt_no`);--> statement-breakpoint
CREATE INDEX `sales_branch_created_idx` ON `sales` (`branch_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `sales_customer_idx` ON `sales` (`customer_id`);--> statement-breakpoint
CREATE INDEX `sales_cashier_created_idx` ON `sales` (`cashier_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `shifts` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`branch_id` text NOT NULL,
	`opened_at` integer NOT NULL,
	`closed_at` integer,
	`opening_float` integer DEFAULT 0 NOT NULL,
	`expected_cash` integer,
	`counted_cash` integer,
	`variance` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `shifts_branch_opened_idx` ON `shifts` (`branch_id`,`opened_at`);--> statement-breakpoint
CREATE INDEX `shifts_user_opened_idx` ON `shifts` (`user_id`,`opened_at`);--> statement-breakpoint
CREATE TABLE `audit_log` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text,
	`action` text NOT NULL,
	`entity` text NOT NULL,
	`entity_id` text,
	`before` text,
	`after` text,
	`ip` text,
	`request_id` text,
	`at` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `audit_log_entity_idx` ON `audit_log` (`entity`,`entity_id`,`at`);--> statement-breakpoint
CREATE INDEX `audit_log_user_idx` ON `audit_log` (`user_id`,`at`);--> statement-breakpoint
CREATE TABLE `rate_limits` (
	`key` text PRIMARY KEY NOT NULL,
	`count` integer DEFAULT 0 NOT NULL,
	`window_start_ms` integer NOT NULL,
	`blocked_until_ms` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT "rate_limits_count_check" CHECK("rate_limits"."count" >= 0)
);
--> statement-breakpoint
CREATE TABLE `settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
-- ============================================================================
-- Hand-written additions (not expressible in the Drizzle schema DSL):
--   1) `products_fts`: FTS5 full-text index over products.name / generic_name /
--      sku for POS search (spec §5.2), kept in sync by triggers.
--   2) Append-only enforcement triggers for `stock_movements`,
--      `controlled_register` and `audit_log` (spec §5.3).
-- Never edit an applied migration; add a new one instead.
-- ============================================================================
CREATE VIRTUAL TABLE `products_fts` USING fts5(
	`name`,
	`generic_name`,
	`sku`,
	content = 'products',
	content_rowid = 'rowid',
	tokenize = "unicode61 remove_diacritics 2"
);
--> statement-breakpoint
CREATE TRIGGER `products_fts_ai` AFTER INSERT ON `products` BEGIN
	INSERT INTO `products_fts` (`rowid`, `name`, `generic_name`, `sku`)
	VALUES (new.`rowid`, new.`name`, new.`generic_name`, new.`sku`);
END;
--> statement-breakpoint
CREATE TRIGGER `products_fts_ad` AFTER DELETE ON `products` BEGIN
	INSERT INTO `products_fts` (`products_fts`, `rowid`, `name`, `generic_name`, `sku`)
	VALUES ('delete', old.`rowid`, old.`name`, old.`generic_name`, old.`sku`);
END;
--> statement-breakpoint
CREATE TRIGGER `products_fts_au` AFTER UPDATE ON `products` BEGIN
	INSERT INTO `products_fts` (`products_fts`, `rowid`, `name`, `generic_name`, `sku`)
	VALUES ('delete', old.`rowid`, old.`name`, old.`generic_name`, old.`sku`);
	INSERT INTO `products_fts` (`rowid`, `name`, `generic_name`, `sku`)
	VALUES (new.`rowid`, new.`name`, new.`generic_name`, new.`sku`);
END;
--> statement-breakpoint
CREATE TRIGGER `stock_movements_append_only_update` BEFORE UPDATE ON `stock_movements` BEGIN
	SELECT RAISE(ABORT, 'stock_movements is append-only');
END;
--> statement-breakpoint
CREATE TRIGGER `stock_movements_append_only_delete` BEFORE DELETE ON `stock_movements` BEGIN
	SELECT RAISE(ABORT, 'stock_movements is append-only');
END;
--> statement-breakpoint
CREATE TRIGGER `controlled_register_append_only_update` BEFORE UPDATE ON `controlled_register` BEGIN
	SELECT RAISE(ABORT, 'controlled_register is append-only');
END;
--> statement-breakpoint
CREATE TRIGGER `controlled_register_append_only_delete` BEFORE DELETE ON `controlled_register` BEGIN
	SELECT RAISE(ABORT, 'controlled_register is append-only');
END;
--> statement-breakpoint
CREATE TRIGGER `audit_log_append_only_update` BEFORE UPDATE ON `audit_log` BEGIN
	SELECT RAISE(ABORT, 'audit_log is append-only');
END;
--> statement-breakpoint
CREATE TRIGGER `audit_log_append_only_delete` BEFORE DELETE ON `audit_log` BEGIN
	SELECT RAISE(ABORT, 'audit_log is append-only');
END;

