import { pgTable, text, integer, timestamp, jsonb, primaryKey } from 'drizzle-orm/pg-core';
export const workspaceRecords=pgTable('workspace_records',{
  workspaceId:text('workspace_id').notNull(),kind:text('kind').notNull(),id:text('id').notNull(),data:jsonb('data').notNull(),
},table=>[primaryKey({name:'workspace_records_pkey',columns:[table.workspaceId,table.kind,table.id]})]);
export const searchLease=pgTable('search_lease',{
  workspaceId:text('workspace_id').notNull(),id:integer('id').notNull(),owner:text('owner'),expiresAt:timestamp('expires_at',{withTimezone:true}).notNull(),
},table=>[primaryKey({name:'search_lease_pkey',columns:[table.workspaceId,table.id]})]);
export const workspaceAccounts=pgTable('workspace_accounts',{
 id:text('id').primaryKey(),googleSub:text('google_sub').notNull().unique(),email:text('email').notNull(),name:text('name').notNull(),workspaceId:text('workspace_id').notNull().unique(),createdAt:timestamp('created_at',{withTimezone:true}).notNull().defaultNow(),
});
export const oauthStates=pgTable('oauth_states',{id:text('id').primaryKey(),data:jsonb('data').notNull()});
export const appMetadata=pgTable('app_metadata',{id:text('id').primaryKey(),data:jsonb('data').notNull()});
