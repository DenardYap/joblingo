import { pgTable, text, integer, timestamp, jsonb, primaryKey, bigint, index } from 'drizzle-orm/pg-core';
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

// Shared counters are provider infrastructure, not workspace content.
export const exaBudgetAccounts=pgTable('exa_budget_accounts',{
 scope:text('scope').primaryKey(),day:text('day').notNull(),charged:bigint('charged',{mode:'number'}).notNull().default(0),held:bigint('held',{mode:'number'}).notNull().default(0),
});
export const exaBudgetReservations=pgTable('exa_budget_reservations',{
 id:text('id').primaryKey(),scope:text('scope').notNull().references(()=>exaBudgetAccounts.scope),workspaceId:text('workspace_id').notNull(),day:text('day').notNull(),maximum:bigint('maximum',{mode:'number'}).notNull(),charged:bigint('charged',{mode:'number'}),remoteId:text('remote_id'),state:text('state').notNull().default('reserved'),createdAt:timestamp('created_at',{withTimezone:true}).notNull().defaultNow(),
},table=>[index('exa_budget_remote').on(table.workspaceId,table.remoteId)]);
