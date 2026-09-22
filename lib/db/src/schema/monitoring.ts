import { createInsertSchema } from "drizzle-zod";
import { integer, pgTable, real, serial, text, timestamp } from "drizzle-orm/pg-core";

export const watchlistTable = pgTable("watchlist", {
  address: text("address").primaryKey(),
  symbol: text("symbol").notNull(),
  name: text("name").notNull(),
  addedAt: timestamp("added_at", { withTimezone: true }).defaultNow().notNull(),
});

export const alertsTable = pgTable("alerts", {
  id: serial("id").primaryKey(),
  address: text("address").notNull(),
  symbol: text("symbol").notNull(),
  condition: text("condition").notNull(),
  threshold: real("threshold").notNull(),
  direction: text("direction").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const insertWatchlistSchema = createInsertSchema(watchlistTable);
export const insertAlertSchema = createInsertSchema(alertsTable).omit({ id: true, createdAt: true });

export type WatchlistItem = typeof watchlistTable.$inferSelect;
export type AlertRule = typeof alertsTable.$inferSelect;