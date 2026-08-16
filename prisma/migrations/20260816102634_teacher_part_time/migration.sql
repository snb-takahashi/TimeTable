-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Teacher" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "isPartTime" BOOLEAN NOT NULL DEFAULT false,
    "organizationId" TEXT NOT NULL,
    CONSTRAINT "Teacher_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_Teacher" ("id", "name", "organizationId") SELECT "id", "name", "organizationId" FROM "Teacher";
DROP TABLE "Teacher";
ALTER TABLE "new_Teacher" RENAME TO "Teacher";
CREATE UNIQUE INDEX "Teacher_organizationId_name_key" ON "Teacher"("organizationId", "name");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
