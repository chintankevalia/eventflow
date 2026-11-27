-- CreateEnum
CREATE TYPE "LookupKind" AS ENUM ('PARTNER_TIER', 'COLLABORATION_MODEL', 'REGION', 'INDUSTRY', 'PRODUCT_FOCUS', 'EVENT_FORMAT');

-- CreateEnum
CREATE TYPE "OrganizationType" AS ENUM ('CUSTOMER', 'PARTNER', 'DISTRIBUTOR');

-- CreateEnum
CREATE TYPE "OrganizationStatus" AS ENUM ('ACTIVE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "FormSection" AS ENUM ('BASIC_DETAILS', 'STAKEHOLDERS', 'BUDGET', 'PLANNING', 'POST_EVENT');

-- CreateEnum
CREATE TYPE "FieldType" AS ENUM ('TEXT', 'TEXTAREA', 'NUMBER', 'CURRENCY', 'DATE', 'SELECT', 'MULTISELECT', 'CHECKBOX', 'URL', 'EMAIL', 'PHONE');

-- CreateTable
CREATE TABLE "lookup_items" (
    "id" TEXT NOT NULL,
    "kind" "LookupKind" NOT NULL,
    "value" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "lookup_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "organizations" (
    "id" TEXT NOT NULL,
    "type" "OrganizationType" NOT NULL,
    "name" TEXT NOT NULL,
    "tierId" TEXT,
    "website" TEXT,
    "city" TEXT,
    "notes" TEXT,
    "status" "OrganizationStatus" NOT NULL DEFAULT 'ACTIVE',
    "hubspotId" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "organizations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contacts" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "jobTitle" TEXT,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "status" "OrganizationStatus" NOT NULL DEFAULT 'ACTIVE',
    "hubspotId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "contacts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "event_types" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "needsPartner" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "event_types_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "event_subtypes" (
    "id" TEXT NOT NULL,
    "eventTypeId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "event_subtypes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "expense_categories" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "expense_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "form_fields" (
    "id" TEXT NOT NULL,
    "section" "FormSection" NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "type" "FieldType" NOT NULL,
    "helpText" TEXT,
    "options" JSONB,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "form_fields_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "field_rules" (
    "id" TEXT NOT NULL,
    "eventTypeId" TEXT NOT NULL,
    "fieldKey" TEXT NOT NULL,
    "tierValue" TEXT NOT NULL DEFAULT '',
    "required" BOOLEAN NOT NULL DEFAULT false,
    "visible" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "field_rules_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "lookup_items_kind_active_sortOrder_idx" ON "lookup_items"("kind", "active", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "lookup_items_kind_value_key" ON "lookup_items"("kind", "value");

-- CreateIndex
CREATE UNIQUE INDEX "organizations_hubspotId_key" ON "organizations"("hubspotId");

-- CreateIndex
CREATE INDEX "organizations_type_status_idx" ON "organizations"("type", "status");

-- CreateIndex
CREATE INDEX "organizations_name_idx" ON "organizations"("name");

-- CreateIndex
CREATE UNIQUE INDEX "contacts_hubspotId_key" ON "contacts"("hubspotId");

-- CreateIndex
CREATE INDEX "contacts_organizationId_status_idx" ON "contacts"("organizationId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "event_types_key_key" ON "event_types"("key");

-- CreateIndex
CREATE UNIQUE INDEX "event_subtypes_eventTypeId_name_key" ON "event_subtypes"("eventTypeId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "expense_categories_name_key" ON "expense_categories"("name");

-- CreateIndex
CREATE UNIQUE INDEX "form_fields_key_key" ON "form_fields"("key");

-- CreateIndex
CREATE INDEX "form_fields_section_active_sortOrder_idx" ON "form_fields"("section", "active", "sortOrder");

-- CreateIndex
CREATE INDEX "field_rules_eventTypeId_idx" ON "field_rules"("eventTypeId");

-- CreateIndex
CREATE UNIQUE INDEX "field_rules_eventTypeId_fieldKey_tierValue_key" ON "field_rules"("eventTypeId", "fieldKey", "tierValue");

-- AddForeignKey
ALTER TABLE "organizations" ADD CONSTRAINT "organizations_tierId_fkey" FOREIGN KEY ("tierId") REFERENCES "lookup_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "organizations" ADD CONSTRAINT "organizations_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_subtypes" ADD CONSTRAINT "event_subtypes_eventTypeId_fkey" FOREIGN KEY ("eventTypeId") REFERENCES "event_types"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "field_rules" ADD CONSTRAINT "field_rules_eventTypeId_fkey" FOREIGN KEY ("eventTypeId") REFERENCES "event_types"("id") ON DELETE CASCADE ON UPDATE CASCADE;
