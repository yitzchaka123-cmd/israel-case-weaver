-- Switch the assistant default model to ChatGPT 5.2 across the workspace.
ALTER TABLE public.profiles ALTER COLUMN ai_provider_planning SET DEFAULT 'openai-5.2';
ALTER TABLE public.projects ALTER COLUMN ai_provider_planning SET DEFAULT 'openai-5.2';

-- Backfill: any project still on the legacy 'lovable' default or NULL flips to openai-5.2.
UPDATE public.projects SET ai_provider_planning = 'openai-5.2' WHERE ai_provider_planning IS NULL OR ai_provider_planning = 'lovable';

-- Backfill: profiles still on the legacy 'lovable' default flip to openai-5.2.
UPDATE public.profiles SET ai_provider_planning = 'openai-5.2' WHERE ai_provider_planning = 'lovable';