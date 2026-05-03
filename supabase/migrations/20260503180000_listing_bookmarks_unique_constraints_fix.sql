-- Schema-Bug: die Constraints "unique nulls not distinct" haben NULLs als
-- gleich behandelt. Folge: Zwei eingeloggte User (beide mit anonymous_id=NULL)
-- konnten nicht beide das gleiche Listing bookmarken — der zweite kriegt
-- "unique_anon_listing" Violation. Symmetrisch das gleiche Problem bei
-- unique_user_listing für anonyme User.
--
-- Fix: Constraints durch partielle Unique-Indices ersetzen, die nur greifen
-- wenn die relevante Spalte NICHT NULL ist.

alter table public.listing_bookmarks
  drop constraint if exists unique_anon_listing,
  drop constraint if exists unique_user_listing;

create unique index if not exists unique_user_listing
  on public.listing_bookmarks (user_id, listing_id)
  where user_id is not null;

create unique index if not exists unique_anon_listing
  on public.listing_bookmarks (anonymous_id, listing_id)
  where anonymous_id is not null;
