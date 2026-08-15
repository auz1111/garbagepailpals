-- Retire the trash-only ServiceSchedule table. The generic LocationService /
-- ServiceDay model is now the single source of truth; every reader projects the
-- legacy per-day shape from it at read time (schedulesFromServices).
DROP TABLE IF EXISTS "ServiceSchedule";
