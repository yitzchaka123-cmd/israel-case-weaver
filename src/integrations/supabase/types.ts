export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      canvas_edges: {
        Row: {
          board: string
          created_at: string
          id: string
          label: string | null
          project_id: string
          source_id: string
          target_id: string
        }
        Insert: {
          board?: string
          created_at?: string
          id?: string
          label?: string | null
          project_id: string
          source_id: string
          target_id: string
        }
        Update: {
          board?: string
          created_at?: string
          id?: string
          label?: string | null
          project_id?: string
          source_id?: string
          target_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "canvas_edges_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "canvas_edges_source_id_fkey"
            columns: ["source_id"]
            isOneToOne: false
            referencedRelation: "canvas_nodes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "canvas_edges_target_id_fkey"
            columns: ["target_id"]
            isOneToOne: false
            referencedRelation: "canvas_nodes"
            referencedColumns: ["id"]
          },
        ]
      }
      canvas_nodes: {
        Row: {
          board: string
          color: string | null
          created_at: string
          created_by_message_id: string | null
          data: Json
          description: string | null
          height: number | null
          id: string
          locked: boolean
          node_type: string
          position_x: number
          position_y: number
          project_id: string
          title: string
          updated_at: string
          width: number | null
        }
        Insert: {
          board?: string
          color?: string | null
          created_at?: string
          created_by_message_id?: string | null
          data?: Json
          description?: string | null
          height?: number | null
          id?: string
          locked?: boolean
          node_type?: string
          position_x?: number
          position_y?: number
          project_id: string
          title?: string
          updated_at?: string
          width?: number | null
        }
        Update: {
          board?: string
          color?: string | null
          created_at?: string
          created_by_message_id?: string | null
          data?: Json
          description?: string | null
          height?: number | null
          id?: string
          locked?: boolean
          node_type?: string
          position_x?: number
          position_y?: number
          project_id?: string
          title?: string
          updated_at?: string
          width?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "canvas_nodes_created_by_message_id_fkey"
            columns: ["created_by_message_id"]
            isOneToOne: false
            referencedRelation: "chat_messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "canvas_nodes_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      chat_messages: {
        Row: {
          content: string
          created_at: string
          id: string
          metadata: Json | null
          project_id: string
          role: string
        }
        Insert: {
          content: string
          created_at?: string
          id?: string
          metadata?: Json | null
          project_id: string
          role: string
        }
        Update: {
          content?: string
          created_at?: string
          id?: string
          metadata?: Json | null
          project_id?: string
          role?: string
        }
        Relationships: [
          {
            foreignKeyName: "chat_messages_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      company_profiles: {
        Row: {
          address: string | null
          age_rating: string | null
          company_name: string | null
          country: string | null
          created_at: string
          legal_text: string | null
          logo_url: string | null
          made_in: string | null
          owner_id: string
          social: Json
          support_email: string | null
          tagline: string | null
          updated_at: string
          website: string | null
        }
        Insert: {
          address?: string | null
          age_rating?: string | null
          company_name?: string | null
          country?: string | null
          created_at?: string
          legal_text?: string | null
          logo_url?: string | null
          made_in?: string | null
          owner_id: string
          social?: Json
          support_email?: string | null
          tagline?: string | null
          updated_at?: string
          website?: string | null
        }
        Update: {
          address?: string | null
          age_rating?: string | null
          company_name?: string | null
          country?: string | null
          created_at?: string
          legal_text?: string | null
          logo_url?: string | null
          made_in?: string | null
          owner_id?: string
          social?: Json
          support_email?: string | null
          tagline?: string | null
          updated_at?: string
          website?: string | null
        }
        Relationships: []
      }
      documents: {
        Row: {
          active_version: string
          created_at: string
          created_by_message_id: string | null
          design_instructions: string | null
          doc_number: number | null
          doc_type: string | null
          envelope_number: number | null
          generated_asset_url: string | null
          hebrew_content: string | null
          id: string
          linked_node_ids: string[] | null
          linked_suspect_ids: string[] | null
          print_size: string | null
          project_id: string
          status: string
          title: string
          updated_at: string
          uploaded_asset_url: string | null
        }
        Insert: {
          active_version?: string
          created_at?: string
          created_by_message_id?: string | null
          design_instructions?: string | null
          doc_number?: number | null
          doc_type?: string | null
          envelope_number?: number | null
          generated_asset_url?: string | null
          hebrew_content?: string | null
          id?: string
          linked_node_ids?: string[] | null
          linked_suspect_ids?: string[] | null
          print_size?: string | null
          project_id: string
          status?: string
          title?: string
          updated_at?: string
          uploaded_asset_url?: string | null
        }
        Update: {
          active_version?: string
          created_at?: string
          created_by_message_id?: string | null
          design_instructions?: string | null
          doc_number?: number | null
          doc_type?: string | null
          envelope_number?: number | null
          generated_asset_url?: string | null
          hebrew_content?: string | null
          id?: string
          linked_node_ids?: string[] | null
          linked_suspect_ids?: string[] | null
          print_size?: string | null
          project_id?: string
          status?: string
          title?: string
          updated_at?: string
          uploaded_asset_url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "documents_created_by_message_id_fkey"
            columns: ["created_by_message_id"]
            isOneToOne: false
            referencedRelation: "chat_messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "documents_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      drive_backup_log: {
        Row: {
          asset_id: string
          asset_kind: string
          drive_file_id: string
          id: string
          project_id: string
          uploaded_at: string
          user_id: string
        }
        Insert: {
          asset_id: string
          asset_kind: string
          drive_file_id: string
          id?: string
          project_id: string
          uploaded_at?: string
          user_id: string
        }
        Update: {
          asset_id?: string
          asset_kind?: string
          drive_file_id?: string
          id?: string
          project_id?: string
          uploaded_at?: string
          user_id?: string
        }
        Relationships: []
      }
      envelopes: {
        Row: {
          cover_image_url: string | null
          created_at: string
          created_by_message_id: string | null
          design_instructions: string | null
          id: string
          label: string | null
          linked_document_ids: string[] | null
          linked_node_ids: string[] | null
          notes: string | null
          number: number
          project_id: string
          status: string
          task: string | null
          updated_at: string
        }
        Insert: {
          cover_image_url?: string | null
          created_at?: string
          created_by_message_id?: string | null
          design_instructions?: string | null
          id?: string
          label?: string | null
          linked_document_ids?: string[] | null
          linked_node_ids?: string[] | null
          notes?: string | null
          number: number
          project_id: string
          status?: string
          task?: string | null
          updated_at?: string
        }
        Update: {
          cover_image_url?: string | null
          created_at?: string
          created_by_message_id?: string | null
          design_instructions?: string | null
          id?: string
          label?: string | null
          linked_document_ids?: string[] | null
          linked_node_ids?: string[] | null
          notes?: string | null
          number?: number
          project_id?: string
          status?: string
          task?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "envelopes_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      hints: {
        Row: {
          created_at: string
          id: string
          level: number
          project_id: string
          stage: number
          text: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          level: number
          project_id: string
          stage: number
          text?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          level?: number
          project_id?: string
          stage?: number
          text?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "hints_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      invite_codes: {
        Row: {
          code: string
          created_at: string
          created_by: string | null
          expires_at: string | null
          id: string
          label: string | null
          max_uses: number | null
          revoked_at: string | null
          uses: number
        }
        Insert: {
          code: string
          created_at?: string
          created_by?: string | null
          expires_at?: string | null
          id?: string
          label?: string | null
          max_uses?: number | null
          revoked_at?: string | null
          uses?: number
        }
        Update: {
          code?: string
          created_at?: string
          created_by?: string | null
          expires_at?: string | null
          id?: string
          label?: string | null
          max_uses?: number | null
          revoked_at?: string | null
          uses?: number
        }
        Relationships: []
      }
      media_assets: {
        Row: {
          category: string
          created_at: string
          id: string
          mime_type: string | null
          model: string | null
          project_id: string
          prompt: string | null
          provider: string | null
          title: string | null
          url: string | null
        }
        Insert: {
          category?: string
          created_at?: string
          id?: string
          mime_type?: string | null
          model?: string | null
          project_id: string
          prompt?: string | null
          provider?: string | null
          title?: string | null
          url?: string | null
        }
        Update: {
          category?: string
          created_at?: string
          id?: string
          mime_type?: string | null
          model?: string | null
          project_id?: string
          prompt?: string | null
          provider?: string | null
          title?: string | null
          url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "media_assets_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          ai_provider_documents: string
          ai_provider_images: string
          ai_provider_planning: string
          app_logo_url: string | null
          assistant_playbook: Json
          assistant_tweaks: Json
          avatar_url: string | null
          created_at: string
          display_name: string | null
          id: string
          image_prompt_assistant_instructions: string | null
          theme: string
          updated_at: string
        }
        Insert: {
          ai_provider_documents?: string
          ai_provider_images?: string
          ai_provider_planning?: string
          app_logo_url?: string | null
          assistant_playbook?: Json
          assistant_tweaks?: Json
          avatar_url?: string | null
          created_at?: string
          display_name?: string | null
          id: string
          image_prompt_assistant_instructions?: string | null
          theme?: string
          updated_at?: string
        }
        Update: {
          ai_provider_documents?: string
          ai_provider_images?: string
          ai_provider_planning?: string
          app_logo_url?: string | null
          assistant_playbook?: Json
          assistant_tweaks?: Json
          avatar_url?: string | null
          created_at?: string
          display_name?: string | null
          id?: string
          image_prompt_assistant_instructions?: string | null
          theme?: string
          updated_at?: string
        }
        Relationships: []
      }
      project_marketing: {
        Row: {
          back_body: string | null
          back_cover_url: string | null
          back_headline: string | null
          barcode_url: string | null
          barcode_value: string | null
          copy_origins: Json
          created_at: string
          front_subtext: string | null
          project_id: string
          tagline: string | null
          updated_at: string
        }
        Insert: {
          back_body?: string | null
          back_cover_url?: string | null
          back_headline?: string | null
          barcode_url?: string | null
          barcode_value?: string | null
          copy_origins?: Json
          created_at?: string
          front_subtext?: string | null
          project_id: string
          tagline?: string | null
          updated_at?: string
        }
        Update: {
          back_body?: string | null
          back_cover_url?: string | null
          back_headline?: string | null
          barcode_url?: string | null
          barcode_value?: string | null
          copy_origins?: Json
          created_at?: string
          front_subtext?: string | null
          project_id?: string
          tagline?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      project_notifications: {
        Row: {
          body: string | null
          created_at: string
          created_by: string
          id: string
          kind: string
          project_id: string
          read_at: string | null
          starter_prompt: string | null
          status: string
          title: string
        }
        Insert: {
          body?: string | null
          created_at?: string
          created_by?: string
          id?: string
          kind?: string
          project_id: string
          read_at?: string | null
          starter_prompt?: string | null
          status?: string
          title: string
        }
        Update: {
          body?: string | null
          created_at?: string
          created_by?: string
          id?: string
          kind?: string
          project_id?: string
          read_at?: string | null
          starter_prompt?: string | null
          status?: string
          title?: string
        }
        Relationships: []
      }
      project_storyboards: {
        Row: {
          created_at: string
          id: string
          kling_instructions: string | null
          length_seconds: number
          project_id: string
          script_instructions: string | null
          shots: Json
          sora_instructions: string | null
          status: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          kling_instructions?: string | null
          length_seconds?: number
          project_id: string
          script_instructions?: string | null
          shots?: Json
          sora_instructions?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          kling_instructions?: string | null
          length_seconds?: number
          project_id?: string
          script_instructions?: string | null
          shots?: Json
          sora_instructions?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      projects: {
        Row: {
          ai_provider_documents: string | null
          ai_provider_images: string | null
          ai_provider_planning: string | null
          assistant_origins: Json
          case_goal: string | null
          cover_image_url: string | null
          created_at: string
          difficulty: string | null
          doc_generation_mode: string | null
          envelope_settings: Json
          genre: string | null
          hint_settings: Json
          id: string
          image_prompt_instructions: string | null
          logic_approved_at: string | null
          mystery_type: string | null
          owner_id: string
          packaging_notes: string | null
          phase: string
          player_role: string | null
          selling_point: string | null
          setting: string | null
          solution_summary: string | null
          subtitle: string | null
          target_doc_count: number | null
          title: string
          updated_at: string
          video_prompt_instructions: string | null
          year: number | null
        }
        Insert: {
          ai_provider_documents?: string | null
          ai_provider_images?: string | null
          ai_provider_planning?: string | null
          assistant_origins?: Json
          case_goal?: string | null
          cover_image_url?: string | null
          created_at?: string
          difficulty?: string | null
          doc_generation_mode?: string | null
          envelope_settings?: Json
          genre?: string | null
          hint_settings?: Json
          id?: string
          image_prompt_instructions?: string | null
          logic_approved_at?: string | null
          mystery_type?: string | null
          owner_id: string
          packaging_notes?: string | null
          phase?: string
          player_role?: string | null
          selling_point?: string | null
          setting?: string | null
          solution_summary?: string | null
          subtitle?: string | null
          target_doc_count?: number | null
          title?: string
          updated_at?: string
          video_prompt_instructions?: string | null
          year?: number | null
        }
        Update: {
          ai_provider_documents?: string | null
          ai_provider_images?: string | null
          ai_provider_planning?: string | null
          assistant_origins?: Json
          case_goal?: string | null
          cover_image_url?: string | null
          created_at?: string
          difficulty?: string | null
          doc_generation_mode?: string | null
          envelope_settings?: Json
          genre?: string | null
          hint_settings?: Json
          id?: string
          image_prompt_instructions?: string | null
          logic_approved_at?: string | null
          mystery_type?: string | null
          owner_id?: string
          packaging_notes?: string | null
          phase?: string
          player_role?: string | null
          selling_point?: string | null
          setting?: string | null
          solution_summary?: string | null
          subtitle?: string | null
          target_doc_count?: number | null
          title?: string
          updated_at?: string
          video_prompt_instructions?: string | null
          year?: number | null
        }
        Relationships: []
      }
      prompts: {
        Row: {
          created_at: string
          final_prompt: string | null
          id: string
          model: string | null
          original_prompt: string | null
          project_id: string
          provider: string | null
          revised_prompt: string | null
          scope: string
          target_id: string | null
        }
        Insert: {
          created_at?: string
          final_prompt?: string | null
          id?: string
          model?: string | null
          original_prompt?: string | null
          project_id: string
          provider?: string | null
          revised_prompt?: string | null
          scope: string
          target_id?: string | null
        }
        Update: {
          created_at?: string
          final_prompt?: string | null
          id?: string
          model?: string | null
          original_prompt?: string | null
          project_id?: string
          provider?: string | null
          revised_prompt?: string | null
          scope?: string
          target_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "prompts_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      suspects: {
        Row: {
          alt_thumbnail_url: string | null
          contradictions: string | null
          created_at: string
          created_by_message_id: string | null
          id: string
          is_red_herring: boolean
          motives: string | null
          name: string
          position: number
          project_id: string
          role_in_case: string | null
          secrets: string | null
          summary: string | null
          thumbnail_url: string | null
          updated_at: string
        }
        Insert: {
          alt_thumbnail_url?: string | null
          contradictions?: string | null
          created_at?: string
          created_by_message_id?: string | null
          id?: string
          is_red_herring?: boolean
          motives?: string | null
          name?: string
          position?: number
          project_id: string
          role_in_case?: string | null
          secrets?: string | null
          summary?: string | null
          thumbnail_url?: string | null
          updated_at?: string
        }
        Update: {
          alt_thumbnail_url?: string | null
          contradictions?: string | null
          created_at?: string
          created_by_message_id?: string | null
          id?: string
          is_red_herring?: boolean
          motives?: string | null
          name?: string
          position?: number
          project_id?: string
          role_in_case?: string | null
          secrets?: string | null
          summary?: string | null
          thumbnail_url?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "suspects_created_by_message_id_fkey"
            columns: ["created_by_message_id"]
            isOneToOne: false
            referencedRelation: "chat_messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "suspects_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      user_access: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          created_at: string
          display_name: string | null
          email: string | null
          invite_code_id: string | null
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string
          display_name?: string | null
          email?: string | null
          invite_code_id?: string | null
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string
          display_name?: string | null
          email?: string | null
          invite_code_id?: string | null
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_access_invite_code_id_fkey"
            columns: ["invite_code_id"]
            isOneToOne: false
            referencedRelation: "invite_codes"
            referencedColumns: ["id"]
          },
        ]
      }
      user_google_drive_connections: {
        Row: {
          access_token: string | null
          auto_backup_enabled: boolean
          connected_at: string
          google_email: string | null
          last_error: string | null
          last_synced_at: string | null
          refresh_token: string | null
          root_folder_id: string | null
          scope: string | null
          token_expires_at: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          access_token?: string | null
          auto_backup_enabled?: boolean
          connected_at?: string
          google_email?: string | null
          last_error?: string | null
          last_synced_at?: string | null
          refresh_token?: string | null
          root_folder_id?: string | null
          scope?: string | null
          token_expires_at?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          access_token?: string | null
          auto_backup_enabled?: boolean
          connected_at?: string
          google_email?: string | null
          last_error?: string | null
          last_synced_at?: string | null
          refresh_token?: string | null
          root_folder_id?: string | null
          scope?: string | null
          token_expires_at?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      admin_set_role: {
        Args: {
          p_grant: boolean
          p_role: Database["public"]["Enums"]["app_role"]
          p_user_id: string
        }
        Returns: undefined
      }
      admin_set_user_status: {
        Args: { p_status: string; p_user_id: string }
        Returns: undefined
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      redeem_invite_code: { Args: { p_code: string }; Returns: Json }
    }
    Enums: {
      app_role: "admin" | "member"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: ["admin", "member"],
    },
  },
} as const
