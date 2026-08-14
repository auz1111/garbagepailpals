-- ServiceJob is fully retired: the customer calendar is computed on demand from
-- each location's schedule, and RouteStop is the single record of real work.
-- There was no COMPLETED history to preserve (all completions already live on
-- RouteStop), so this simply drops the now-dormant table and its enums.
DROP TABLE IF EXISTS "ServiceJob";
DROP TYPE IF EXISTS "ServiceJobStatus";
DROP TYPE IF EXISTS "ServiceJobType";
