-- Trade Center follow-up: pin the search path on three helpers from
-- 20261025200000_trade_center.sql, like every other trade function.
--
-- Supabase's security advisor flagged them (function_search_path_mutable).
-- None of them reads a table, and two only the server can call, so nothing
-- could take advantage of it; this keeps it that way. Safe to run more than
-- once, and it changes no behavior.

alter function public.trade_regular_price(integer, integer, boolean) set search_path to 'public';
alter function public.trade_require_service_role() set search_path to 'public';
alter function public.trade_deposit_after_close(text, text) set search_path to 'public';
