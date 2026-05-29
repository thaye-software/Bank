-- Remove the AI Loan Assessment Agent columns from loan_applications.
-- The feature was removed entirely; these columns are no longer written or read.
-- AlterTable
ALTER TABLE "loan_applications" DROP COLUMN "assessmentRiskLevel",
DROP COLUMN "assessmentSummary",
DROP COLUMN "assessmentWatchPoints";
