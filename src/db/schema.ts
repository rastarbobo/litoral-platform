import { sqliteTable, integer, text, index, unique, real } from "drizzle-orm/sqlite-core";
import { relations, sql } from "drizzle-orm";
import { type InferSelectModel } from "drizzle-orm";

import { createId } from '@paralleldrive/cuid2'
import { CMS_ENTRY_STATUS, ROLES_ENUM } from "@/app/enums";
import type { JSONContent } from "@tiptap/core"
import { cmsNavigationKeys, type CmsNavigationKey } from "@/../cms.config";
import { cmsEntryStatusTuple, type CmsEntryStatus } from "@/types/cms";
import {
  cmsNavigationNodeTypeTuple,
  type CmsNavigationNodeType,
} from "@/types/cms-navigation";
import type { ScheduledJobPayload, ScheduledJobType } from "@/lib/scheduler/jobs";
import type { CollectionsUnion } from "../../cms.config";

const roleTuple = Object.values(ROLES_ENUM) as [string, ...string[]];

const commonColumns = {
  createdAt: integer({
    mode: "timestamp",
  }).$defaultFn(() => new Date()).notNull(),
  updatedAt: integer({
    mode: "timestamp",
  }).$onUpdateFn(() => new Date()).notNull(),
  updateCounter: integer().default(0).$onUpdate(() => sql`updateCounter + 1`),
}

export const userTable = sqliteTable("user", {
  ...commonColumns,
  id: text().primaryKey().$defaultFn(() => `usr_${createId()}`).notNull(),
  firstName: text({
    length: 255,
  }),
  lastName: text({
    length: 255,
  }),
  email: text({
    length: 255,
  }).unique(),
  passwordHash: text(),
  role: text({
    enum: roleTuple,
  }).default(ROLES_ENUM.USER).notNull(),
  emailVerified: integer({
    mode: "timestamp",
  }),
  signUpIpAddress: text({
    length: 100,
  }),
  googleAccountId: text({
    length: 255,
  }),
  /**
   * This can either be an absolute or relative path to an image
   */
  avatar: text({
    length: 600,
  }),
  // Credit system fields
  currentCredits: integer().default(0).notNull(),
  lastCreditRefreshAt: integer({
    mode: "timestamp",
  }),
}, (table) => ([
  index('email_idx').on(table.email),
  index('google_account_id_idx').on(table.googleAccountId),
  index('role_idx').on(table.role),
]));

export const passKeyCredentialTable = sqliteTable("passkey_credential", {
  ...commonColumns,
  id: text().primaryKey().$defaultFn(() => `pkey_${createId()}`).notNull(),
  userId: text().notNull().references(() => userTable.id),
  credentialId: text({
    length: 255,
  }).notNull().unique(),
  credentialPublicKey: text({
    length: 255,
  }).notNull(),
  counter: integer().notNull(),
  // Optional array of AuthenticatorTransport as JSON string
  transports: text({
    length: 255,
  }),
  // Authenticator Attestation GUID. We use this to identify the device/authenticator app that created the passkey
  aaguid: text({
    length: 255,
  }),
  // The user agent of the device that created the passkey
  userAgent: text({
    length: 255,
  }),
  // The IP address that created the passkey
  ipAddress: text({
    length: 100,
  }),
}, (table) => ([
  index('user_id_idx').on(table.userId),
  index('credential_id_idx').on(table.credentialId),
]));

// Credit transaction types
export const CREDIT_TRANSACTION_TYPE = {
  PURCHASE: 'PURCHASE',
  USAGE: 'USAGE',
  MONTHLY_REFRESH: 'MONTHLY_REFRESH',
} as const;

export const creditTransactionTypeTuple = Object.values(CREDIT_TRANSACTION_TYPE) as [string, ...string[]];

export const creditTransactionTable = sqliteTable("credit_transaction", {
  ...commonColumns,
  id: text().primaryKey().$defaultFn(() => `ctxn_${createId()}`).notNull(),
  userId: text().notNull().references(() => userTable.id),
  amount: integer().notNull(),
  // Track how many credits are still available from this transaction
  remainingAmount: integer().default(0).notNull(),
  type: text({
    enum: creditTransactionTypeTuple,
  }).notNull(),
  description: text({
    length: 255,
  }).notNull(),
  expirationDate: integer({
    mode: "timestamp",
  }),
  expirationDateProcessedAt: integer({
    mode: "timestamp",
  }),
  dedupeKey: text({
    length: 255,
  }),
  paymentIntentId: text({
    length: 255,
  }),
}, (table) => ([
  index('credit_transaction_user_id_idx').on(table.userId),
  index('credit_transaction_type_idx').on(table.type),
  index('credit_transaction_created_at_idx').on(table.createdAt),
  index('credit_transaction_expiration_date_idx').on(table.expirationDate),
  unique('credit_transaction_dedupe_key_unique').on(table.dedupeKey),
  index('credit_transaction_payment_intent_id_idx').on(table.paymentIntentId),
]));

// Define item types that can be purchased
export const PURCHASABLE_ITEM_TYPE = {
  COMPONENT: 'COMPONENT',
  // Add more types in the future (e.g., TEMPLATE, PLUGIN, etc.)
} as const;

export const purchasableItemTypeTuple = Object.values(PURCHASABLE_ITEM_TYPE) as [string, ...string[]];

export const purchasedItemsTable = sqliteTable("purchased_item", {
  ...commonColumns,
  id: text().primaryKey().$defaultFn(() => `pitem_${createId()}`).notNull(),
  userId: text().notNull().references(() => userTable.id),
  // The type of item (e.g., COMPONENT, TEMPLATE, etc.)
  itemType: text({
    enum: purchasableItemTypeTuple,
  }).notNull(),
  // The ID of the item within its type (e.g., componentId)
  itemId: text().notNull(),
  purchasedAt: integer({
    mode: "timestamp",
  }).$defaultFn(() => new Date()).notNull(),
}, (table) => ([
  index('purchased_item_user_id_idx').on(table.userId),
  index('purchased_item_type_idx').on(table.itemType),
  // Composite index for checking if a user owns a specific item of a specific type
  index('purchased_item_user_item_idx').on(table.userId, table.itemType, table.itemId),
]));

// System-defined roles - these are always available
export const SYSTEM_ROLES_ENUM = {
  OWNER: 'owner',
  ADMIN: 'admin',
  MEMBER: 'member',
  GUEST: 'guest',
} as const;

export const systemRoleTuple = Object.values(SYSTEM_ROLES_ENUM) as [string, ...string[]];

// Define available permissions
export const TEAM_PERMISSIONS = {
  // Resource access
  ACCESS_DASHBOARD: 'access_dashboard',
  ACCESS_BILLING: 'access_billing',

  // User management
  INVITE_MEMBERS: 'invite_members',
  REMOVE_MEMBERS: 'remove_members',
  CHANGE_MEMBER_ROLES: 'change_member_roles',

  // Team management
  EDIT_TEAM_SETTINGS: 'edit_team_settings',
  DELETE_TEAM: 'delete_team',

  // Role management
  CREATE_ROLES: 'create_roles',
  EDIT_ROLES: 'edit_roles',
  DELETE_ROLES: 'delete_roles',
  ASSIGN_ROLES: 'assign_roles',

  // Content permissions
  CREATE_COMPONENTS: 'create_components',
  EDIT_COMPONENTS: 'edit_components',
  DELETE_COMPONENTS: 'delete_components',

  // Add more as needed
} as const;

// Team table
export const teamTable = sqliteTable("team", {
  ...commonColumns,
  id: text().primaryKey().$defaultFn(() => `team_${createId()}`).notNull(),
  name: text({ length: 255 }).notNull(),
  slug: text({ length: 255 }).notNull().unique(),
  description: text({ length: 1000 }),
  avatarUrl: text({ length: 600 }),
  settings: text({ length: 10000 }),
  billingEmail: text({ length: 255 }),
  planId: text({ length: 100 }),
  planExpiresAt: integer({ mode: "timestamp" }),
  creditBalance: integer().default(0).notNull(),
}, (table) => ([
  index('team_slug_idx').on(table.slug),
]));

// Team membership table
export const teamMembershipTable = sqliteTable("team_membership", {
  ...commonColumns,
  id: text().primaryKey().$defaultFn(() => `tmem_${createId()}`).notNull(),
  teamId: text().notNull().references(() => teamTable.id),
  userId: text().notNull().references(() => userTable.id),
  roleId: text().notNull(),
  isSystemRole: integer().default(1).notNull(),
  invitedBy: text().references(() => userTable.id),
  invitedAt: integer({ mode: "timestamp" }),
  joinedAt: integer({ mode: "timestamp" }),
  expiresAt: integer({ mode: "timestamp" }),
  isActive: integer().default(1).notNull(),
}, (table) => ([
  index('team_membership_team_id_idx').on(table.teamId),
  index('team_membership_user_id_idx').on(table.userId),
  // Instead of unique() which causes linter errors, we'll create a unique constraint on columns
  index('team_membership_unique_idx').on(table.teamId, table.userId),
]));

// Team role table
export const teamRoleTable = sqliteTable("team_role", {
  ...commonColumns,
  id: text().primaryKey().$defaultFn(() => `trole_${createId()}`).notNull(),
  teamId: text().notNull().references(() => teamTable.id),
  name: text({ length: 255 }).notNull(),
  description: text({ length: 1000 }),
  permissions: text({ mode: 'json' }).notNull().$type<string[]>(),
  metadata: text({ length: 5000 }),
  isEditable: integer().default(1).notNull(),
}, (table) => ([
  index('team_role_team_id_idx').on(table.teamId),
  // Instead of unique() which causes linter errors, we'll create a unique constraint on columns
  index('team_role_name_unique_idx').on(table.teamId, table.name),
]));

// Team invitation table
export const teamInvitationTable = sqliteTable("team_invitation", {
  ...commonColumns,
  id: text().primaryKey().$defaultFn(() => `tinv_${createId()}`).notNull(),
  teamId: text().notNull().references(() => teamTable.id),
  email: text({ length: 255 }).notNull(),
  roleId: text().notNull(),
  isSystemRole: integer().default(1).notNull(),
  token: text({ length: 255 }).notNull().unique(),
  invitedBy: text().notNull().references(() => userTable.id),
  expiresAt: integer({ mode: "timestamp" }).notNull(),
  acceptedAt: integer({ mode: "timestamp" }),
  acceptedBy: text().references(() => userTable.id),
}, (table) => ([
  index('team_invitation_team_id_idx').on(table.teamId),
  index('team_invitation_email_idx').on(table.email),
  index('team_invitation_token_idx').on(table.token),
]));

export const cmsMediaTable = sqliteTable("cms_media", {
  ...commonColumns,
  id: text().primaryKey().$defaultFn(() => `cms_mda_${createId()}`).notNull(),
  fileName: text().notNull(),
  mimeType: text().notNull(),
  sizeInBytes: integer().notNull(),
  bucketKey: text().notNull().unique(),
  width: integer(),
  height: integer(),
  alt: text(),
  uploadedBy: text().notNull().references(() => userTable.id),
}, (table) => ([
  // Index for filtering by mime type (e.g., get all images, videos, etc.)
  index('cms_media_mime_type_idx').on(table.mimeType),
  // Index for sorting by creation date (most recent uploads)
  index('cms_media_created_at_idx').on(table.createdAt),
  // Index for finding all media uploaded by a user
  index('cms_media_uploaded_by_idx').on(table.uploadedBy),
]));

const cmsEntryCommonColumns = {
  title: text().notNull(),
  content: text({ mode: 'json' }).$type<JSONContent>().notNull(),
  fields: text({ mode: 'json' }).default('{}').notNull(),
  slug: text().notNull(),
  seoDescription: text(),
  status: text({
    enum: cmsEntryStatusTuple,
  }).notNull().$type<CmsEntryStatus>().notNull(),
  publishedAt: integer({ mode: 'timestamp' }),
  featuredImageId: text().references(() => cmsMediaTable.id, { onDelete: 'set null' }),
  createdBy: text().notNull().references(() => userTable.id),
};

export const cmsEntryTable = sqliteTable("cms_entry", {
  ...commonColumns,
  id: text().primaryKey().$defaultFn(() => `cms_ent_${createId()}`).notNull(),
  collection: text().$type<CollectionsUnion>().notNull(),
  ...cmsEntryCommonColumns,
  status: text({
    enum: cmsEntryStatusTuple,
  }).default(CMS_ENTRY_STATUS.DRAFT).$type<CmsEntryStatus>().notNull(), // Override status to add default
}, (table) => ([
  // Index for filtering by collection (most common query)
  index('cms_entry_collection_idx').on(table.collection),

  // Index for filtering by status (published vs draft vs archived)
  index('cms_entry_status_idx').on(table.status),

  // Composite index for collection + status (very common: "get all published posts")
  index('cms_entry_collection_status_idx').on(table.collection, table.status),

  // Index for slug lookups (finding specific entries by slug)
  index('cms_entry_slug_idx').on(table.slug),

  // Unique constraint for collection + slug (ensure unique slugs per collection)
  unique('cms_entry_collection_slug_unique').on(table.collection, table.slug),

  // Index for created by (finding entries by author)
  index('cms_entry_created_by_idx').on(table.createdBy),

  // Composite index for author + status (e.g., "my drafts")
  index('cms_entry_created_by_status_idx').on(table.createdBy, table.status),

  // Index for sorting by creation date (most recent entries)
  index('cms_entry_created_at_idx').on(table.createdAt),

  // Composite index for collection + status + created date (optimized listing with filters and sorting)
  index('cms_entry_collection_status_created_at_idx').on(table.collection, table.status, table.createdAt),

  // Composite index for collection + created date (optimized listing for admin dashboard)
  index('cms_entry_collection_created_at_idx').on(table.collection, table.createdAt),

  // Index for featured image lookups
  index('cms_entry_featured_image_idx').on(table.featuredImageId),
]));

export const scheduledJobTable = sqliteTable("scheduled_job", {
  ...commonColumns,
  id: text().primaryKey().$defaultFn(() => `sjob_${createId()}`).notNull(),
  type: text().$type<ScheduledJobType>().notNull(),
  dedupeKey: text().notNull(),
  payload: text({ mode: "json" }).$type<ScheduledJobPayload>().notNull(),
  runAt: integer({ mode: "timestamp" }).notNull(),
}, (table) => ([
  index("scheduled_job_run_at_idx").on(table.runAt),
  unique("scheduled_job_type_dedupe_key_unique").on(table.type, table.dedupeKey),
]));

export const cmsNavigationItemTable = sqliteTable("cms_navigation_item", {
  ...commonColumns,
  id: text().primaryKey().$defaultFn(() => `cms_nav_${createId()}`).notNull(),
  navigationKey: text({
    enum: cmsNavigationKeys,
  }).$type<CmsNavigationKey>().notNull(),
  parentId: text(),
  nodeType: text({
    enum: cmsNavigationNodeTypeTuple,
  }).$type<CmsNavigationNodeType>().notNull(),
  title: text().notNull(),
  entryId: text().references(() => cmsEntryTable.id, { onDelete: "cascade" }),
  slugSegment: text(),
  resolvedPath: text(),
  sortOrder: integer().default(0).notNull(),
}, (table) => ([
  index("cms_navigation_item_site_key_idx").on(table.navigationKey),
  index("cms_navigation_item_parent_id_idx").on(table.parentId),
  unique("cms_navigation_item_site_path_unique").on(table.navigationKey, table.resolvedPath),
  unique("cms_navigation_item_site_parent_sort_order_unique").on(table.navigationKey, table.parentId, table.sortOrder),
  unique("cms_navigation_item_site_entry_unique").on(table.navigationKey, table.entryId),
]));

export const cmsNavigationRedirectTable = sqliteTable("cms_navigation_redirect", {
  ...commonColumns,
  id: text().primaryKey().$defaultFn(() => `cms_red_${createId()}`).notNull(),
  navigationKey: text({
    enum: cmsNavigationKeys,
  }).$type<CmsNavigationKey>().notNull(),
  fromPath: text().notNull(),
  toPath: text().notNull(),
  statusCode: integer().default(307).notNull(),
}, (table) => ([
  index("cms_navigation_redirect_site_key_idx").on(table.navigationKey),
  unique("cms_navigation_redirect_site_from_path_unique").on(table.navigationKey, table.fromPath),
]));

export const cmsEntryVersionTable = sqliteTable("cms_entry_version", {
  ...commonColumns,
  id: text().primaryKey().$defaultFn(() => `cms_ver_${createId()}`).notNull(),
  entryId: text().notNull().references(() => cmsEntryTable.id, { onDelete: 'cascade' }),
  versionNumber: integer().notNull(),
  ...cmsEntryCommonColumns,
}, (table) => ([
  index('cms_entry_version_entry_id_idx').on(table.entryId),
  index('cms_entry_version_entry_id_version_idx').on(table.entryId, table.versionNumber),
]));

// Junction table for many-to-many relationship between entries and media
export const cmsEntryMediaTable = sqliteTable("cms_entry_media", {
  ...commonColumns,
  id: text().primaryKey().$defaultFn(() => `cms_em_${createId()}`).notNull(),
  entryId: text().notNull().references(() => cmsEntryTable.id, { onDelete: 'cascade' }),
  mediaId: text().notNull().references(() => cmsMediaTable.id, { onDelete: 'cascade' }),
  position: integer(),
  caption: text(),
}, (table) => ([
  // Index for finding all media in an entry
  index('cms_entry_media_entry_id_idx').on(table.entryId),
  // Index for finding all entries using a media item
  index('cms_entry_media_media_id_idx').on(table.mediaId),
  // Unique constraint to prevent the same media from being attached to the same entry multiple times
  unique('cms_entry_media_entry_media_unique').on(table.entryId, table.mediaId),
]));

export const cmsTagTable = sqliteTable("cms_tag", {
  ...commonColumns,
  id: text().primaryKey().$defaultFn(() => `ctag_${createId()}`).notNull(),
  name: text().notNull().unique(),
  slug: text().notNull().unique(),
  description: text(),
  color: text(),
  createdBy: text().notNull().references(() => userTable.id),
});

// Junction table for many-to-many relationship between entries and tags
export const cmsEntryTagTable = sqliteTable("cms_entry_tag", {
  ...commonColumns,
  id: text().primaryKey().$defaultFn(() => `cet_${createId()}`).notNull(),
  entryId: text().notNull().references(() => cmsEntryTable.id, { onDelete: 'cascade' }),
  tagId: text().notNull().references(() => cmsTagTable.id, { onDelete: 'cascade' }),
}, (table) => ([
  index('cms_entry_tag_entry_id_idx').on(table.entryId),
  index('cms_entry_tag_tag_id_idx').on(table.tagId),
  unique('cms_entry_tag_unique').on(table.entryId, table.tagId),
]));

export const cmsMediaRelations = relations(cmsMediaTable, ({ many, one }) => ({
  entryMedia: many(cmsEntryMediaTable),
  uploadedByUser: one(userTable, {
    fields: [cmsMediaTable.uploadedBy],
    references: [userTable.id],
  }),
}));

export const cmsEntryMediaRelations = relations(cmsEntryMediaTable, ({ one }) => ({
  entry: one(cmsEntryTable, {
    fields: [cmsEntryMediaTable.entryId],
    references: [cmsEntryTable.id],
  }),
  media: one(cmsMediaTable, {
    fields: [cmsEntryMediaTable.mediaId],
    references: [cmsMediaTable.id],
  }),
}));

export const cmsTagRelations = relations(cmsTagTable, ({ many, one }) => ({
  entries: many(cmsEntryTagTable),
  createdByUser: one(userTable, {
    fields: [cmsTagTable.createdBy],
    references: [userTable.id],
  }),
}));

export const cmsEntryTagRelations = relations(cmsEntryTagTable, ({ one }) => ({
  entry: one(cmsEntryTable, {
    fields: [cmsEntryTagTable.entryId],
    references: [cmsEntryTable.id],
  }),
  tag: one(cmsTagTable, {
    fields: [cmsEntryTagTable.tagId],
    references: [cmsTagTable.id],
  }),
}));

export const cmsEntryRelations = relations(cmsEntryTable, ({ one, many }) => ({
  createdByUser: one(userTable, {
    fields: [cmsEntryTable.createdBy],
    references: [userTable.id],
  }),
  featuredImage: one(cmsMediaTable, {
    fields: [cmsEntryTable.featuredImageId],
    references: [cmsMediaTable.id],
  }),
  entryMedia: many(cmsEntryMediaTable),
  tags: many(cmsEntryTagTable),
  versions: many(cmsEntryVersionTable),
}));

export const cmsEntryVersionRelations = relations(cmsEntryVersionTable, ({ one }) => ({
  entry: one(cmsEntryTable, {
    fields: [cmsEntryVersionTable.entryId],
    references: [cmsEntryTable.id],
  }),
  createdByUser: one(userTable, {
    fields: [cmsEntryVersionTable.createdBy],
    references: [userTable.id],
  }),
  featuredImage: one(cmsMediaTable, {
    fields: [cmsEntryVersionTable.featuredImageId],
    references: [cmsMediaTable.id],
  }),
}));

export const teamRelations = relations(teamTable, ({ many }) => ({
  memberships: many(teamMembershipTable),
  invitations: many(teamInvitationTable),
  roles: many(teamRoleTable),
}));

export const teamRoleRelations = relations(teamRoleTable, ({ one }) => ({
  team: one(teamTable, {
    fields: [teamRoleTable.teamId],
    references: [teamTable.id],
  }),
}));

export const teamMembershipRelations = relations(teamMembershipTable, ({ one }) => ({
  team: one(teamTable, {
    fields: [teamMembershipTable.teamId],
    references: [teamTable.id],
  }),
  user: one(userTable, {
    fields: [teamMembershipTable.userId],
    references: [userTable.id],
  }),
  invitedByUser: one(userTable, {
    fields: [teamMembershipTable.invitedBy],
    references: [userTable.id],
  }),
}));

export const teamInvitationRelations = relations(teamInvitationTable, ({ one }) => ({
  team: one(teamTable, {
    fields: [teamInvitationTable.teamId],
    references: [teamTable.id],
  }),
  invitedByUser: one(userTable, {
    fields: [teamInvitationTable.invitedBy],
    references: [userTable.id],
  }),
  acceptedByUser: one(userTable, {
    fields: [teamInvitationTable.acceptedBy],
    references: [userTable.id],
  }),
}));

export const creditTransactionRelations = relations(creditTransactionTable, ({ one }) => ({
  user: one(userTable, {
    fields: [creditTransactionTable.userId],
    references: [userTable.id],
  }),
}));

export const purchasedItemsRelations = relations(purchasedItemsTable, ({ one }) => ({
  user: one(userTable, {
    fields: [purchasedItemsTable.userId],
    references: [userTable.id],
  }),
}));

export const userRelations = relations(userTable, ({ many }) => ({
  passkeys: many(passKeyCredentialTable),
  creditTransactions: many(creditTransactionTable),
  purchasedItems: many(purchasedItemsTable),
  teamMemberships: many(teamMembershipTable),
  cmsEntries: many(cmsEntryTable),
  cmsMedia: many(cmsMediaTable),
  cmsTags: many(cmsTagTable),
}));

export const passKeyCredentialRelations = relations(passKeyCredentialTable, ({ one }) => ({
  user: one(userTable, {
    fields: [passKeyCredentialTable.userId],
    references: [userTable.id],
  }),
}));

export const ONBOARDING_STATE = {
  MAGIC_LINK_SENT: 'magic_link_sent',
  DATA_CONFIRMED: 'data_confirmed',
  BRAND_PERSONA_PENDING: 'brand_persona_pending',
  BRAND_PERSONA_COMPLETED: 'brand_persona_completed',
  COMPLETED: 'completed',
} as const;

export const onboardingStateTuple = Object.values(ONBOARDING_STATE) as [string, ...string[]];

export const restaurantsTable = sqliteTable("restaurants", {
  ...commonColumns,
  id: text().primaryKey().$defaultFn(() => `rest_${createId()}`).notNull(),
  slug: text("slug", { length: 255 }).unique(),
  name: text("name", { length: 255 }).notNull(),
  location: text("location", { length: 255 }),
  googlePlaceId: text("google_place_id", { length: 255 }),
  googleRating: real("google_rating"),
  reviewCount: integer("review_count"),
  businessType: text("business_type", { length: 100 }),
  cuisineType: text("cuisine_type", { length: 100 }),
  locationArea: text("location_area", { length: 255 }),
  peakSeasonStart: text("peak_season_start", { length: 10 }),
  qualificationStatus: text("qualification_status", { enum: ['pending', 'qualified', 'disqualified'] }).default('pending').notNull(),
  exclusionReason: text("exclusion_reason"),
  failedRatingGate: integer("failed_rating_gate", { mode: "boolean" }).default(false),
  failedReviewsGate: integer("failed_reviews_gate", { mode: "boolean" }).default(false),
  failedBusinessTypeGate: integer("failed_business_type_gate", { mode: "boolean" }).default(false),
  instagramFollowers: integer("instagram_followers"),
  instagramEngagementRate: integer("instagram_engagement_rate_bps"), // basis points for precision (e.g., 3420 = 3.42%)
  googleMapsData: text("google_maps_data", { mode: "json" }), // validated at ingestion via zod schema
  competitorData: text("competitor_data", { mode: "json" }),   // validated at ingestion via zod schema
  lastScrapedAt: integer("last_scraped_at", { mode: "timestamp" }),
  behavioralState: integer("behavioral_state").default(0).notNull(),
  marketingReadinessScore: integer("marketing_readiness_score"),
  scoreBand: text("score_band", { length: 50 }),
  primaryGapExplanation: text("primary_gap_explanation"),
  diagnosticPackage: text("diagnostic_package", { mode: "json" }),
  enhancedPhotoUrl: text("enhanced_photo_url", { length: 1000 }),
  croVariant: text("cro_variant", { enum: ['A_SCORE', 'B_VISUAL', 'C_NARRATIVE'] }),
  offerExpiresAt: integer("offer_expires_at", { mode: "timestamp" }),
  // Onboarding (Story 3.1)
  onboardingState: text("onboarding_state", { enum: onboardingStateTuple }),
  magicLinkTokenHash: text("magic_link_token_hash", { length: 128 }),
  magicLinkExpiresAt: integer("magic_link_expires_at", { mode: "timestamp" }),
  onboardingDataCorrections: text("onboarding_data_corrections", { mode: "json" }),
  // Brand Persona (Story 3.2)
  brandPersonaFragment: text("brand_persona_fragment"),
  brandPersonaR2Key: text("brand_persona_r2_key", { length: 500 }),
  // Scarcity Enforcement (Story 3.3)
  subscriptionStatus: text("subscription_status", { enum: ['prospect', 'active_saas', 'active_agency', 'hibernate'] }).default('prospect').notNull(),
  // Stripe Subscription (Story 3.4)
  stripeCustomerId: text("stripe_customer_id", { length: 255 }),
  stripeSubscriptionId: text("stripe_subscription_id", { length: 255 }),
  subscriptionTier: text("subscription_tier", { enum: ['starter', 'pro', 'annual_pro'] }),
  subscriptionCurrentPeriodEnd: integer("subscription_current_period_end", { mode: "timestamp" }),
  // Chrome Extension auth (Story 6.2)
  extensionAuthToken: text("extension_auth_token", { length: 255 }),
  // Campaign Engine (Epic 4)
  campaignCronOffsetMinutes: integer("campaign_cron_offset_minutes").default(0),
  campaignPending: text("campaign_pending", { mode: "json" }),
  lastRunAt: integer("last_run_at", { mode: "timestamp" }),
  telegramChatId: text("telegram_chat_id", { length: 255 }),
  // Offline monitoring (Story 6.5) — last time owner was alerted about extension being offline
  lastOfflineAlertAt: integer("last_offline_alert_at", { mode: "timestamp" }),
  // Operator P1 escalation tracking — last time a P1 operator alert was sent for this restaurant
  lastOperatorAlertAt: integer("last_operator_alert_at", { mode: "timestamp" }),
  // Off-Season Guardian Mode (Story 7.3)
  operationalMode: text("operational_mode", { enum: ["peak_season", "local_seo_guardian", "pre_season_booking", "hibernate"] }).default("peak_season").notNull(),
  modeChangedAt: integer("mode_changed_at", { mode: "timestamp" }),
  peakSeasonEndDetectedAt: integer("peak_season_end_detected_at", { mode: "timestamp" }),
  guardianModeSince: integer("guardian_mode_since", { mode: "timestamp" }),
  lastGuardianReportAt: integer("last_guardian_report_at", { mode: "timestamp" }),
  seoGuardianConfig: text("seo_guardian_config", { mode: "json" }).$type<SeoGuardianConfig>(),
  // Pre-Season Booking Engine (Story 7.4) — quick flag for orchestrator branch checks
  preSeasonBookingEnabled: integer("pre_season_booking_enabled", { mode: "boolean" }).default(false).notNull(),
  // Hibernate Tier (Story 7.5)
  hibernateSince: integer("hibernate_since", { mode: "timestamp" }),
  reactivationEligibility: text("reactivation_eligibility", { mode: "json" }).$type<ReactivationEligibility>(),

}, (table) => ([
  index('restaurants_slug_idx').on(table.slug),
  index('restaurants_qualification_status_idx').on(table.qualificationStatus),
  index('restaurants_name_idx').on(table.name),
  index('restaurants_location_idx').on(table.location),
  index('restaurants_cuisine_location_idx').on(table.cuisineType, table.locationArea),
  index('restaurants_magic_link_token_hash_idx').on(table.magicLinkTokenHash),
  index('restaurants_scarcity_idx').on(table.cuisineType, table.locationArea, table.subscriptionStatus),
  index('restaurants_extension_auth_token_idx').on(table.extensionAuthToken),
  index('restaurants_last_offline_alert_at_idx').on(table.lastOfflineAlertAt),
  index('restaurants_last_operator_alert_at_idx').on(table.lastOperatorAlertAt),
  index('restaurants_operational_mode_idx').on(table.operationalMode),
  index('restaurants_guardian_mode_since_idx').on(table.guardianModeSince),
]));

export const environmentalSignalsTable = sqliteTable("environmental_signals", {
  ...commonColumns,
  id: text().primaryKey().$defaultFn(() => `esig_${createId()}`).notNull(),
  cityName: text("city_name", { length: 255 }).notNull(),
  date: text("date", { length: 50 }).notNull(),
  signalType: text("signal_type", { enum: ['weather', 'event', 'trending', 'pre_season_window', 'season_close', 'season_open'] }).default('weather').notNull(),
  weatherData: text("weather_data", { mode: "json" }),
  localEvents: text("local_events", { mode: "json" }),
  trendingContent: text("trending_content", { mode: "json" }),
}, (table) => ([
  index('environmental_signals_city_date_idx').on(table.cityName, table.date),
  index('environmental_signals_signal_type_idx').on(table.signalType),
  unique('environmental_signals_city_date_unique').on(table.cityName, table.date),
]));

export const prospectEventsTable = sqliteTable("prospect_events", {
  ...commonColumns,
  id: text().primaryKey().$defaultFn(() => `pevt_${createId()}`).notNull(),
  prospectId: text("prospect_id").notNull().references(() => restaurantsTable.id, { onDelete: "cascade" }),
  fromState: integer("from_state").notNull(),
  toState: integer("to_state").notNull(),
  trigger: text("trigger", { enum: ['email_open', 'page_visit', 'demo_download', 'reply', 'opt_out', 'retarget_season', 'retarget_competitor'] }).notNull(),
}, (table) => ([
  index('prospect_events_prospect_id_idx').on(table.prospectId),
]));

export const analyticsEventsTable = sqliteTable("analytics_events", {
  ...commonColumns,
  id: text().primaryKey().$defaultFn(() => `aevt_${createId()}`).notNull(),
  prospectId: text("prospect_id").references(() => restaurantsTable.id, { onDelete: "cascade" }),
  eventType: text("event_type").notNull(), // 'page_view', 'scroll', 'click', 'email_open'
  metadata: text("metadata", { mode: "json" }), // e.g. { scroll_depth: 75, path: '/...' }
}, (table) => ([
  index('analytics_events_prospect_id_idx').on(table.prospectId),
  index('analytics_events_event_type_idx').on(table.eventType),
  index('analytics_events_created_at_idx').on(table.createdAt),
]));

export const agentConfigTable = sqliteTable("agent_config", {
  ...commonColumns,
  agentCode: text("agent_code", { length: 50 }).primaryKey().notNull(),
  provider: text("provider", { length: 50 }).notNull(),
  model: text("model", { length: 100 }).notNull(),
  temperature: real("temperature").notNull(),
  maxTokens: integer("max_tokens").notNull(),
}, (table) => ([
  // Prevent duplicate provider/model combos (e.g., one config per model)
  unique('agent_config_provider_model_unique').on(table.provider, table.model),
  // CHECK constraints handled at application layer (Zod); SQLite CHECK syntax varies by D1 runtime
]));

export const CAMPAIGN_STATUS = {
  PENDING_APPROVAL: 'pending_approval',
  APPROVED: 'approved',
  PENDING_REVISION: 'pending_revision',
  REJECTED: 'rejected',
  PENDING_SCHEDULE: 'pending_schedule',
  SCHEDULED: 'scheduled',
  PUBLISHED: 'published',
  FAILED: 'failed',
} as const;

export const campaignStatusTuple = Object.values(CAMPAIGN_STATUS) as [string, ...string[]];

export const NOTIFICATION_STATUS = {
  PENDING: 'pending',
  SENT: 'sent',
  FAILED: 'failed',
  RETRYING: 'retrying',
} as const;

export const notificationStatusTuple = Object.values(NOTIFICATION_STATUS) as [string, ...string[]];

export const campaignsTable = sqliteTable("campaigns", {
  ...commonColumns,
  id: text().primaryKey().$defaultFn(() => `camp_${createId()}`).notNull(),
  restaurantId: text("restaurant_id").notNull().references(() => restaurantsTable.id, { onDelete: "cascade" }),
  source: text("source").notNull(), // 'autonomous' | 'owner_initiated'
  ownerInputType: text("owner_input_type"), // 'photo' | 'voice' | 'text' | 'video' — null for autonomous
  campaignType: text("campaign_type").notNull(), // 'flash_offer' | 'seasonal_event' | 'daily_special' | 'brand_awareness' | 'pre_season_booking' | 'guardian'
  // Campaign content (Story 5.1)
  headline: text("headline"),
  subheadline: text("subheadline"),
  whyNowContext: text("why_now_context"), // signal-driven explanation shown to owner
  assetUrl: text("asset_url", { length: 1000 }),
  assetR2Key: text("asset_r2_key", { length: 500 }), // R2 key for rendered thumbnail/asset
  fullAssetR2Key: text("full_asset_r2_key", { length: 500 }), // full resolution asset
  caption: text("caption"),
  platforms: text("platforms"), // comma-separated: 'instagram,facebook,tiktok,gbp'
  signalTrigger: text("signal_trigger", { mode: "json" }), // JSON of signal data that triggered campaign
  signalsTriggerHash: text("signals_trigger_hash"),
  // Status lifecycle (Story 5.1, 6.1)
  status: text("status", { enum: campaignStatusTuple }).default('pending_approval').notNull(),
  telegramMessageId: integer("telegram_message_id"), // for reply threading
  revisionCount: integer("revision_count").default(0).notNull(),
  // Nudge & escalation (Story 5.1)
  nudgeCount: integer("nudge_count").default(0).notNull(),
  lastNudgeAt: integer("last_nudge_at", { mode: "timestamp" }),
  approvedAt: integer("approved_at", { mode: "timestamp" }),
  rejectedAt: integer("rejected_at", { mode: "timestamp" }),
  // Extension scheduling lock (Story 6.2)
  claimedAt: integer("claimed_at", { mode: "timestamp" }),
  scheduledAt: integer("scheduled_at", { mode: "timestamp" }),
  claimedBy: text("claimed_by", { length: 255 }),
  revertCount: integer("revert_count").default(0).notNull(),
  // Notification tracking (Decision 3)
  notificationStatus: text("notification_status", { enum: notificationStatusTuple }).default('pending').notNull(),
  notificationAttempts: integer("notification_attempts").default(0).notNull(),
  notificationLastError: text("notification_last_error"),
  notificationSentAt: integer("notification_sent_at", { mode: "timestamp" }),

}, (table) => ([
  index('campaigns_restaurant_id_idx').on(table.restaurantId),
  index('campaigns_status_idx').on(table.status),
  index('campaigns_source_idx').on(table.source),
  index('campaigns_created_at_idx').on(table.createdAt),
  index('campaigns_notification_status_idx').on(table.notificationStatus),
  index('campaigns_status_claimed_scheduled_idx').on(table.status, table.claimedAt, table.scheduledAt),
]));

export const LOCK_STATUS = {
  HELD: 'held',
  RELEASED: 'released',
} as const;

export const lockStatusTuple = Object.values(LOCK_STATUS) as [string, ...string[]];

export const generationLocksTable = sqliteTable("generation_locks", {
  id: text().primaryKey().$defaultFn(() => `lock_${createId()}`).notNull(),
  restaurantSlug: text("restaurant_slug").notNull(),
  lockDate: text("lock_date").notNull(), // YYYY-MM-DD format
  lockUntil: integer("lock_until", { mode: "timestamp" }).notNull(), // Until when the lock is valid
  restaurantId: text("restaurant_id").references(() => restaurantsTable.id, { onDelete: "cascade" }),
  status: text("status", { enum: lockStatusTuple }).default('held').notNull(),
}, (table) => ([
  unique('generation_locks_unique_per_restaurant_per_day').on(table.restaurantSlug, table.lockDate),
  index('generation_locks_restaurant_slug_idx').on(table.restaurantSlug),
  index('generation_locks_lock_date_idx').on(table.lockDate),
  index('generation_locks_lock_until_idx').on(table.lockUntil),
]));


export const TEMPLATE_FORGE_STATUS = {
  ACTIVE: 'active',
  PROPOSED: 'proposed',
  DEPRECATED: 'deprecated',
} as const;

export const templateForgeStatusTuple = Object.values(TEMPLATE_FORGE_STATUS) as [string, ...string[]];

export const templateForgeTable = sqliteTable("template_forge", {
  ...commonColumns,
  id: text().primaryKey().$defaultFn(() => `tf_${createId()}`).notNull(),
  restaurantId: text("restaurant_id").references(() => restaurantsTable.id, { onDelete: "set null" }),
  templateId: text("template_id", { length: 255 }).notNull(),
  campaignType: text("campaign_type", { enum: ['flash_offer', 'seasonal_event', 'daily_special', 'brand_awareness', 'pre_season_booking'] }).notNull(),
  impressions: integer("impressions").default(0).notNull(),
  engagementRateBps: integer("engagement_rate_bps").default(0).notNull(),
  ctrBps: integer("ctr_bps").default(0).notNull(),
  conversions: integer("conversions").default(0).notNull(),
  performanceScore: real("performance_score").default(0).notNull(),
  lastSelectedAt: integer("last_selected_at", { mode: "timestamp" }),
  status: text("status", { enum: templateForgeStatusTuple }).default('active').notNull(),
  proposedAt: integer("proposed_at", { mode: "timestamp" }),
  parentTemplateId: text("parent_template_id", { length: 255 }),
  ncatParametersDiff: text("ncat_parameters_diff", { mode: "json" }),
  performanceHypothesis: text("performance_hypothesis"),
  schemaVersion: text("schema_version", { length: 10 }).default('1.0').notNull(),
  deprecatedAt: integer("deprecated_at", { mode: "timestamp" }),
}, (table) => ([
  index('template_forge_restaurant_campaign_status_idx').on(table.restaurantId, table.campaignType, table.status),
  index('template_forge_template_id_idx').on(table.templateId),
  index('template_forge_performance_score_idx').on(table.performanceScore),
  index('template_forge_last_selected_at_idx').on(table.lastSelectedAt),
  index('template_forge_status_proposed_at_idx').on(table.status, table.proposedAt),
  unique('template_forge_restaurant_template_campaign_unique').on(table.restaurantId, table.templateId, table.campaignType),
]));

// Template Forge relations
export const templateForgeRelations = relations(templateForgeTable, ({ one }) => ({
  restaurant: one(restaurantsTable, {
    fields: [templateForgeTable.restaurantId],
    references: [restaurantsTable.id],
  }),
}));

// oxlint-disable-next-line project/no-unused-module-exports -- Drizzle schema model types are exported as app/tooling contracts.
export type User = InferSelectModel<typeof userTable>;
// oxlint-disable-next-line project/no-unused-module-exports -- Drizzle schema model types are exported as app/tooling contracts.
export type PassKeyCredential = InferSelectModel<typeof passKeyCredentialTable>;
// oxlint-disable-next-line project/no-unused-module-exports -- Drizzle schema model types are exported as app/tooling contracts.
export type CreditTransaction = InferSelectModel<typeof creditTransactionTable>;
// oxlint-disable-next-line project/no-unused-module-exports -- Drizzle schema model types are exported as app/tooling contracts.
export type PurchasedItem = InferSelectModel<typeof purchasedItemsTable>;
// oxlint-disable-next-line project/no-unused-module-exports -- Drizzle schema model types are exported as app/tooling contracts.
export type Team = InferSelectModel<typeof teamTable>;
// oxlint-disable-next-line project/no-unused-module-exports -- Drizzle schema model types are exported as app/tooling contracts.
export type TeamMembership = InferSelectModel<typeof teamMembershipTable>;
// oxlint-disable-next-line project/no-unused-module-exports -- Drizzle schema model types are exported as app/tooling contracts.
export type TeamRole = InferSelectModel<typeof teamRoleTable>;
// oxlint-disable-next-line project/no-unused-module-exports -- Drizzle schema model types are exported as app/tooling contracts.
export type TeamInvitation = InferSelectModel<typeof teamInvitationTable>;
// oxlint-disable-next-line project/no-unused-module-exports -- Drizzle schema model types are exported as app/tooling contracts.
export type CmsEntry = InferSelectModel<typeof cmsEntryTable>;
// oxlint-disable-next-line project/no-unused-module-exports -- Drizzle schema model types are exported as app/tooling contracts.
export type CmsMedia = InferSelectModel<typeof cmsMediaTable>;
// oxlint-disable-next-line project/no-unused-module-exports -- Drizzle schema model types are exported as app/tooling contracts.
export type CmsEntryMedia = InferSelectModel<typeof cmsEntryMediaTable>;
// oxlint-disable-next-line project/no-unused-module-exports -- Drizzle schema model types are exported as app/tooling contracts.
export type CmsTag = InferSelectModel<typeof cmsTagTable>;
// oxlint-disable-next-line project/no-unused-module-exports -- Drizzle schema model types are exported as app/tooling contracts.
export type Restaurant = InferSelectModel<typeof restaurantsTable>;
// oxlint-disable-next-line project/no-unused-module-exports -- Drizzle schema model types are exported as app/tooling contracts.
export type SubscriptionStatus = 'prospect' | 'active_saas' | 'active_agency' | 'hibernate';
// oxlint-disable-next-line project/no-unused-module-exports -- Drizzle schema model types are exported as app/tooling contracts.
export type SubscriptionTier = 'starter' | 'pro' | 'annual_pro';
// oxlint-disable-next-line project/no-unused-module-exports -- Drizzle schema model types are exported as app/tooling contracts.
export type CmsEntryTag = InferSelectModel<typeof cmsEntryTagTable>;
// oxlint-disable-next-line project/no-unused-module-exports -- Drizzle schema model types are exported as app/tooling contracts.
export type CmsEntryVersion = InferSelectModel<typeof cmsEntryVersionTable>;
// oxlint-disable-next-line project/no-unused-module-exports -- Drizzle schema model types are exported as app/tooling contracts.
export type CmsNavigationItem = InferSelectModel<typeof cmsNavigationItemTable>;
// oxlint-disable-next-line project/no-unused-module-exports -- Drizzle schema model types are exported as app/tooling contracts.
export type CmsNavigationRedirect = InferSelectModel<typeof cmsNavigationRedirectTable>;
// oxlint-disable-next-line project/no-unused-module-exports -- Drizzle schema model types are exported as app/tooling contracts.
export type ScheduledJob = InferSelectModel<typeof scheduledJobTable>;
// oxlint-disable-next-line project/no-unused-module-exports -- Drizzle schema model types are exported as app/tooling contracts.
export type EnvironmentalSignal = InferSelectModel<typeof environmentalSignalsTable>;
// oxlint-disable-next-line project/no-unused-module-exports -- Drizzle schema model types are exported as app/tooling contracts.
export type ProspectEvent = InferSelectModel<typeof prospectEventsTable>;
// oxlint-disable-next-line project/no-unused-module-exports -- Drizzle schema model types are exported as app/tooling contracts.
export type AnalyticsEvent = InferSelectModel<typeof analyticsEventsTable>;
// oxlint-disable-next-line project/no-unused-module-exports -- Drizzle schema model types are exported as app/tooling contracts.
export type AgentConfig = InferSelectModel<typeof agentConfigTable>;
// oxlint-disable-next-line project/no-unused-module-exports -- Drizzle schema model types are exported as app/tooling contracts.
// Campaigns relations — required for Drizzle relational queries (with: { restaurant: true })
export const campaignsRelations = relations(campaignsTable, ({ one, many }) => ({
  restaurant: one(restaurantsTable, {
    fields: [campaignsTable.restaurantId],
    references: [restaurantsTable.id],
  }),
  revisions: many(campaignRevisionsTable),
}));

export type Campaign = InferSelectModel<typeof campaignsTable>;
// oxlint-disable-next-line project/no-unused-module-exports -- Drizzle schema model types are exported as app/tooling contracts.
export type GenerationLock = InferSelectModel<typeof generationLocksTable>;
// oxlint-disable-next-line project/no-unused-module-exports -- Drizzle schema model types are exported as app/tooling contracts.
export type TemplateForge = InferSelectModel<typeof templateForgeTable>;
// Campaign Revisions table (Story 5.2: Telegram Conversational Revisions)
export const campaignRevisionsTable = sqliteTable("campaign_revisions", {
  ...commonColumns,
  id: text().primaryKey().$defaultFn(() => `crev_${createId()}`).notNull(),
  campaignId: text("campaign_id").notNull().references(() => campaignsTable.id, { onDelete: "cascade" }),
  revisionNumber: integer("revision_number").notNull(),
  originalCaption: text("original_caption"),
  revisedCaption: text("revised_caption"),
  instructions: text("instructions"), // owner's revision request text
  aiResponse: text("ai_response", { mode: "json" }), // full AI output (turn, visual_direction, etc.)
  statusBefore: text("status_before", { enum: campaignStatusTuple }).notNull(),
  statusAfter: text("status_after", { enum: campaignStatusTuple }).notNull(),
}, (table) => ([
  index('campaign_revisions_campaign_id_idx').on(table.campaignId),
  index('campaign_revisions_revision_number_idx').on(table.campaignId, table.revisionNumber),
]));

export const campaignRevisionsRelations = relations(campaignRevisionsTable, ({ one }) => ({
  campaign: one(campaignsTable, {
    fields: [campaignRevisionsTable.campaignId],
    references: [campaignsTable.id],
  }),
}));

// oxlint-disable-next-line project/no-unused-module-exports -- Drizzle schema model types are exported as app/tooling contracts.
export type TemplateForgeStatus = typeof TEMPLATE_FORGE_STATUS[keyof typeof TEMPLATE_FORGE_STATUS];
// oxlint-disable-next-line project/no-unused-module-exports
export type CampaignRevision = InferSelectModel<typeof campaignRevisionsTable>;

// ─── Results Dashboard (Story 7.1) ────────────────────────

/** Campaign Analytics — weekly aggregate of published campaign performance. */
export const campaignAnalyticsTable = sqliteTable("campaign_analytics", {
  ...commonColumns,
  id: text().primaryKey().$defaultFn(() => `ca_${createId()}`).notNull(),
  campaignId: text("campaign_id").references(() => campaignsTable.id, { onDelete: "cascade" }).notNull(),
  restaurantId: text("restaurant_id").references(() => restaurantsTable.id, { onDelete: "cascade" }).notNull(),
  platform: text("platform", { enum: ['instagram', 'facebook', 'tiktok', 'gbp'] }).notNull(),
  impressions: integer("impressions").default(0).notNull(),
  engagementRateBps: integer("engagement_rate_bps").default(0).notNull(), // basis points (e.g., 3420 = 3.42%)
  clicks: integer("clicks").default(0).notNull(),
  conversions: integer("conversions").default(0).notNull(),
  earlyBookingIntentClicks: integer("early_booking_intent_clicks").default(0).notNull(),
  weekStart: integer("week_start", { mode: "timestamp" }).notNull(), // Monday 00:00:00 UTC
  fetchedAt: integer("fetched_at", { mode: "timestamp" }).notNull(),
}, (table) => ([
  index('ca_restaurant_week_idx').on(table.restaurantId, table.weekStart),
  index('ca_campaign_id_idx').on(table.campaignId),
]));

/** Restaurant Metrics — per-restaurant configurable constants for ROI calculation. */
export const restaurantMetricsTable = sqliteTable("restaurant_metrics", {
  restaurantId: text("restaurant_id").references(() => restaurantsTable.id, { onDelete: "cascade" }).primaryKey(),
  localConversionRate: real("local_conversion_rate").default(0.02).notNull(), // default 2% of reach converts to tables
  avgRevenuePerTable: real("avg_revenue_per_table").default(50).notNull(), // default $50
  avgTableSize: real("avg_table_size").default(2.5).notNull(),
  lastUpdatedAt: integer("last_updated_at", { mode: "timestamp" }).notNull(),
});

// oxlint-disable-next-line project/no-unused-module-exports
export type CampaignAnalytics = InferSelectModel<typeof campaignAnalyticsTable>;
// oxlint-disable-next-line project/no-unused-module-exports
export type RestaurantMetrics = InferSelectModel<typeof restaurantMetricsTable>;

// ─── Off-Season Guardian Mode (Story 7.3) ────────────────

export const OPERATIONAL_MODE = {
  PEAK_SEASON: "peak_season",
  LOCAL_SEO_GUARDIAN: "local_seo_guardian",
  PRE_SEASON_BOOKING: "pre_season_booking",
  HIBERNATE: "hibernate",
} as const;

export type OperationalMode = typeof OPERATIONAL_MODE[keyof typeof OPERATIONAL_MODE];

export interface SeoGuardianConfig {
  peakSeasonEndMonth: number;  // default 10 (October)
  guardianStartMonth: number;  // default 11 (November)
  guardianEndMonth: number;    // default 12 (December)
  postsPerWeek: number;        // default 2
  guardianContentTypes: ("community" | "history" | "holiday_anticipation" | "local_highlight")[];
  reviewResponseEnabled: boolean; // default true
  monthlyReportEnabled: boolean;  // default true
}

export const DEFAULT_SEO_GUARDIAN_CONFIG: SeoGuardianConfig = {
  peakSeasonEndMonth: 10,
  guardianStartMonth: 11,
  guardianEndMonth: 12,
  postsPerWeek: 2,
  guardianContentTypes: ["community", "history", "holiday_anticipation", "local_highlight"],
  reviewResponseEnabled: true,
  monthlyReportEnabled: true,
};

export const reviewResponsesTable = sqliteTable("review_responses", {
  id: text().primaryKey().$defaultFn(() => `rr_${createId()}`).notNull(),
  restaurantId: text("restaurant_id").references(() => restaurantsTable.id, { onDelete: "cascade" }).notNull(),
  reviewId: text("review_id").notNull(), // Google Review ID
  reviewText: text("review_text").notNull(),
  reviewRating: integer("review_rating").notNull(),
  reviewerName: text("reviewer_name").notNull(),
  aiResponse: text("ai_response"), // null if AI call failed
  fallbackUsed: integer("fallback_used", { mode: "boolean" }).default(false),
  status: text("status", { enum: ["drafted", "approved", "rejected", "published"] }).default("drafted").notNull(),
  approvedAt: integer("approved_at", { mode: "timestamp" }),
  publishedAt: integer("published_at", { mode: "timestamp" }),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
}, (table) => ([
  index("rr_restaurant_status_idx").on(table.restaurantId, table.status),
  index("rr_review_id_idx").on(table.reviewId),
]));

export const guardianReportsTable = sqliteTable("guardian_reports", {
  id: text().primaryKey().$defaultFn(() => `gr_${createId()}`).notNull(),
  restaurantId: text("restaurant_id").references(() => restaurantsTable.id, { onDelete: "cascade" }).notNull(),
  reportMonth: integer("report_month").notNull(), // YYYYMM format (e.g., 202611)
  rankingStability: text("ranking_stability", { enum: ["stable", "slight_decline", "significant_decline"] }).notNull(),
  reviewCoverage: text("review_coverage", { mode: "json" }).$type<ReviewCoverage>().notNull(),
  decayAvoided: text("decay_avoided").notNull(), // human-readable description
  postsPublished: integer("posts_published").default(0).notNull(),
  generatedAt: integer("generated_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
}, (table) => ([
  index("gr_restaurant_month_idx").on(table.restaurantId, table.reportMonth),
  unique("gr_restaurant_month_unique").on(table.restaurantId, table.reportMonth),
]));

export interface ReviewCoverage {
  drafted: number;
  approved: number;
  published: number;
  total: number;
}

// oxlint-disable-next-line project/no-unused-module-exports
export type ReviewResponse = InferSelectModel<typeof reviewResponsesTable>;
// oxlint-disable-next-line project/no-unused-module-exports
export type GuardianReport = InferSelectModel<typeof guardianReportsTable>;

// ─── Hibernate Tier (Story 7.5) ──────────────────────────

export interface ReactivationEligibility {
  campaignsGenerated: number;
  lastCampaignAt: string | null; // ISO date
  r2AssetCount: number;
  r2TotalSizeBytes: number;
  hasBrandPersona: boolean;
  connectedPlatforms: string[]; // ['instagram', 'facebook', 'gbp']
  eligibleForReactivation: boolean; // true unless data was purged
  reactivationGracePeriodEnds: string | null; // ISO date
}
