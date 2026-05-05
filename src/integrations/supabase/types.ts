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
      ai_run_logs: {
        Row: {
          created_at: string
          effective_model: string | null
          error_message: string | null
          fallback: string
          id: string
          latency_ms: number | null
          master_prompt_version: number | null
          project_id: string | null
          prompt_excerpt: string | null
          requested_model: string | null
          status: string
          surface: string
          surface_prompt_version: number | null
          target_id: string | null
          user_id: string | null
        }
        Insert: {
          created_at?: string
          effective_model?: string | null
          error_message?: string | null
          fallback?: string
          id?: string
          latency_ms?: number | null
          master_prompt_version?: number | null
          project_id?: string | null
          prompt_excerpt?: string | null
          requested_model?: string | null
          status?: string
          surface: string
          surface_prompt_version?: number | null
          target_id?: string | null
          user_id?: string | null
        }
        Update: {
          created_at?: string
          effective_model?: string | null
          error_message?: string | null
          fallback?: string
          id?: string
          latency_ms?: number | null
          master_prompt_version?: number | null
          project_id?: string | null
          prompt_excerpt?: string | null
          requested_model?: string | null
          status?: string
          surface?: string
          surface_prompt_version?: number | null
          target_id?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      assistant_runs: {
        Row: {
          error: string | null
          finished_at: string | null
          id: string
          project_id: string
          started_at: string
          status: string
          user_id: string | null
        }
        Insert: {
          error?: string | null
          finished_at?: string | null
          id?: string
          project_id: string
          started_at?: string
          status?: string
          user_id?: string | null
        }
        Update: {
          error?: string | null
          finished_at?: string | null
          id?: string
          project_id?: string
          started_at?: string
          status?: string
          user_id?: string | null
        }
        Relationships: []
      }
      bulk_generation_jobs: {
        Row: {
          cancel_requested: boolean
          completed: number
          created_by: string | null
          current_doc_id: string | null
          current_doc_title: string | null
          document_format: string | null
          document_ids: string[]
          error: string | null
          failed: number
          finished_at: string | null
          id: string
          last_heartbeat_at: string
          mode: string
          project_id: string
          scope: string
          started_at: string
          status: string
          total: number
        }
        Insert: {
          cancel_requested?: boolean
          completed?: number
          created_by?: string | null
          current_doc_id?: string | null
          current_doc_title?: string | null
          document_format?: string | null
          document_ids?: string[]
          error?: string | null
          failed?: number
          finished_at?: string | null
          id?: string
          last_heartbeat_at?: string
          mode: string
          project_id: string
          scope: string
          started_at?: string
          status?: string
          total?: number
        }
        Update: {
          cancel_requested?: boolean
          completed?: number
          created_by?: string | null
          current_doc_id?: string | null
          current_doc_title?: string | null
          document_format?: string | null
          document_ids?: string[]
          error?: string | null
          failed?: number
          finished_at?: string | null
          id?: string
          last_heartbeat_at?: string
          mode?: string
          project_id?: string
          scope?: string
          started_at?: string
          status?: string
          total?: number
        }
        Relationships: []
      }
      canvas_edges: {
        Row: {
          board: string
          created_at: string
          id: string
          label: string | null
          logic_version_id: string | null
          project_id: string
          source_id: string
          target_id: string
        }
        Insert: {
          board?: string
          created_at?: string
          id?: string
          label?: string | null
          logic_version_id?: string | null
          project_id: string
          source_id: string
          target_id: string
        }
        Update: {
          board?: string
          created_at?: string
          id?: string
          label?: string | null
          logic_version_id?: string | null
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
          logic_version_id: string | null
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
          logic_version_id?: string | null
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
          logic_version_id?: string | null
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
      claude_skills: {
        Row: {
          created_at: string
          description: string | null
          enabled: boolean
          id: string
          install_error: string | null
          install_source: string
          install_status: string
          installed_at: string
          installed_by: string | null
          metadata: Json
          name: string
          notes: string | null
          skill_id: string
          skill_type: string
          updated_at: string
          uploaded_file_url: string | null
          usage_scope: string[]
          version: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          enabled?: boolean
          id?: string
          install_error?: string | null
          install_source?: string
          install_status?: string
          installed_at?: string
          installed_by?: string | null
          metadata?: Json
          name: string
          notes?: string | null
          skill_id: string
          skill_type?: string
          updated_at?: string
          uploaded_file_url?: string | null
          usage_scope?: string[]
          version?: string
        }
        Update: {
          created_at?: string
          description?: string | null
          enabled?: boolean
          id?: string
          install_error?: string | null
          install_source?: string
          install_status?: string
          installed_at?: string
          installed_by?: string | null
          metadata?: Json
          name?: string
          notes?: string | null
          skill_id?: string
          skill_type?: string
          updated_at?: string
          uploaded_file_url?: string | null
          usage_scope?: string[]
          version?: string
        }
        Relationships: []
      }
      company_profiles: {
        Row: {
          address: string | null
          age_rating: string | null
          box_footer_line: string | null
          company_name: string | null
          country: string | null
          created_at: string
          distributed_by: string | null
          legal_text: string | null
          logo_url: string | null
          made_in: string | null
          manufactured_by: string | null
          owner_id: string
          phone: string | null
          social: Json
          support_email: string | null
          tagline: string | null
          updated_at: string
          vat_number: string | null
          warning_text: string | null
          website: string | null
        }
        Insert: {
          address?: string | null
          age_rating?: string | null
          box_footer_line?: string | null
          company_name?: string | null
          country?: string | null
          created_at?: string
          distributed_by?: string | null
          legal_text?: string | null
          logo_url?: string | null
          made_in?: string | null
          manufactured_by?: string | null
          owner_id: string
          phone?: string | null
          social?: Json
          support_email?: string | null
          tagline?: string | null
          updated_at?: string
          vat_number?: string | null
          warning_text?: string | null
          website?: string | null
        }
        Update: {
          address?: string | null
          age_rating?: string | null
          box_footer_line?: string | null
          company_name?: string | null
          country?: string | null
          created_at?: string
          distributed_by?: string | null
          legal_text?: string | null
          logo_url?: string | null
          made_in?: string | null
          manufactured_by?: string | null
          owner_id?: string
          phone?: string | null
          social?: Json
          support_email?: string | null
          tagline?: string | null
          updated_at?: string
          vat_number?: string | null
          warning_text?: string | null
          website?: string | null
        }
        Relationships: []
      }
      document_inline_images: {
        Row: {
          active_version: string
          anchor_image_id: string | null
          anchor_reference_url: string | null
          created_at: string
          created_by_message_id: string | null
          document_id: string
          effective_model: string | null
          error_message: string | null
          fallback: string | null
          group_key: string | null
          id: string
          is_anchor: boolean
          model: string | null
          position: number
          project_id: string
          prompt: string | null
          prompt_history: Json
          provider: string | null
          slot_label: string
          status: string
          updated_at: string
          uploaded_url: string | null
          url: string | null
          url_history: Json
        }
        Insert: {
          active_version?: string
          anchor_image_id?: string | null
          anchor_reference_url?: string | null
          created_at?: string
          created_by_message_id?: string | null
          document_id: string
          effective_model?: string | null
          error_message?: string | null
          fallback?: string | null
          group_key?: string | null
          id?: string
          is_anchor?: boolean
          model?: string | null
          position?: number
          project_id: string
          prompt?: string | null
          prompt_history?: Json
          provider?: string | null
          slot_label?: string
          status?: string
          updated_at?: string
          uploaded_url?: string | null
          url?: string | null
          url_history?: Json
        }
        Update: {
          active_version?: string
          anchor_image_id?: string | null
          anchor_reference_url?: string | null
          created_at?: string
          created_by_message_id?: string | null
          document_id?: string
          effective_model?: string | null
          error_message?: string | null
          fallback?: string | null
          group_key?: string | null
          id?: string
          is_anchor?: boolean
          model?: string | null
          position?: number
          project_id?: string
          prompt?: string | null
          prompt_history?: Json
          provider?: string | null
          slot_label?: string
          status?: string
          updated_at?: string
          uploaded_url?: string | null
          url?: string | null
          url_history?: Json
        }
        Relationships: [
          {
            foreignKeyName: "document_inline_images_anchor_image_id_fkey"
            columns: ["anchor_image_id"]
            isOneToOne: false
            referencedRelation: "document_inline_images"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "document_inline_images_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
        ]
      }
      documents: {
        Row: {
          active_version: string
          created_at: string
          created_by_message_id: string | null
          design_instructions: string | null
          doc_number: number | null
          doc_type: string | null
          document_format: string | null
          document_model: string | null
          document_preview_url: string | null
          document_provider: string | null
          document_skill_id: string | null
          envelope_number: number | null
          generated_asset_url: string | null
          generated_document_url: string | null
          generated_pdf_url: string | null
          hebrew_content: string | null
          id: string
          inline_images_caption: string | null
          inline_images_layout: string | null
          last_generation_error: string | null
          linked_node_ids: string[] | null
          linked_suspect_ids: string[] | null
          logic_version_id: string | null
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
          document_format?: string | null
          document_model?: string | null
          document_preview_url?: string | null
          document_provider?: string | null
          document_skill_id?: string | null
          envelope_number?: number | null
          generated_asset_url?: string | null
          generated_document_url?: string | null
          generated_pdf_url?: string | null
          hebrew_content?: string | null
          id?: string
          inline_images_caption?: string | null
          inline_images_layout?: string | null
          last_generation_error?: string | null
          linked_node_ids?: string[] | null
          linked_suspect_ids?: string[] | null
          logic_version_id?: string | null
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
          document_format?: string | null
          document_model?: string | null
          document_preview_url?: string | null
          document_provider?: string | null
          document_skill_id?: string | null
          envelope_number?: number | null
          generated_asset_url?: string | null
          generated_document_url?: string | null
          generated_pdf_url?: string | null
          hebrew_content?: string | null
          id?: string
          inline_images_caption?: string | null
          inline_images_layout?: string | null
          last_generation_error?: string | null
          linked_node_ids?: string[] | null
          linked_suspect_ids?: string[] | null
          logic_version_id?: string | null
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
      envelopes: {
        Row: {
          cover_effective_model: string | null
          cover_fallback: string | null
          cover_image_url: string | null
          cover_prompt: string | null
          cover_prompt_history: Json
          created_at: string
          created_by_message_id: string | null
          design_instructions: string | null
          id: string
          label: string | null
          linked_document_ids: string[] | null
          linked_node_ids: string[] | null
          logic_version_id: string | null
          notes: string | null
          number: number
          project_id: string
          status: string
          task: string | null
          updated_at: string
        }
        Insert: {
          cover_effective_model?: string | null
          cover_fallback?: string | null
          cover_image_url?: string | null
          cover_prompt?: string | null
          cover_prompt_history?: Json
          created_at?: string
          created_by_message_id?: string | null
          design_instructions?: string | null
          id?: string
          label?: string | null
          linked_document_ids?: string[] | null
          linked_node_ids?: string[] | null
          logic_version_id?: string | null
          notes?: string | null
          number: number
          project_id: string
          status?: string
          task?: string | null
          updated_at?: string
        }
        Update: {
          cover_effective_model?: string | null
          cover_fallback?: string | null
          cover_image_url?: string | null
          cover_prompt?: string | null
          cover_prompt_history?: Json
          created_at?: string
          created_by_message_id?: string | null
          design_instructions?: string | null
          id?: string
          label?: string | null
          linked_document_ids?: string[] | null
          linked_node_ids?: string[] | null
          logic_version_id?: string | null
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
      hint_sheets: {
        Row: {
          active_version: string
          created_at: string
          effective_model: string | null
          fallback: string | null
          id: string
          image_url: string | null
          logic_version_id: string | null
          project_id: string
          prompt: string | null
          prompt_history: Json
          requested_model: string | null
          stage: number
          updated_at: string
          uploaded_image_url: string | null
        }
        Insert: {
          active_version?: string
          created_at?: string
          effective_model?: string | null
          fallback?: string | null
          id?: string
          image_url?: string | null
          logic_version_id?: string | null
          project_id: string
          prompt?: string | null
          prompt_history?: Json
          requested_model?: string | null
          stage: number
          updated_at?: string
          uploaded_image_url?: string | null
        }
        Update: {
          active_version?: string
          created_at?: string
          effective_model?: string | null
          fallback?: string | null
          id?: string
          image_url?: string | null
          logic_version_id?: string | null
          project_id?: string
          prompt?: string | null
          prompt_history?: Json
          requested_model?: string | null
          stage?: number
          updated_at?: string
          uploaded_image_url?: string | null
        }
        Relationships: []
      }
      hints: {
        Row: {
          created_at: string
          id: string
          level: number
          logic_version_id: string | null
          project_id: string
          stage: number
          text: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          level: number
          logic_version_id?: string | null
          project_id: string
          stage: number
          text?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          level?: number
          logic_version_id?: string | null
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
      image_generations: {
        Row: {
          created_at: string
          created_by_message_id: string | null
          effective_model: string | null
          error_message: string | null
          fallback: string | null
          id: string
          mime_type: string | null
          model: string | null
          project_id: string
          prompt: string | null
          provider: string | null
          quality: string | null
          source_document_id: string | null
          source_envelope_id: string | null
          source_hint_sheet_id: string | null
          source_project_cover: boolean
          source_suspect_id: string | null
          status: string
          updated_at: string
          url: string | null
        }
        Insert: {
          created_at?: string
          created_by_message_id?: string | null
          effective_model?: string | null
          error_message?: string | null
          fallback?: string | null
          id?: string
          mime_type?: string | null
          model?: string | null
          project_id: string
          prompt?: string | null
          provider?: string | null
          quality?: string | null
          source_document_id?: string | null
          source_envelope_id?: string | null
          source_hint_sheet_id?: string | null
          source_project_cover?: boolean
          source_suspect_id?: string | null
          status?: string
          updated_at?: string
          url?: string | null
        }
        Update: {
          created_at?: string
          created_by_message_id?: string | null
          effective_model?: string | null
          error_message?: string | null
          fallback?: string | null
          id?: string
          mime_type?: string | null
          model?: string | null
          project_id?: string
          prompt?: string | null
          provider?: string | null
          quality?: string | null
          source_document_id?: string | null
          source_envelope_id?: string | null
          source_hint_sheet_id?: string | null
          source_project_cover?: boolean
          source_suspect_id?: string | null
          status?: string
          updated_at?: string
          url?: string | null
        }
        Relationships: []
      }
      invite_codes: {
        Row: {
          code: string
          code_user_id: string | null
          created_at: string
          created_by: string | null
          expires_at: string | null
          id: string
          label: string | null
          last_login_at: string | null
          max_uses: number | null
          revoked_at: string | null
          uses: number
        }
        Insert: {
          code: string
          code_user_id?: string | null
          created_at?: string
          created_by?: string | null
          expires_at?: string | null
          id?: string
          label?: string | null
          last_login_at?: string | null
          max_uses?: number | null
          revoked_at?: string | null
          uses?: number
        }
        Update: {
          code?: string
          code_user_id?: string | null
          created_at?: string
          created_by?: string | null
          expires_at?: string | null
          id?: string
          label?: string | null
          last_login_at?: string | null
          max_uses?: number | null
          revoked_at?: string | null
          uses?: number
        }
        Relationships: []
      }
      media_assets: {
        Row: {
          asset_type: string
          category: string
          created_at: string
          created_by_message_id: string | null
          document_format: string | null
          effective_model: string | null
          error_message: string | null
          fallback: string | null
          generation_mode: string | null
          id: string
          mime_type: string | null
          model: string | null
          preview_url: string | null
          project_id: string
          prompt: string | null
          prompt_history: Json
          provider: string | null
          skill_id: string | null
          skill_name: string | null
          skill_source: string | null
          source_document_id: string | null
          source_hint_sheet_id: string | null
          source_project_cover: boolean
          source_suspect_id: string | null
          status: string
          title: string | null
          url: string | null
        }
        Insert: {
          asset_type?: string
          category?: string
          created_at?: string
          created_by_message_id?: string | null
          document_format?: string | null
          effective_model?: string | null
          error_message?: string | null
          fallback?: string | null
          generation_mode?: string | null
          id?: string
          mime_type?: string | null
          model?: string | null
          preview_url?: string | null
          project_id: string
          prompt?: string | null
          prompt_history?: Json
          provider?: string | null
          skill_id?: string | null
          skill_name?: string | null
          skill_source?: string | null
          source_document_id?: string | null
          source_hint_sheet_id?: string | null
          source_project_cover?: boolean
          source_suspect_id?: string | null
          status?: string
          title?: string | null
          url?: string | null
        }
        Update: {
          asset_type?: string
          category?: string
          created_at?: string
          created_by_message_id?: string | null
          document_format?: string | null
          effective_model?: string | null
          error_message?: string | null
          fallback?: string | null
          generation_mode?: string | null
          id?: string
          mime_type?: string | null
          model?: string | null
          preview_url?: string | null
          project_id?: string
          prompt?: string | null
          prompt_history?: Json
          provider?: string | null
          skill_id?: string | null
          skill_name?: string | null
          skill_source?: string | null
          source_document_id?: string | null
          source_hint_sheet_id?: string | null
          source_project_cover?: boolean
          source_suspect_id?: string | null
          status?: string
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
          ai_provider_prompt_writer: string
          app_logo_url: string | null
          assistant_playbook: Json
          assistant_tweaks: Json
          avatar_url: string | null
          created_at: string
          default_planning_depth: string
          display_name: string | null
          id: string
          image_prompt_assistant_instructions: string | null
          theme: string
          ui_background: string
          updated_at: string
        }
        Insert: {
          ai_provider_documents?: string
          ai_provider_images?: string
          ai_provider_planning?: string
          ai_provider_prompt_writer?: string
          app_logo_url?: string | null
          assistant_playbook?: Json
          assistant_tweaks?: Json
          avatar_url?: string | null
          created_at?: string
          default_planning_depth?: string
          display_name?: string | null
          id: string
          image_prompt_assistant_instructions?: string | null
          theme?: string
          ui_background?: string
          updated_at?: string
        }
        Update: {
          ai_provider_documents?: string
          ai_provider_images?: string
          ai_provider_planning?: string
          ai_provider_prompt_writer?: string
          app_logo_url?: string | null
          assistant_playbook?: Json
          assistant_tweaks?: Json
          avatar_url?: string | null
          created_at?: string
          default_planning_depth?: string
          display_name?: string | null
          id?: string
          image_prompt_assistant_instructions?: string | null
          theme?: string
          ui_background?: string
          updated_at?: string
        }
        Relationships: []
      }
      project_marketing: {
        Row: {
          back_body: string | null
          back_content_note: string | null
          back_cover_prompt: string | null
          back_cover_url: string | null
          back_feature_bullets: string | null
          back_footer_text: string | null
          back_headline: string | null
          back_how_to_play: string | null
          back_specs: string | null
          back_teaser: string | null
          back_whats_in_box: string | null
          barcode_url: string | null
          barcode_value: string | null
          copy_origins: Json
          created_at: string
          front_bottom_explanation: string | null
          front_company_slogan: string | null
          front_logo_note: string | null
          front_subtext: string | null
          front_title_note: string | null
          mini_movie_url: string | null
          project_id: string
          qr_code_url: string | null
          qr_helper_text: string | null
          qr_label: string | null
          tagline: string | null
          updated_at: string
        }
        Insert: {
          back_body?: string | null
          back_content_note?: string | null
          back_cover_prompt?: string | null
          back_cover_url?: string | null
          back_feature_bullets?: string | null
          back_footer_text?: string | null
          back_headline?: string | null
          back_how_to_play?: string | null
          back_specs?: string | null
          back_teaser?: string | null
          back_whats_in_box?: string | null
          barcode_url?: string | null
          barcode_value?: string | null
          copy_origins?: Json
          created_at?: string
          front_bottom_explanation?: string | null
          front_company_slogan?: string | null
          front_logo_note?: string | null
          front_subtext?: string | null
          front_title_note?: string | null
          mini_movie_url?: string | null
          project_id: string
          qr_code_url?: string | null
          qr_helper_text?: string | null
          qr_label?: string | null
          tagline?: string | null
          updated_at?: string
        }
        Update: {
          back_body?: string | null
          back_content_note?: string | null
          back_cover_prompt?: string | null
          back_cover_url?: string | null
          back_feature_bullets?: string | null
          back_footer_text?: string | null
          back_headline?: string | null
          back_how_to_play?: string | null
          back_specs?: string | null
          back_teaser?: string | null
          back_whats_in_box?: string | null
          barcode_url?: string | null
          barcode_value?: string | null
          copy_origins?: Json
          created_at?: string
          front_bottom_explanation?: string | null
          front_company_slogan?: string | null
          front_logo_note?: string | null
          front_subtext?: string | null
          front_title_note?: string | null
          mini_movie_url?: string | null
          project_id?: string
          qr_code_url?: string | null
          qr_helper_text?: string | null
          qr_label?: string | null
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
          preview_image_url: string | null
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
          preview_image_url?: string | null
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
          preview_image_url?: string | null
          project_id?: string
          read_at?: string | null
          starter_prompt?: string | null
          status?: string
          title?: string
        }
        Relationships: []
      }
      project_qr_codes: {
        Row: {
          created_at: string
          id: string
          is_primary: boolean
          label: string | null
          position: number
          project_id: string
          qr_image_url: string | null
          target_url: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_primary?: boolean
          label?: string | null
          position?: number
          project_id: string
          qr_image_url?: string | null
          target_url: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          is_primary?: boolean
          label?: string | null
          position?: number
          project_id?: string
          qr_image_url?: string | null
          target_url?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_qr_codes_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      project_storyboards: {
        Row: {
          created_at: string
          id: string
          kling_instructions: string | null
          length_seconds: number
          logic_version_id: string | null
          project_id: string
          script_instructions: string | null
          shot_prompts: Json
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
          logic_version_id?: string | null
          project_id: string
          script_instructions?: string | null
          shot_prompts?: Json
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
          logic_version_id?: string | null
          project_id?: string
          script_instructions?: string | null
          shot_prompts?: Json
          shots?: Json
          sora_instructions?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      project_versions: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          label: string | null
          owner_id: string
          project_id: string
          reason: string
          snapshot: Json
          summary: Json
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          label?: string | null
          owner_id: string
          project_id: string
          reason?: string
          snapshot: Json
          summary?: Json
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          label?: string | null
          owner_id?: string
          project_id?: string
          reason?: string
          snapshot?: Json
          summary?: Json
        }
        Relationships: []
      }
      projects: {
        Row: {
          ai_provider_documents: string | null
          ai_provider_images: string | null
          ai_provider_planning: string | null
          ai_reasoning_effort: string
          assistant_origins: Json
          case_goal: string | null
          cover_active_version: string
          cover_effective_model: string | null
          cover_fallback: string | null
          cover_image_url: string | null
          cover_prompt: string | null
          cover_prompt_history: Json
          created_at: string
          deleted_at: string | null
          difficulty: string | null
          doc_generation_mode: string | null
          envelope_settings: Json
          game_language: string
          genre: string | null
          hint_settings: Json
          id: string
          image_prompt_instructions: string | null
          last_assistant_acknowledged_at: string | null
          last_seen_planning_depth: string | null
          logic_approved_at: string | null
          logic_flow_building_at: string | null
          logic_version_id: string
          mystery_type: string | null
          owner_id: string
          packaging_notes: string | null
          phase: string
          planning_depth: string
          player_role: string | null
          proposed_document_set: Json
          proposed_document_set_approved_at: string | null
          proposed_document_set_status: string
          selling_point: string | null
          setting: string | null
          solution_summary: string | null
          subtitle: string | null
          target_doc_count: number | null
          title: string
          updated_at: string
          uploaded_cover_url: string | null
          video_prompt_instructions: string | null
          year: number | null
        }
        Insert: {
          ai_provider_documents?: string | null
          ai_provider_images?: string | null
          ai_provider_planning?: string | null
          ai_reasoning_effort?: string
          assistant_origins?: Json
          case_goal?: string | null
          cover_active_version?: string
          cover_effective_model?: string | null
          cover_fallback?: string | null
          cover_image_url?: string | null
          cover_prompt?: string | null
          cover_prompt_history?: Json
          created_at?: string
          deleted_at?: string | null
          difficulty?: string | null
          doc_generation_mode?: string | null
          envelope_settings?: Json
          game_language?: string
          genre?: string | null
          hint_settings?: Json
          id?: string
          image_prompt_instructions?: string | null
          last_assistant_acknowledged_at?: string | null
          last_seen_planning_depth?: string | null
          logic_approved_at?: string | null
          logic_flow_building_at?: string | null
          logic_version_id?: string
          mystery_type?: string | null
          owner_id: string
          packaging_notes?: string | null
          phase?: string
          planning_depth?: string
          player_role?: string | null
          proposed_document_set?: Json
          proposed_document_set_approved_at?: string | null
          proposed_document_set_status?: string
          selling_point?: string | null
          setting?: string | null
          solution_summary?: string | null
          subtitle?: string | null
          target_doc_count?: number | null
          title?: string
          updated_at?: string
          uploaded_cover_url?: string | null
          video_prompt_instructions?: string | null
          year?: number | null
        }
        Update: {
          ai_provider_documents?: string | null
          ai_provider_images?: string | null
          ai_provider_planning?: string | null
          ai_reasoning_effort?: string
          assistant_origins?: Json
          case_goal?: string | null
          cover_active_version?: string
          cover_effective_model?: string | null
          cover_fallback?: string | null
          cover_image_url?: string | null
          cover_prompt?: string | null
          cover_prompt_history?: Json
          created_at?: string
          deleted_at?: string | null
          difficulty?: string | null
          doc_generation_mode?: string | null
          envelope_settings?: Json
          game_language?: string
          genre?: string | null
          hint_settings?: Json
          id?: string
          image_prompt_instructions?: string | null
          last_assistant_acknowledged_at?: string | null
          last_seen_planning_depth?: string | null
          logic_approved_at?: string | null
          logic_flow_building_at?: string | null
          logic_version_id?: string
          mystery_type?: string | null
          owner_id?: string
          packaging_notes?: string | null
          phase?: string
          planning_depth?: string
          player_role?: string | null
          proposed_document_set?: Json
          proposed_document_set_approved_at?: string | null
          proposed_document_set_status?: string
          selling_point?: string | null
          setting?: string | null
          solution_summary?: string | null
          subtitle?: string | null
          target_doc_count?: number | null
          title?: string
          updated_at?: string
          uploaded_cover_url?: string | null
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
          active_version: string
          alt_thumbnail_effective_model: string | null
          alt_thumbnail_fallback: string | null
          alt_thumbnail_prompt: string | null
          alt_thumbnail_prompt_history: Json
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
          thumbnail_effective_model: string | null
          thumbnail_fallback: string | null
          thumbnail_prompt: string | null
          thumbnail_prompt_history: Json
          thumbnail_url: string | null
          updated_at: string
          uploaded_thumbnail_url: string | null
        }
        Insert: {
          active_version?: string
          alt_thumbnail_effective_model?: string | null
          alt_thumbnail_fallback?: string | null
          alt_thumbnail_prompt?: string | null
          alt_thumbnail_prompt_history?: Json
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
          thumbnail_effective_model?: string | null
          thumbnail_fallback?: string | null
          thumbnail_prompt?: string | null
          thumbnail_prompt_history?: Json
          thumbnail_url?: string | null
          updated_at?: string
          uploaded_thumbnail_url?: string | null
        }
        Update: {
          active_version?: string
          alt_thumbnail_effective_model?: string | null
          alt_thumbnail_fallback?: string | null
          alt_thumbnail_prompt?: string | null
          alt_thumbnail_prompt_history?: Json
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
          thumbnail_effective_model?: string | null
          thumbnail_fallback?: string | null
          thumbnail_prompt?: string | null
          thumbnail_prompt_history?: Json
          thumbnail_url?: string | null
          updated_at?: string
          uploaded_thumbnail_url?: string | null
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
      system_prompts: {
        Row: {
          body: string
          created_at: string
          created_by: string | null
          id: string
          injection_mode: string
          is_active: boolean
          notes: string | null
          owner_id: string
          surface: string
          updated_at: string
          version: number
        }
        Insert: {
          body?: string
          created_at?: string
          created_by?: string | null
          id?: string
          injection_mode?: string
          is_active?: boolean
          notes?: string | null
          owner_id: string
          surface: string
          updated_at?: string
          version?: number
        }
        Update: {
          body?: string
          created_at?: string
          created_by?: string | null
          id?: string
          injection_mode?: string
          is_active?: boolean
          notes?: string | null
          owner_id?: string
          surface?: string
          updated_at?: string
          version?: number
        }
        Relationships: []
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
      increment_bulk_completed: {
        Args: { p_job_id: string }
        Returns: undefined
      }
      increment_bulk_failed: { Args: { p_job_id: string }; Returns: undefined }
      redeem_invite_code: { Args: { p_code: string }; Returns: Json }
      sweep_stale_assistant_runs: {
        Args: { p_stale_minutes?: number }
        Returns: number
      }
      sweep_stale_bulk_jobs: {
        Args: { p_project_id?: string; p_stale_minutes?: number }
        Returns: number
      }
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
