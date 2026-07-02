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
      bank_accounts: {
        Row: {
          account_mask: string | null
          account_name: string | null
          account_subtype: string | null
          account_type: string | null
          available_balance: number | null
          created_at: string
          current_balance: number | null
          id: string
          institution_name: string | null
          iso_currency_code: string | null
          linked_by_parent_id: string
          owner_user_id: string
          plaid_access_token: string
          plaid_account_id: string
          plaid_item_id: string
          transactions_sync_cursor: string | null
          updated_at: string
        }
        Insert: {
          account_mask?: string | null
          account_name?: string | null
          account_subtype?: string | null
          account_type?: string | null
          available_balance?: number | null
          created_at?: string
          current_balance?: number | null
          id?: string
          institution_name?: string | null
          iso_currency_code?: string | null
          linked_by_parent_id: string
          owner_user_id: string
          plaid_access_token: string
          plaid_account_id: string
          plaid_item_id: string
          transactions_sync_cursor?: string | null
          updated_at?: string
        }
        Update: {
          account_mask?: string | null
          account_name?: string | null
          account_subtype?: string | null
          account_type?: string | null
          available_balance?: number | null
          created_at?: string
          current_balance?: number | null
          id?: string
          institution_name?: string | null
          iso_currency_code?: string | null
          linked_by_parent_id?: string
          owner_user_id?: string
          plaid_access_token?: string
          plaid_account_id?: string
          plaid_item_id?: string
          transactions_sync_cursor?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      sms_logs: {
        Row: {
          id: string
          parent_id: string
          transaction_id: string | null
          phone: string
          message: string
          status: string
          twilio_sid: string | null
          created_at: string
        }
        Insert: {
          id?: string
          parent_id: string
          transaction_id?: string | null
          phone: string
          message: string
          status?: string
          twilio_sid?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          parent_id?: string
          transaction_id?: string | null
          phone?: string
          message?: string
          status?: string
          twilio_sid?: string | null
          created_at?: string
        }
        Relationships: []
      }
      transactions: {
        Row: {
          account_id: string
          amount: number
          bank_account_id: string | null
          category: string[]
          created_at: string
          date: string
          flag_category: string | null
          flag_reason: string | null
          id: string
          is_flagged: boolean
          iso_currency_code: string
          merchant_name: string | null
          name: string | null
          owner_user_id: string | null
          pending: boolean
          personal_finance_category: string | null
          plaid_item_id: string
          raw_json: Json | null
          updated_at: string
        }
        Insert: {
          account_id: string
          amount: number
          bank_account_id?: string | null
          category?: string[]
          created_at?: string
          date: string
          flag_category?: string | null
          flag_reason?: string | null
          id: string
          is_flagged?: boolean
          iso_currency_code?: string
          merchant_name?: string | null
          name?: string | null
          owner_user_id?: string | null
          pending?: boolean
          personal_finance_category?: string | null
          plaid_item_id: string
          raw_json?: Json | null
          updated_at?: string
        }
        Update: {
          account_id?: string
          amount?: number
          bank_account_id?: string | null
          category?: string[]
          created_at?: string
          date?: string
          flag_category?: string | null
          flag_reason?: string | null
          id?: string
          is_flagged?: boolean
          iso_currency_code?: string
          merchant_name?: string | null
          name?: string | null
          owner_user_id?: string | null
          pending?: boolean
          personal_finance_category?: string | null
          plaid_item_id?: string
          raw_json?: Json | null
          updated_at?: string
        }
        Relationships: []
      }
      plaid_webhook_events: {
        Row: {
          bank_account_id: string | null
          created_at: string
          id: string
          linked_by_parent_id: string | null
          linked_by_parent_name: string | null
          owner_email: string | null
          owner_name: string | null
          owner_user_id: string | null
          payload: string
          plaid_item_id: string | null
        }
        Insert: {
          bank_account_id?: string | null
          created_at?: string
          id?: string
          linked_by_parent_id?: string | null
          linked_by_parent_name?: string | null
          owner_email?: string | null
          owner_name?: string | null
          owner_user_id?: string | null
          payload: string
          plaid_item_id?: string | null
        }
        Update: {
          bank_account_id?: string | null
          created_at?: string
          id?: string
          linked_by_parent_id?: string | null
          linked_by_parent_name?: string | null
          owner_email?: string | null
          owner_name?: string | null
          owner_user_id?: string | null
          payload?: string
          plaid_item_id?: string | null
        }
        Relationships: []
      }
      invitations: {
        Row: {
          accepted_user_id: string | null
          created_at: string
          email: string
          expires_at: string
          id: string
          parent_id: string
          status: Database["public"]["Enums"]["invitation_status"]
          token: string
        }
        Insert: {
          accepted_user_id?: string | null
          created_at?: string
          email: string
          expires_at?: string
          id?: string
          parent_id: string
          status?: Database["public"]["Enums"]["invitation_status"]
          token: string
        }
        Update: {
          accepted_user_id?: string | null
          created_at?: string
          email?: string
          expires_at?: string
          id?: string
          parent_id?: string
          status?: Database["public"]["Enums"]["invitation_status"]
          token?: string
        }
        Relationships: [
          {
            foreignKeyName: "invitations_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      merchants: {
        Row: {
          category: Database["public"]["Enums"]["flag_category"]
          created_at: string
          id: string
          name: string
          notes: string | null
          risk_level: Database["public"]["Enums"]["risk_level"]
          updated_at: string
        }
        Insert: {
          category: Database["public"]["Enums"]["flag_category"]
          created_at?: string
          id?: string
          name: string
          notes?: string | null
          risk_level?: Database["public"]["Enums"]["risk_level"]
          updated_at?: string
        }
        Update: {
          category?: Database["public"]["Enums"]["flag_category"]
          created_at?: string
          id?: string
          name?: string
          notes?: string | null
          risk_level?: Database["public"]["Enums"]["risk_level"]
          updated_at?: string
        }
        Relationships: []
      }
      roles: {
        Row: {
          id: number
          name: string
        }
        Insert: {
          id?: number
          name: string
        }
        Update: {
          id?: number
          name?: string
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
      users: {
        Row: {
          avatar_url: string | null
          created_at: string
          email: string
          id: string
          name: string
          parent_id: string | null
          phone: string | null
          status: Database["public"]["Enums"]["user_status"]
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          email: string
          id: string
          name?: string
          parent_id?: string | null
          phone?: string | null
          status?: Database["public"]["Enums"]["user_status"]
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          email?: string
          id?: string
          name?: string
          parent_id?: string | null
          phone?: string | null
          status?: Database["public"]["Enums"]["user_status"]
        }
        Relationships: [
          {
            foreignKeyName: "users_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      accept_invitation: { Args: { _token: string }; Returns: string }
      admin_list_users: {
        Args: never
        Returns: {
          created_at: string
          email: string
          id: string
          name: string
          parent_id: string
          parent_name: string
          phone: string
          role: Database["public"]["Enums"]["app_role"]
          status: Database["public"]["Enums"]["user_status"]
        }[]
      }
      get_invitation_by_token: {
        Args: { _token: string }
        Returns: {
          email: string
          expires_at: string
          parent_name: string
          status: Database["public"]["Enums"]["invitation_status"]
        }[]
      }
      get_primary_role: {
        Args: { _user_id: string }
        Returns: Database["public"]["Enums"]["app_role"]
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
    }
    Enums: {
      app_role: "admin" | "parent" | "child"
      flag_category: "gambling" | "payday_loan" | "crypto" | "high_risk"
      invitation_status: "pending" | "accepted" | "expired"
      risk_level: "low" | "medium" | "high"
      user_status: "active" | "suspended" | "blocked"
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
      app_role: ["admin", "parent", "child"],
      flag_category: ["gambling", "payday_loan", "crypto", "high_risk"],
      invitation_status: ["pending", "accepted", "expired"],
      risk_level: ["low", "medium", "high"],
      user_status: ["active", "suspended", "blocked"],
    },
  },
} as const
