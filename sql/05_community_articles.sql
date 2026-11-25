-- Everside: community articles (the Blog)
-- Members write articles. Every new article, and every edit, waits for Everside to approve it.
-- The writer chooses who can read it: "public" (anyone, including the website) or "members" (signed in members only).
-- Non members can still see the title and summary of a members only article, through blog_cards.
-- Safe to run twice. Run it in the Supabase SQL Editor after 01 and 02.

-- 1. Tables ---------------------------------------------------------------
create table if not exists public.blog_posts (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  author_name   text not null check (char_length(author_name) between 1 and 60),
  title         text not null check (char_length(title) between 5 and 140),
  summary       text not null check (char_length(summary) between 10 and 300),
  body          text not null check (char_length(body) between 50 and 20000),
  tag           text not null check (tag in ('EHCP','Tribunals','School placements','Wellbeing','Parent stories')),
  visibility    text not null default 'members' check (visibility in ('public','members')),
  status        text not null default 'pending' check (status in ('pending','published','rejected')),
  review_note   text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  published_at  timestamptz
);
create index if not exists blog_posts_status_idx on public.blog_posts (status, published_at desc);
create index if not exists blog_posts_user_idx on public.blog_posts (user_id);

create table if not exists public.blog_reports (
  id          uuid primary key default gen_random_uuid(),
  post_id     uuid not null references public.blog_posts(id) on delete cascade,
  user_id     uuid references auth.users(id) on delete set null,
  reason      text not null check (char_length(reason) between 3 and 500),
  resolved    boolean not null default false,
  created_at  timestamptz not null default now(),
  unique (post_id, user_id)
);

-- People allowed to approve articles. Add yourself once:
--   insert into public.blog_admins (user_id) select id from auth.users where email = 'info@ever-side.co.uk';
create table if not exists public.blog_admins (
  user_id uuid primary key references auth.users(id) on delete cascade
);

create or replace function public.is_blog_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.blog_admins where user_id = auth.uid());
$$;
revoke all on function public.is_blog_admin() from public, anon;
grant execute on function public.is_blog_admin() to authenticated;

-- 2. Writers cannot publish their own work ----------------------------------
-- On insert: always pending. On any edit by the writer: back to pending, so it is checked again.
-- That covers a switch from members only to public. Only an admin (through review_blog_post) changes status.
create or replace function public.blog_posts_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if current_setting('everside.blog_review', true) = 'on' then
    return new;  -- set only inside review_blog_post
  end if;
  if tg_op = 'INSERT' then
    new.user_id := auth.uid();
    new.status := 'pending';
    new.review_note := null;
    new.published_at := null;
    new.created_at := now();
  else
    new.user_id := old.user_id;
    new.created_at := old.created_at;
    new.status := 'pending';
    new.review_note := null;
    new.published_at := null;
  end if;
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists blog_posts_guard on public.blog_posts;
create trigger blog_posts_guard before insert or update on public.blog_posts
  for each row execute function public.blog_posts_guard();

-- 3. Row level security --------------------------------------------------
alter table public.blog_posts  enable row level security;
alter table public.blog_reports enable row level security;
alter table public.blog_admins  enable row level security;

revoke all on public.blog_posts, public.blog_reports, public.blog_admins from anon, authenticated;
grant select on public.blog_posts to anon;
grant select, insert, update, delete on public.blog_posts to authenticated;
grant insert on public.blog_reports to authenticated;
grant select, update on public.blog_reports to authenticated;   -- limited to admins by the policies below

drop policy if exists blog_public_read on public.blog_posts;
create policy blog_public_read on public.blog_posts for select to anon
  using (status = 'published' and visibility = 'public');

drop policy if exists blog_member_read on public.blog_posts;
create policy blog_member_read on public.blog_posts for select to authenticated
  using (status = 'published' or user_id = auth.uid() or public.is_blog_admin());

drop policy if exists blog_own_insert on public.blog_posts;
create policy blog_own_insert on public.blog_posts for insert to authenticated
  with check (user_id = auth.uid());

drop policy if exists blog_own_update on public.blog_posts;
create policy blog_own_update on public.blog_posts for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists blog_own_delete on public.blog_posts;
create policy blog_own_delete on public.blog_posts for delete to authenticated
  using (user_id = auth.uid() or public.is_blog_admin());

drop policy if exists blog_report_insert on public.blog_reports;
create policy blog_report_insert on public.blog_reports for insert to authenticated
  with check (user_id = auth.uid());

drop policy if exists blog_report_admin_read on public.blog_reports;
create policy blog_report_admin_read on public.blog_reports for select to authenticated
  using (public.is_blog_admin());

drop policy if exists blog_report_admin_update on public.blog_reports;
create policy blog_report_admin_update on public.blog_reports for update to authenticated
  using (public.is_blog_admin()) with check (public.is_blog_admin());

-- 4. Teaser list for everyone (the website and the app) ---------------------
-- Title, summary, tag, author and date of every published article. No body.
-- The full text of a members only article needs a signed in member (policy above).
create or replace view public.blog_cards with (security_invoker = false) as
  select id, author_name, title, summary, tag, visibility, published_at
  from public.blog_posts
  where status = 'published';
revoke all on public.blog_cards from public;
grant select on public.blog_cards to anon, authenticated;

-- 5. Approve, reject or unpublish (admins only) ----------------------------
create or replace function public.review_blog_post(p_id uuid, p_status text, p_note text default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_blog_admin() then raise exception 'Not allowed'; end if;
  if p_status not in ('published','rejected','pending') then raise exception 'Bad status'; end if;
  perform set_config('everside.blog_review', 'on', true);
  update public.blog_posts
     set status = p_status,
         review_note = p_note,
         published_at = case when p_status = 'published' then now() else null end
   where id = p_id;
  perform set_config('everside.blog_review', 'off', true);
end $$;
revoke all on function public.review_blog_post(uuid, text, text) from public, anon;
grant execute on function public.review_blog_post(uuid, text, text) to authenticated;
