import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type NotificationStatus = "unread" | "read" | "dismissed";
export type NotificationCreator = "user" | "assistant";

export interface ProjectNotification {
  id: string;
  project_id: string;
  kind: string;
  title: string;
  body: string | null;
  starter_prompt: string | null;
  status: NotificationStatus;
  created_by: NotificationCreator;
  created_at: string;
  read_at: string | null;
  preview_image_url: string | null;
}

export interface NotificationDraft {
  kind: string;
  title: string;
  body?: string | null;
  starter_prompt?: string | null;
  created_by?: NotificationCreator;
}

export function useProjectNotifications(projectId: string) {
  const qc = useQueryClient();

  const { data: notifications = [], isLoading } = useQuery({
    queryKey: ["project-notifications", projectId],
    queryFn: async (): Promise<ProjectNotification[]> => {
      const { data, error } = await supabase
        .from("project_notifications")
        .select("*")
        .eq("project_id", projectId)
        .order("created_at", { ascending: false })
        .limit(200);
      if (error) throw error;
      return (data ?? []) as ProjectNotification[];
    },
  });

  const unreadCount = notifications.filter((n) => n.status === "unread").length;

  const create = useMutation({
    mutationFn: async (draft: NotificationDraft) => {
      const { data, error } = await supabase
        .from("project_notifications")
        .insert({
          project_id: projectId,
          kind: draft.kind,
          title: draft.title,
          body: draft.body ?? null,
          starter_prompt: draft.starter_prompt ?? null,
          created_by: draft.created_by ?? "user",
          status: "unread",
        })
        .select("*")
        .single();
      if (error) throw error;
      return data as ProjectNotification;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["project-notifications", projectId] }),
  });

  const markRead = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("project_notifications")
        .update({ status: "read", read_at: new Date().toISOString() })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["project-notifications", projectId] }),
  });

  const dismiss = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("project_notifications")
        .update({ status: "dismissed" })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["project-notifications", projectId] }),
  });

  const markAllRead = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from("project_notifications")
        .update({ status: "read", read_at: new Date().toISOString() })
        .eq("project_id", projectId)
        .eq("status", "unread");
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["project-notifications", projectId] }),
  });

  const clearDismissed = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from("project_notifications")
        .delete()
        .eq("project_id", projectId)
        .eq("status", "dismissed");
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["project-notifications", projectId] }),
  });

  return {
    notifications,
    unreadCount,
    isLoading,
    create: create.mutate,
    createAsync: create.mutateAsync,
    markRead: markRead.mutate,
    dismiss: dismiss.mutate,
    markAllRead: markAllRead.mutate,
    clearDismissed: clearDismissed.mutate,
  };
}
