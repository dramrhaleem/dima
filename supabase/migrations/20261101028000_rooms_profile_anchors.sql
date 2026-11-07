-- B5 observed deadlock repair. Repeated Room/member updates can recheck an unchanged
-- Auth FK while holding Room, conflicting with another actor's Account -> Room lock.
-- Stable profile PKs preserve identity and are KEY SHARE-compatible with ordinary
-- B1 non-key profile updates. Existing Account -> Room -> Run ordering stays intact.
-- Direct client profile deletion is not granted. Future account deletion must first
-- detach deferred current-host/current-run references in the prescribed lock order,
-- then apply Auth -> profile cascades. These FK actions alone do not prove that flow.
DO $$
BEGIN
 IF EXISTS(SELECT 1 FROM public.rooms r LEFT JOIN public.account_profiles p ON p.user_id=r.owner_id
  WHERE r.owner_id IS NOT NULL AND p.user_id IS NULL) THEN
  RAISE EXCEPTION 'B5_OWNER_PROFILE_ANCHOR_MISSING';
 END IF;
 IF EXISTS(SELECT 1 FROM public.room_memberships m LEFT JOIN public.account_profiles p ON p.user_id=m.user_id
  WHERE p.user_id IS NULL) THEN
  RAISE EXCEPTION 'B5_MEMBER_PROFILE_ANCHOR_MISSING';
 END IF;
END $$;
ALTER TABLE public.rooms DROP CONSTRAINT rooms_owner_id_fkey;
ALTER TABLE public.rooms ADD CONSTRAINT rooms_owner_id_fkey
 FOREIGN KEY(owner_id) REFERENCES public.account_profiles(user_id) ON DELETE SET NULL;
ALTER TABLE public.room_memberships DROP CONSTRAINT room_memberships_user_id_fkey;
ALTER TABLE public.room_memberships ADD CONSTRAINT room_memberships_user_id_fkey
 FOREIGN KEY(user_id) REFERENCES public.account_profiles(user_id) ON DELETE CASCADE;
