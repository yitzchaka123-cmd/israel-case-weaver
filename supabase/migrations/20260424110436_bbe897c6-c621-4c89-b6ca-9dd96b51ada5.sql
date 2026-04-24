DROP POLICY IF EXISTS "Auth all insert claude_skills" ON public.claude_skills;
DROP POLICY IF EXISTS "Auth all update claude_skills" ON public.claude_skills;
DROP POLICY IF EXISTS "Auth all delete claude_skills" ON public.claude_skills;

CREATE POLICY "Admins insert claude_skills"
ON public.claude_skills
FOR INSERT
TO authenticated
WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins update claude_skills"
ON public.claude_skills
FOR UPDATE
TO authenticated
USING (public.has_role(auth.uid(), 'admin'))
WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins delete claude_skills"
ON public.claude_skills
FOR DELETE
TO authenticated
USING (public.has_role(auth.uid(), 'admin'));