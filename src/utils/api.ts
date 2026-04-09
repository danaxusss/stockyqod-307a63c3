import { SyncData, Meta } from '../types';

const API_BASE = import.meta.env.VITE_SUPABASE_URL;
const API_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

// Flag to track if Edge Functions are available
let edgeFunctionsAvailable = true;

// Validate environment variables
function validateEnvironment() {
  if (!API_BASE || !API_KEY) {
    const errorMessage = 'Supabase configuration missing. Please check your environment variables:\n' +
      `VITE_SUPABASE_URL: ${API_BASE ? 'Set' : 'Missing'}\n` +
      `VITE_SUPABASE_ANON_KEY: ${API_KEY ? 'Set' : 'Missing'}\n` +
      'Please ensure these are properly configured in your .env file.';
    
    console.error(errorMessage);
    return false;
  }
  return true;
}

export class ApiService {
  private static async makeRequest(endpoint: string, options: RequestInit = {}): Promise<Response> {
    // If Edge Functions are known to be unavailable, throw immediately
    if (!edgeFunctionsAvailable) {
      throw new Error(`Edge Function '${endpoint}' is not available. Edge Functions may not be deployed to your Supabase project.`);
    }

    // Check environment variables before making request
    if (!validateEnvironment()) {
      throw new Error('Supabase configuration is missing. Please check your .env file.');
    }

    const url = `${API_BASE}/functions/v1/${endpoint}`;
    const headers = {
      'Authorization': `Bearer ${API_KEY}`,
      'Content-Type': 'application/json',
      ...options.headers,
    };

    console.log(`Making API request to: ${url}`);
    
    // Enhanced error handling for network issues
    let response: Response;
    try {
      response = await fetch(url, {
        ...options,
        headers,
      });
    } catch (networkError) {
      const error = networkError as Error;
      console.error('Network error when calling Supabase Edge Function:', error);
      
      // Mark Edge Functions as unavailable for subsequent requests
      edgeFunctionsAvailable = false;
      
      // Ensure error message is always a string to prevent 'undefined' in error messages
      const errorMessage = error?.message || 'Unknown network error occurred';
      
      // Provide more specific error messages based on common issues
      if (errorMessage.includes('Failed to fetch')) {
        throw new Error(`Unable to connect to Supabase Edge Functions. This could be due to:
1. Incorrect VITE_SUPABASE_URL in your .env file
2. Edge Functions not deployed to your Supabase project
3. Network connectivity issues
4. CORS configuration problems

Please verify your Supabase configuration and ensure the '${endpoint}' Edge Function is deployed.`);
      }
      
      throw new Error(`Network error: ${errorMessage}`);
    }

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`API request failed (${response.status}):`, errorText);
      
      if (response.status === 404) {
        edgeFunctionsAvailable = false;
        throw new Error(`Edge Function '${endpoint}' not found. Please ensure it's deployed to your Supabase project.`);
      }
      
      throw new Error(`API request failed (${response.status}): ${response.statusText}`);
    }

    return response;
  }

  static async fetchMeta(): Promise<Meta> {
    try {
      const response = await this.makeRequest('meta');
      const data = await response.json();
      
      console.log('Meta response:', data);
      
      if (!data.version || !data.adminPin) {
        throw new Error('Invalid meta data structure');
      }
      
      // Reset the flag on successful request
      edgeFunctionsAvailable = true;
      return data;
    } catch (error) {
      console.error('Failed to fetch meta:', error);
      
      // Return mock data when Edge Functions are not available
      if (!edgeFunctionsAvailable) {
        console.warn('Edge Functions not available, returning mock meta data');
        return {
          version: 'offline-mode',
          adminPin: '0000'
        };
      }
      
      throw error;
    }
  }

  static async fetchFullSync(): Promise<SyncData> {
    try {
      const response = await this.makeRequest('sync');
      const data = await response.json();
      
      console.log('Sync response received:', {
        metaVersion: data.meta?.version,
        rowsCount: data.rows?.length,
        firstRow: data.rows?.[0]
      });

      // Validate the response structure
      if (!data.meta || !Array.isArray(data.rows)) {
        console.error('Invalid sync data structure:', data);
        throw new Error('Invalid sync data structure received from server');
      }

      // Validate meta structure
      if (!data.meta.version || !data.meta.adminPin) {
        throw new Error('Invalid meta structure in sync data');
      }

      // Reset the flag on successful request
      edgeFunctionsAvailable = true;
      return data;
    } catch (error) {
      console.error('Failed to fetch sync data:', error);
      
      // Return mock data when Edge Functions are not available
      if (!edgeFunctionsAvailable) {
        console.warn('Edge Functions not available, returning mock sync data');
        return {
          meta: {
            version: 'offline-mode',
            adminPin: '0000'
          },
          rows: []
        };
      }
      
      throw error;
    }
  }

  // Health check endpoint
  static async healthCheck(): Promise<boolean> {
    try {
      if (!edgeFunctionsAvailable) {
        return false;
      }
      await this.makeRequest('meta');
      return true;
    } catch (error) {
      console.warn('Health check failed:', error);
      return false;
    }
  }

  // Test connectivity
  static async testConnectivity(): Promise<{ success: boolean; latency?: number; error?: string }> {
    if (!edgeFunctionsAvailable) {
      return {
        success: false,
        error: 'Edge Functions are not available'
      };
    }
    
    const startTime = Date.now();
    
    try {
      await this.makeRequest('meta');
      const latency = Date.now() - startTime;
      
      return {
        success: true,
        latency
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  // Method to reset Edge Functions availability (for retry scenarios)
  static resetEdgeFunctionsAvailability(): void {
    edgeFunctionsAvailable = true;
  }

  // Method to check if Edge Functions are available
  static areEdgeFunctionsAvailable(): boolean {
    return edgeFunctionsAvailable;
  }
}