import React, { useState } from 'react';
import { X } from 'lucide-react';
import { SupabaseClientsService, Client, CreateClientRequest } from '../utils/supabaseClients';
import { useToast } from '../context/ToastContext';

interface ClientFormModalProps {
  initialName?: string;
  onSave: (client: Client) => void;
  onClose: () => void;
}

export function ClientFormModal({ initialName = '', onSave, onClose }: ClientFormModalProps) {
  const { showToast } = useToast();
  const [isSaving, setIsSaving] = useState(false);
  const [formData, setFormData] = useState<CreateClientRequest>({
    full_name: initialName,
    phone_number: '',
    address: '',
    city: '',
    ice: '',
    email: '',
  });

  const handleSave = async () => {
    if (!formData.full_name.trim() || !formData.phone_number.trim()) {
      showToast({ type: 'error', message: 'Le nom et le téléphone sont requis' });
      return;
    }
    setIsSaving(true);
    try {
      const client = await SupabaseClientsService.createClient(formData);
      showToast({ type: 'success', message: 'Client créé' });
      onSave(client);
    } catch (e) {
      showToast({ type: 'error', message: e instanceof Error ? e.message : 'Erreur création client' });
    } finally {
      setIsSaving(false);
    }
  };

  const field = (label: string, key: keyof CreateClientRequest, required?: boolean) => (
    <div>
      <label className="text-[11px] text-muted-foreground block mb-0.5">{label}{required && ' *'}</label>
      <input
        type="text"
        value={formData[key] as string}
        onChange={e => setFormData(prev => ({ ...prev, [key]: e.target.value }))}
        className="w-full px-2 py-1.5 text-sm border border-input rounded-lg bg-background text-foreground focus:ring-2 focus:ring-ring"
      />
    </div>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-16 px-4 bg-black/60" onClick={onClose}>
      <div className="bg-card border border-border rounded-xl shadow-xl w-full max-w-sm p-5" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-semibold text-foreground">Nouveau client</h2>
          <button onClick={onClose} className="p-1 rounded hover:bg-secondary text-muted-foreground"><X className="h-4 w-4" /></button>
        </div>
        <div className="space-y-3">
          {field('Nom complet', 'full_name', true)}
          {field('Téléphone', 'phone_number', true)}
          {field('Adresse', 'address')}
          {field('Ville', 'city')}
          {field('ICE', 'ice')}
          {field('Email', 'email')}
        </div>
        <div className="flex gap-2 mt-5">
          <button onClick={onClose} className="flex-1 px-3 py-2 text-sm border border-border rounded-lg text-muted-foreground hover:bg-secondary">Annuler</button>
          <button onClick={handleSave} disabled={isSaving} className="flex-1 px-3 py-2 text-sm bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 disabled:opacity-50">
            {isSaving ? 'Création...' : 'Créer'}
          </button>
        </div>
      </div>
    </div>
  );
}
