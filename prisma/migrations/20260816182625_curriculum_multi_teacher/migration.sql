-- Allow a (class, subject) pair to have multiple CurriculumRequirement rows
-- when the subject is team-taught by more than one teacher.
DROP INDEX "CurriculumRequirement_classGroupId_subjectId_key";
CREATE UNIQUE INDEX "CurriculumRequirement_classGroupId_subjectId_teacherId_key" ON "CurriculumRequirement"("classGroupId", "subjectId", "teacherId");
