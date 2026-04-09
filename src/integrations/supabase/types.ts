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
      activity_logs: {
        Row: {
          action: string
          created_at: string
          details: string | null
          entity_id: string | null
          entity_type: string | null
          id: string
          user_id: string | null
          username: string
        }
        Insert: {
          action: string
          created_at?: string
          details?: string | null
          entity_id?: string | null
          entity_type?: string | null
          id?: string
          user_id?: string | null
          username: string
        }
        Update: {
          action?: string
          created_at?: string
          details?: string | null
          entity_id?: string | null
          entity_type?: string | null
          id?: string
          user_id?: string | null
          username?: string
        }
        Relationships: []
      }
      app_users: {
        Row: {
          allowed_brands: string[]
          allowed_stock_locations: string[]
          can_create_quote: boolean
          created_at: string
          id: string
          is_admin: boolean
          pin: string
          price_display_type: string
          updated_at: string
          username: string
        }
        Insert: {
          allowed_brands?: string[]
          allowed_stock_locations?: string[]
          can_create_quote?: boolean
          created_at?: string
          id?: string
          is_admin?: boolean
          pin: string
          price_display_type?: string
          updated_at?: string
          username: string
        }
        Update: {
          allowed_brands?: string[]
          allowed_stock_locations?: string[]
          can_create_quote?: boolean
          created_at?: string
          id?: string
          is_admin?: boolean
          pin?: string
          price_display_type?: string
          updated_at?: string
          username?: string
        }
        Relationships: []
      }
      company_settings: {
        Row: {
          address: string
          cnss: string
          company_name: string
          email: string
          ice: string
          id: string
          if_number: string
          logo_size: string
          logo_url: string | null
          patente: string
          payment_terms: string
          phone: string
          phone_dir: string
          phone_gsm: string
          phone2: string
          quote_style: Json
          quote_validity_days: number
          quote_visible_fields: Json
          rc: string
          tva_rate: number
          updated_at: string
          website: string
        }
        Insert: {
          address?: string
          cnss?: string
          company_name?: string
          email?: string
          ice?: string
          id?: string
          if_number?: string
          logo_size?: string
          logo_url?: string | null
          patente?: string
          payment_terms?: string
          phone?: string
          phone_dir?: string
          phone_gsm?: string
          phone2?: string
          quote_style?: Json
          quote_validity_days?: number
          quote_visible_fields?: Json
          rc?: string
          tva_rate?: number
          updated_at?: string
          website?: string
        }
        Update: {
          address?: string
          cnss?: string
          company_name?: string
          email?: string
          ice?: string
          id?: string
          if_number?: string
          logo_size?: string
          logo_url?: string | null
          patente?: string
          payment_terms?: string
          phone?: string
          phone_dir?: string
          phone_gsm?: string
          phone2?: string
          quote_style?: Json
          quote_validity_days?: number
          quote_visible_fields?: Json
          rc?: string
          tva_rate?: number
          updated_at?: string
          website?: string
        }
        Relationships: []
      }
      products: {
        Row: {
          barcode: string
          brand: string
          buyprice: number
          created_at: string
          name: string
          price: number
          provider: string
          reseller_price: number
          stock_levels: Json
          techsheet: string
          updated_at: string
        }
        Insert: {
          barcode: string
          brand?: string
          buyprice?: number
          created_at?: string
          name: string
          price?: number
          provider?: string
          reseller_price?: number
          stock_levels?: Json
          techsheet?: string
          updated_at?: string
        }
        Update: {
          barcode?: string
          brand?: string
          buyprice?: number
          created_at?: string
          name?: string
          price?: number
          provider?: string
          reseller_price?: number
          stock_levels?: Json
          techsheet?: string
          updated_at?: string
        }
        Relationships: []
      }
      quote_templates: {
        Row: {
          file_data: string
          file_type: string
          id: string
          is_active: boolean
          name: string
          uploaded_at: string
        }
        Insert: {
          file_data: string
          file_type: string
          id: string
          is_active?: boolean
          name: string
          uploaded_at?: string
        }
        Update: {
          file_data?: string
          file_type?: string
          id?: string
          is_active?: boolean
          name?: string
          uploaded_at?: string
        }
        Relationships: []
      }
      quotes: {
        Row: {
          command_number: string | null
          created_at: string
          customer_info: Json
          id: string
          items: Json
          notes: string | null
          quote_number: string
          status: string
          total_amount: number
          updated_at: string
        }
        Insert: {
          command_number?: string | null
          created_at?: string
          customer_info?: Json
          id: string
          items?: Json
          notes?: string | null
          quote_number: string
          status?: string
          total_amount?: number
          updated_at?: string
        }
        Update: {
          command_number?: string | null
          created_at?: string
          customer_info?: Json
          id?: string
          items?: Json
          notes?: string | null
          quote_number?: string
          status?: string
          total_amount?: number
          updated_at?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      [_ in never]: never
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
    Enums: {},
  },
} as const
