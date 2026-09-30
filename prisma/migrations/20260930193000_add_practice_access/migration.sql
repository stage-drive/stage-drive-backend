-- CreateEnum
CREATE TYPE "LicenseCategory" AS ENUM ('A', 'B', 'C', 'D');

-- CreateEnum
CREATE TYPE "Transmission" AS ENUM ('MANUAL', 'AUTOMATIC');

-- AlterEnum
ALTER TYPE "TrainingStatus" ADD VALUE 'PRACTICE' AFTER 'ACTIVE';

-- AlterTable
ALTER TABLE "students" ADD COLUMN "category" "LicenseCategory",
ADD COLUMN "transmission" "Transmission";

-- CreateTable
CREATE TABLE "cars" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "instructor_id" UUID NOT NULL,
    "plate_number" VARCHAR(16) NOT NULL,
    "category" "LicenseCategory" NOT NULL,
    "transmission" "Transmission" NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cars_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "cars_organization_id_plate_number_key" ON "cars"("organization_id", "plate_number");

-- CreateIndex
CREATE INDEX "cars_organization_id_idx" ON "cars"("organization_id");

-- CreateIndex
CREATE INDEX "cars_instructor_id_idx" ON "cars"("instructor_id");

-- CreateIndex
CREATE INDEX "students_car_id_idx" ON "students"("car_id");

-- AddForeignKey
ALTER TABLE "cars" ADD CONSTRAINT "cars_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cars" ADD CONSTRAINT "cars_instructor_id_fkey" FOREIGN KEY ("instructor_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "students" ADD CONSTRAINT "students_car_id_fkey" FOREIGN KEY ("car_id") REFERENCES "cars"("id") ON DELETE SET NULL ON UPDATE CASCADE;
