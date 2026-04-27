-- Add anchor_reference_url to preserve the original first-generated reference
-- image even when the user picks a different final image from the slot's reel.
-- Sibling generations always lock to anchor_reference_url (if set), so
-- swapping the anchor's "displayed final" image never breaks group consistency.
ALTER TABLE public.document_inline_images
  ADD COLUMN IF NOT EXISTS anchor_reference_url text;

COMMENT ON COLUMN public.document_inline_images.anchor_reference_url IS
  'For anchor slots: the URL of the very first generated image. Used as the locked reference for sibling generations. Never overwritten when the user picks a different final image from the history reel.';