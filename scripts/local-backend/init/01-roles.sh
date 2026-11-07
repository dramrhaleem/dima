#!/bin/sh
set -eu
psql -v ON_ERROR_STOP=1 --username postgres --dbname postgres -v local_password="$POSTGRES_PASSWORD" <<'SQL'
CREATE ROLE anon NOLOGIN NOINHERIT;
CREATE ROLE authenticated NOLOGIN NOINHERIT;
CREATE ROLE service_role NOLOGIN NOINHERIT BYPASSRLS;
CREATE ROLE authenticator LOGIN NOINHERIT PASSWORD :'local_password';
CREATE ROLE supabase_auth_admin LOGIN NOINHERIT CREATEROLE PASSWORD :'local_password';
GRANT anon, authenticated, service_role TO authenticator;
CREATE SCHEMA auth AUTHORIZATION supabase_auth_admin;
ALTER ROLE supabase_auth_admin SET search_path TO auth;
GRANT USAGE ON SCHEMA public TO anon, authenticated;
GRANT USAGE ON SCHEMA auth TO anon, authenticated;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('request.jwt.claims', true)::jsonb ->> 'sub', '')::uuid
$$;
ALTER FUNCTION auth.uid() OWNER TO supabase_auth_admin;
GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
SQL
