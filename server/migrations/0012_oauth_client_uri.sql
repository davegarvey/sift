ALTER TABLE oauth_clients ADD COLUMN client_uri TEXT;
ALTER TABLE oauth_requests ADD COLUMN redirect_url TEXT;
