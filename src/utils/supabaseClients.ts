import { clientsApi } from '@/lib/apiClient';

export interface Client {
  id: string;
  full_name: string;
  phone_number: string;
  address: string;
  city: string;
  ice: string;
  email: string;
  created_at: string;
  updated_at: string;
}

export interface CreateClientRequest {
  full_name: string;
  phone_number: string;
  address?: string;
  city?: string;
  ice?: string;
  email?: string;
}

export interface UpdateClientRequest {
  full_name?: string;
  phone_number?: string;
  address?: string;
  city?: string;
  ice?: string;
  email?: string;
}

export class SupabaseClientsService {
  static async getAllClients(): Promise<Client[]> {
    const { clients } = await clientsApi.getAll();
    return clients as Client[];
  }

  static async searchClients(query: string): Promise<Client[]> {
    const { clients } = await clientsApi.search(query);
    return clients as Client[];
  }

  static async upsertClient(client: CreateClientRequest): Promise<Client> {
    const { client: c } = await clientsApi.upsert({
      full_name: client.full_name,
      phone_number: client.phone_number,
      address: client.address ?? '',
      city: client.city ?? '',
      ice: client.ice ?? '',
      email: client.email ?? '',
    });
    return c as Client;
  }

  static async createClient(client: CreateClientRequest): Promise<Client> {
    const { client: c } = await clientsApi.create({
      full_name: client.full_name,
      phone_number: client.phone_number,
      address: client.address ?? '',
      city: client.city ?? '',
      ice: client.ice ?? '',
      email: client.email ?? '',
    });
    return c as Client;
  }

  static async updateClient(id: string, updates: UpdateClientRequest): Promise<Client> {
    const { client: c } = await clientsApi.update(id, updates);
    return c as Client;
  }

  static async deleteClient(id: string): Promise<void> {
    await clientsApi.delete(id);
  }
}
