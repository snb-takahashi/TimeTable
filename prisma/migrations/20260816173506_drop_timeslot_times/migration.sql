-- Remove startTime/endTime from TimeSlot; the schedule is identified by
-- dayOfWeek + periodNumber only.
ALTER TABLE "TimeSlot" DROP COLUMN "startTime";
ALTER TABLE "TimeSlot" DROP COLUMN "endTime";
