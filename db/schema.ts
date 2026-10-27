import { sqliteTable, text, integer, index } from 'drizzle-orm/sqlite-core';
export const challenges=sqliteTable('login_challenges',{
 id:text('id').primaryKey(),ownerId:text('owner_id').notNull(),browserHash:text('browser_hash').notNull(),callbackHash:text('callback_hash').notNull(),state:text('state').notNull(),createdAt:integer('created_at').notNull(),expiresAt:integer('expires_at').notNull(),employeeId:text('employee_id'),nickname:text('nickname')
},t=>[index('login_challenges_owner_created').on(t.ownerId,t.createdAt)]);
export const sessions=sqliteTable('login_sessions',{
 tokenHash:text('token_hash').primaryKey(),ownerId:text('owner_id').notNull(),employeeId:text('employee_id').notNull(),nickname:text('nickname').notNull(),expiresAt:integer('expires_at').notNull()
});
