-- Two more granular "in progress" statuses, between reviewing and contacted:
-- a submission can stall needing more photos from the seller, or needing an
-- in-person look before staff can make a call. Both are customer-visible
-- (shown on /account/sell-submissions) as well as staff-visible, per the
-- Buying Leads admin workflow.
alter type public.sell_submission_status add value if not exists 'needs_more_photos' after 'reviewing';
alter type public.sell_submission_status add value if not exists 'needs_in_person_review' after 'needs_more_photos';
