// @ts-nocheck
import React, { useState, useEffect, useCallback } from 'react';
import {
  Users, Plus, Edit, Trash2, Shield, User, Eye, EyeOff,
  Save, X, AlertCircle, Search, UserCheck, UserX, MapPin, DollarSign, Building2, Star, Calculator, GitBranch
} from 'lucide-react';
import { AppUser, AppUserRole, CreateAppUserRequest, UpdateAppUserRequest, Company } from '../types';
import { SupabaseUsersService } from '../utils/supabaseUsers';
import { SupabaseCompaniesService } from '../utils/supabaseCompanies';
import { useToast } from '../context/ToastContext';
import { useAuth } from '../hooks/useAuth';
import { useAppContext } from '../context/AppContext';

const ROLE_OPTIONS: { value: AppUserRole; label: string; description: string }[] = [
  { value: 'super_admin',  label: 'Super Admin',       description: 'Contrôle total — toutes sociétés, gestion utilisateurs' },
  { value: 'admin',        label: 'Admin Société',      description: 'Gère paramètres, clients et devis de sa société' },
  { value: 'manager',      label: 'Manager',            description: 'Crée des devis, peut avoir accès multi-société' },
  { value: 'facturation',  label: 'Facturation',        description: 'Accès à tous les documents de toutes les sociétés (devis → facture)' },
  { value: 'compta',       label: 'Comptabilité',       description: 'Futur rôle comptable — accès limité pour l\'instant (coming soon)' },
  { value: 'senior_sales', label: 'Senior Commercial',  description: 'Crée et modifie tous les devis de sa société' },
  { value: 'junior_sales', label: 'Junior Commercial',  description: 'Crée des devis, ne peut modifier que les siens' },
];

function roleToLegacyFlags(role: AppUserRole) {
  return {
    is_superadmin: role === 'super_admin',
    is_admin: role === 'super_admin' || role === 'admin',
    is_compta: role === 'compta',
  };
}

interface UserFormData {
  username: string;
  pin: string;
  new_role: AppUserRole;
  cross_branch_read: boolean;
  is_admin: boolean;
  is_superadmin: boolean;
  is_compta: boolean;
  company_id: string;
  can_create_quote: boolean;
  allowed_stock_locations: string[];
  allowed_brands: string[];
  price_display_type: string;
  custom_seller_name: string;
  phone: string;
}

const initialFormData: UserFormData = {
  username: '',
  pin: '',
  new_role: 'senior_sales',
  cross_branch_read: false,
  is_admin: false,
  is_superadmin: false,
  is_compta: false,
  company_id: '',
  can_create_quote: true,
  allowed_stock_locations: [],
  allowed_brands: [],
  price_display_type: 'normal',
  custom_seller_name: '',
  phone: ''
};

export default function UserManagementPage() {
  const { showToast } = useToast();
  const { isSuperAdmin, authReady } = useAuth();
  const { state } = useAppContext();

  // Compute average price ratios from catalogue for the price type hints
  const priceRatios = React.useMemo(() => {
    const products = state.products.filter(p => p.price > 0 && p.buyprice > 0 && p.reseller_price > 0);
    if (products.length === 0) return null;
    const avgResellerRatio = products.reduce((s, p) => s + p.reseller_price / p.price, 0) / products.length;
    const avgBuyRatio = products.reduce((s, p) => s + p.buyprice / p.price, 0) / products.length;
    return {
      reseller: Math.round((1 - avgResellerRatio) * 100),
      buy: Math.round((1 - avgBuyRatio) * 100),
    };
  }, [state.products]);

  const [users, setUsers] = useState<AppUser[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [availableStockLocations, setAvailableStockLocations] = useState<string[]>([]);
  const [availableBrands, setAvailableBrands] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editingUser, setEditingUser] = useState<AppUser | null>(null);
  const [formData, setFormData] = useState<UserFormData>(initialFormData);
  const [showPin, setShowPin] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterRole, setFilterRole] = useState<'all' | AppUserRole>('all');
  const [validationErrors, setValidationErrors] = useState<string[]>([]);

  const loadData = useCallback(async () => {
    setIsLoading(true);
    try {
      const [usersData, companiesData, locationsData, brandsData] = await Promise.all([
        SupabaseUsersService.getAllUsers(),
        SupabaseCompaniesService.getAllCompanies(),
        SupabaseUsersService.getAvailableStockLocations(),
        SupabaseUsersService.getAvailableBrands(),
      ]);
      setUsers(usersData);
      setCompanies(companiesData);
      setAvailableStockLocations(locationsData);
      setAvailableBrands(brandsData);
    } catch (error) {
      showToast({ type: 'error', title: 'Erreur', message: 'Impossible de charger les données utilisateurs' });
    } finally {
      setIsLoading(false);
    }
  }, [showToast]);

  useEffect(() => { loadData(); }, [loadData]);

  const handleInputChange = (field: keyof UserFormData, value: any) => {
    setFormData(prev => {
      const next = { ...prev, [field]: value };
      // When new_role changes, sync legacy boolean flags for backward compat
      if (field === 'new_role') {
        Object.assign(next, roleToLegacyFlags(value as AppUserRole));
        // Roles that cannot create quotes
        if (['super_admin', 'compta'].includes(value)) next.can_create_quote = false;
        // Non-manager: clear cross_branch_read
        if (value !== 'manager') next.cross_branch_read = false;
      }
      return next;
    });
    setValidationErrors([]);
  };

  const handleStockLocationToggle = (location: string) => {
    setFormData(prev => ({
      ...prev,
      allowed_stock_locations: prev.allowed_stock_locations.includes(location)
        ? prev.allowed_stock_locations.filter(l => l !== location)
        : [...prev.allowed_stock_locations, location]
    }));
  };

  const handleBrandToggle = (brand: string) => {
    setFormData(prev => ({
      ...prev,
      allowed_brands: prev.allowed_brands.includes(brand)
        ? prev.allowed_brands.filter(b => b !== brand)
        : [...prev.allowed_brands, brand]
    }));
  };

  const validateForm = (): boolean => {
    const errors = SupabaseUsersService.validateUserData(formData);
    if (!editingUser && !formData.pin) errors.push('Le PIN est requis');
    setValidationErrors(errors);
    return errors.length === 0;
  };

  const handleCreateUser = async () => {
    if (!validateForm()) return;
    setIsSubmitting(true);
    try {
      const isAvailable = await SupabaseUsersService.isUsernameAvailable(formData.username);
      if (!isAvailable) { setValidationErrors(["Ce nom d'utilisateur est déjà pris"]); return; }

      const userData: CreateAppUserRequest = {
        username: formData.username.trim(),
        pin: formData.pin,
        new_role: formData.new_role,
        cross_branch_read: formData.cross_branch_read,
        is_admin: formData.is_superadmin ? true : formData.is_admin,
        is_superadmin: formData.is_superadmin,
        is_compta: formData.is_compta,
        company_id: formData.company_id || undefined,
        can_create_quote: formData.can_create_quote,
        allowed_stock_locations: formData.allowed_stock_locations,
        allowed_brands: formData.allowed_brands,
        price_display_type: formData.price_display_type,
        custom_seller_name: formData.custom_seller_name.trim(),
        phone: formData.phone.trim()
      };

      await SupabaseUsersService.createUser(userData);
      showToast({ type: 'success', title: 'Utilisateur créé', message: `${formData.username} créé avec succès` });
      setShowCreateModal(false);
      setFormData(initialFormData);
      await loadData();
    } catch (error) {
      showToast({ type: 'error', title: 'Erreur', message: error instanceof Error ? error.message : 'Impossible de créer l\'utilisateur' });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleEditUser = (user: AppUser) => {
    setEditingUser(user);
    const detectedRole: AppUserRole = user.new_role ||
      (user.is_superadmin ? 'super_admin' : user.is_admin ? 'admin' : user.is_compta ? 'compta' : 'senior_sales');
    setFormData({
      username: user.username,
      pin: '',
      new_role: detectedRole,
      cross_branch_read: user.cross_branch_read || false,
      is_admin: user.is_admin,
      is_superadmin: user.is_superadmin || false,
      is_compta: user.is_compta || false,
      company_id: user.company_id || '',
      can_create_quote: user.can_create_quote,
      allowed_stock_locations: user.allowed_stock_locations,
      allowed_brands: user.allowed_brands || [],
      price_display_type: user.price_display_type,
      custom_seller_name: user.custom_seller_name || '',
      phone: user.phone || ''
    });
  };

  const handleUpdateUser = async () => {
    if (!editingUser) return;
    // For edit, PIN is optional — only validate if provided
    const errors: string[] = [];
    if (!formData.username || formData.username.trim().length < 3) errors.push('Le nom doit faire 3+ caractères');
    if (formData.pin && !/^\d{6}$/.test(formData.pin)) errors.push('Le PIN doit être 6 chiffres');
    if (errors.length) { setValidationErrors(errors); return; }

    setIsSubmitting(true);
    try {
      if (formData.username !== editingUser.username) {
        const isAvailable = await SupabaseUsersService.isUsernameAvailable(formData.username, editingUser.id);
        if (!isAvailable) { setValidationErrors(["Ce nom d'utilisateur est déjà pris"]); return; }
      }

      const updates: UpdateAppUserRequest = {
        username: formData.username.trim(),
        new_role: formData.new_role,
        cross_branch_read: formData.cross_branch_read,
        is_admin: formData.is_superadmin ? true : formData.is_admin,
        is_superadmin: formData.is_superadmin,
        is_compta: formData.is_compta,
        company_id: formData.company_id || undefined,
        can_create_quote: formData.can_create_quote,
        allowed_stock_locations: formData.allowed_stock_locations,
        allowed_brands: formData.allowed_brands,
        price_display_type: formData.price_display_type,
        custom_seller_name: formData.custom_seller_name.trim(),
        phone: formData.phone.trim()
      };
      if (formData.pin) updates.pin = formData.pin;

      await SupabaseUsersService.updateUser(editingUser.id, updates);
      showToast({ type: 'success', title: 'Utilisateur modifié', message: `${formData.username} mis à jour` });
      setEditingUser(null);
      setFormData(initialFormData);
      await loadData();
    } catch (error) {
      showToast({ type: 'error', title: 'Erreur', message: error instanceof Error ? error.message : 'Impossible de modifier l\'utilisateur' });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDeleteUser = async (user: AppUser) => {
    if (!window.confirm(`Supprimer l'utilisateur "${user.username}" ? Cette action est irréversible.`)) return;
    try {
      await SupabaseUsersService.deleteUser(user.id);
      showToast({ type: 'success', message: `${user.username} supprimé` });
      await loadData();
    } catch (error) {
      showToast({ type: 'error', message: error instanceof Error ? error.message : 'Impossible de supprimer l\'utilisateur' });
    }
  };

  const closeModal = () => {
    setShowCreateModal(false);
    setEditingUser(null);
    setFormData(initialFormData);
    setValidationErrors([]);
    setShowPin(false);
  };

  const getCompanyName = (companyId?: string) => {
    if (!companyId) return null;
    return companies.find(c => c.id === companyId)?.name || null;
  };

  const getRoleBadge = (user: AppUser) => {
    const role = user.new_role ||
      (user.is_superadmin ? 'super_admin' : user.is_admin ? 'admin' : user.is_compta ? 'compta' : null);
    switch (role) {
      case 'super_admin':  return { label: 'Super Admin',    icon: Star,       cls: 'bg-amber-100 dark:bg-amber-900/30 text-amber-800 dark:text-amber-300' };
      case 'admin':        return { label: 'Admin',           icon: Shield,     cls: 'bg-purple-100 dark:bg-purple-900/30 text-purple-800 dark:text-purple-300' };
      case 'manager':      return { label: 'Manager',         icon: GitBranch,  cls: 'bg-orange-100 dark:bg-orange-900/30 text-orange-800 dark:text-orange-300' };
      case 'facturation':  return { label: 'Facturation',     icon: DollarSign, cls: 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-800 dark:text-emerald-300' };
      case 'compta':       return { label: 'Compta',          icon: Calculator, cls: 'bg-teal-100 dark:bg-teal-900/30 text-teal-800 dark:text-teal-300' };
      case 'senior_sales': return { label: 'Sr. Commercial',  icon: UserCheck,  cls: 'bg-blue-100 dark:bg-blue-900/30 text-blue-800 dark:text-blue-300' };
      case 'junior_sales': return { label: 'Jr. Commercial',  icon: User,       cls: 'bg-sky-100 dark:bg-sky-900/30 text-sky-800 dark:text-sky-300' };
      default:            return { label: 'Commercial', icon: User, cls: 'bg-blue-100 dark:bg-blue-900/30 text-blue-800 dark:text-blue-300' };
    }
  };

  const getUserRole = (user: AppUser): AppUserRole =>
    user.new_role || (user.is_superadmin ? 'super_admin' : user.is_admin ? 'admin' : user.is_compta ? 'compta' : 'senior_sales');

  const filteredUsers = users.filter(user => {
    const matchesSearch = user.username.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (user.custom_seller_name || '').toLowerCase().includes(searchQuery.toLowerCase());
    const matchesRole = filterRole === 'all' || getUserRole(user) === filterRole;
    return matchesSearch && matchesRole;
  });

  const getPriceTypeLabel = (type: string) => ({ normal: 'Prix Normal', reseller: 'Revendeur', buy: "Prix d'Achat", calculated: 'Calculé' }[type] || type);

  if (!authReady) return null;

  if (!isSuperAdmin) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[40vh] text-center">
        <Shield className="h-12 w-12 text-muted-foreground mb-4" />
        <h2 className="text-lg font-semibold text-foreground mb-2">Accès restreint</h2>
        <p className="text-muted-foreground text-sm">La gestion des utilisateurs est réservée au Superadmin.</p>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="text-center py-12">
        <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-primary mx-auto" />
        <p className="text-muted-foreground mt-4 text-sm">Chargement...</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="glass rounded-xl shadow-lg p-4">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center space-x-2.5">
            <div className="p-2 bg-primary rounded-lg" style={{ boxShadow: 'var(--shadow-glow)' }}>
              <Users className="h-4 w-4 text-primary-foreground" />
            </div>
            <div>
              <h1 className="text-lg font-bold text-foreground">Gestion Utilisateurs</h1>
              <p className="text-xs text-muted-foreground">{users.length} utilisateur{users.length !== 1 ? 's' : ''} · Superadmin</p>
            </div>
          </div>
          <button onClick={() => setShowCreateModal(true)} className="flex items-center space-x-1.5 px-3 py-1.5 bg-primary hover:bg-primary/90 text-primary-foreground rounded-lg transition-colors text-sm">
            <Plus className="h-3.5 w-3.5" /><span>Nouveau</span>
          </button>
        </div>

        {/* Stats pills */}
        <div className="flex flex-wrap gap-2 mb-4">
          {[
            { label: 'Total', value: users.length, cls: 'bg-secondary' },
            { label: 'Super Admins', value: users.filter(u => getUserRole(u) === 'super_admin').length, cls: 'bg-amber-100 dark:bg-amber-900/30 text-amber-800 dark:text-amber-300' },
            { label: 'Admins', value: users.filter(u => getUserRole(u) === 'admin').length, cls: 'bg-purple-100 dark:bg-purple-900/30 text-purple-800 dark:text-purple-300' },
            { label: 'Managers', value: users.filter(u => getUserRole(u) === 'manager').length, cls: 'bg-orange-100 dark:bg-orange-900/30 text-orange-800 dark:text-orange-300' },
            { label: 'Facturation', value: users.filter(u => getUserRole(u) === 'facturation').length, cls: 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-800 dark:text-emerald-300' },
            { label: 'Compta', value: users.filter(u => getUserRole(u) === 'compta').length, cls: 'bg-teal-100 dark:bg-teal-900/30 text-teal-800 dark:text-teal-300' },
            { label: 'Commerciaux', value: users.filter(u => ['senior_sales','junior_sales'].includes(getUserRole(u))).length, cls: 'bg-blue-100 dark:bg-blue-900/30 text-blue-800 dark:text-blue-300' },
          ].map(({ label, value, cls }) => (
            <span key={label} className={`px-2 py-1 rounded-lg text-xs font-medium ${cls}`}>{value} {label}</span>
          ))}
        </div>

        {/* Filters */}
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <input type="text" value={searchQuery} onChange={e => setSearchQuery(e.target.value)}
              className="w-full pl-8 pr-3 py-1.5 text-sm border border-input rounded-lg bg-secondary text-foreground" placeholder="Rechercher..." />
          </div>
          <select value={filterRole} onChange={e => setFilterRole(e.target.value as any)}
            className="px-2.5 py-1.5 text-sm border border-input rounded-lg bg-secondary text-foreground">
            <option value="all">Tous les rôles</option>
            <option value="super_admin">Super Admin</option>
            <option value="admin">Admin</option>
            <option value="manager">Manager</option>
            <option value="facturation">Facturation</option>
            <option value="compta">Compta</option>
            <option value="senior_sales">Sr. Commercial</option>
            <option value="junior_sales">Jr. Commercial</option>
          </select>
        </div>
      </div>

      {/* Users Table */}
      <div className="glass rounded-xl shadow-lg overflow-hidden">
        {filteredUsers.length === 0 ? (
          <div className="p-8 text-center">
            <Users className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
            <p className="text-sm text-muted-foreground">{users.length === 0 ? 'Aucun utilisateur' : 'Aucun résultat'}</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-secondary">
                <tr>
                  {['Utilisateur', 'Rôle', 'Société', 'Devis', 'Prix', 'Actions'].map(h => (
                    <th key={h} className="px-3 py-2 text-left text-[11px] font-medium text-muted-foreground uppercase tracking-wider">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {filteredUsers.map(user => {
                  const role = getRoleBadge(user);
                  const RoleIcon = role.icon;
                  const companyName = getCompanyName(user.company_id);
                  return (
                    <tr key={user.id} className="hover:bg-accent/50">
                      <td className="px-3 py-2.5">
                        <div className="flex items-center space-x-2">
                          <div className={`p-1 rounded ${role.cls}`}>
                            <RoleIcon className="h-3 w-3" />
                          </div>
                          <div>
                            <div className="text-xs font-medium text-foreground">{user.username}</div>
                            {user.custom_seller_name && <div className="text-[10px] text-muted-foreground">{user.custom_seller_name}</div>}
                          </div>
                        </div>
                      </td>
                      <td className="px-3 py-2.5">
                        <span className={`inline-flex items-center space-x-0.5 px-1.5 py-0.5 text-[10px] font-semibold rounded-full ${role.cls}`}>
                          <RoleIcon className="h-2.5 w-2.5" /><span>{role.label}</span>
                        </span>
                      </td>
                      <td className="px-3 py-2.5">
                        {companyName ? (
                          <span className="inline-flex items-center space-x-1 text-[10px] text-muted-foreground">
                            <Building2 className="h-2.5 w-2.5" /><span>{companyName}</span>
                          </span>
                        ) : <span className="text-[10px] text-muted-foreground">—</span>}
                      </td>
                      <td className="px-3 py-2.5">
                        {user.can_create_quote
                          ? <span className="inline-flex items-center px-1.5 py-0.5 text-[10px] bg-green-100 dark:bg-green-900/20 text-green-800 dark:text-green-300 rounded-full"><UserCheck className="h-2.5 w-2.5 mr-0.5" />Oui</span>
                          : <span className="inline-flex items-center px-1.5 py-0.5 text-[10px] bg-red-100 dark:bg-red-900/20 text-red-800 dark:text-red-300 rounded-full"><UserX className="h-2.5 w-2.5 mr-0.5" />Non</span>}
                      </td>
                      <td className="px-3 py-2.5">
                        <span className="text-[10px] text-muted-foreground">{getPriceTypeLabel(user.price_display_type)}</span>
                      </td>
                      <td className="px-3 py-2.5">
                        <div className="flex items-center space-x-1">
                          <button onClick={() => handleEditUser(user)} className="p-1 text-primary hover:bg-primary/10 rounded" title="Modifier"><Edit className="h-3.5 w-3.5" /></button>
                          <button onClick={() => handleDeleteUser(user)} className="p-1 text-destructive hover:bg-destructive/10 rounded" title="Supprimer"><Trash2 className="h-3.5 w-3.5" /></button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Create/Edit Modal */}
      {(showCreateModal || editingUser) && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-card rounded-xl shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between p-5 border-b border-border">
              <h2 className="text-base font-semibold text-foreground">
                {editingUser ? `Modifier — ${editingUser.username}` : 'Nouvel Utilisateur'}
              </h2>
              <button onClick={closeModal} className="p-1 hover:bg-accent rounded-lg"><X className="h-4 w-4" /></button>
            </div>

            <div className="p-5 space-y-5">
              {validationErrors.length > 0 && (
                <div className="p-3 bg-destructive/10 border border-destructive/30 rounded-lg">
                  <div className="flex items-center space-x-2 mb-1">
                    <AlertCircle className="h-3.5 w-3.5 text-destructive" />
                    <span className="text-xs font-medium text-destructive">Erreurs de validation</span>
                  </div>
                  <ul className="text-xs text-destructive space-y-0.5">
                    {validationErrors.map((e, i) => <li key={i}>• {e}</li>)}
                  </ul>
                </div>
              )}

              {/* Username + PIN */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-foreground mb-1">Identifiant de connexion *</label>
                  <input type="text" value={formData.username} onChange={e => handleInputChange('username', e.target.value)}
                    className="w-full px-3 py-1.5 text-sm border border-input rounded-lg bg-secondary text-foreground" placeholder="ex: ahmed_vente" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-foreground mb-1">
                    PIN (6 chiffres){editingUser ? ' — laisser vide pour ne pas changer' : ' *'}
                  </label>
                  <div className="relative">
                    <input type={showPin ? 'text' : 'password'} value={formData.pin} onChange={e => handleInputChange('pin', e.target.value)}
                      className="w-full px-3 py-1.5 pr-9 text-sm border border-input rounded-lg bg-secondary text-foreground" placeholder="123456" maxLength={6} />
                    <button type="button" onClick={() => setShowPin(v => !v)} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground">
                      {showPin ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                    </button>
                  </div>
                </div>
              </div>

              {/* Role */}
              <div>
                <h3 className="text-xs font-semibold text-foreground uppercase tracking-wider mb-3">Rôle et accès</h3>
                <div className="space-y-3">
                  {/* Role selector */}
                  <div>
                    <label className="block text-xs font-medium text-foreground mb-1">Rôle</label>
                    <select value={formData.new_role} onChange={e => handleInputChange('new_role', e.target.value as AppUserRole)}
                      className="w-full px-3 py-1.5 text-sm border border-input rounded-lg bg-secondary text-foreground">
                      {ROLE_OPTIONS.map(opt => (
                        <option key={opt.value} value={opt.value}>{opt.label}</option>
                      ))}
                    </select>
                    <p className="text-[10px] text-muted-foreground mt-1">
                      {ROLE_OPTIONS.find(o => o.value === formData.new_role)?.description}
                    </p>
                  </div>

                  {/* cross_branch_read — only for manager */}
                  {formData.new_role === 'manager' && (
                    <label className="flex items-center space-x-3 cursor-pointer">
                      <input type="checkbox" checked={formData.cross_branch_read}
                        onChange={e => handleInputChange('cross_branch_read', e.target.checked)}
                        className="w-4 h-4 rounded accent-primary" />
                      <div>
                        <span className="text-sm font-medium text-foreground flex items-center space-x-1">
                          <GitBranch className="h-3.5 w-3.5 text-orange-500" /><span>Accès multi-société</span>
                        </span>
                        <p className="text-[10px] text-muted-foreground">Ce manager peut voir les données de toutes les sociétés</p>
                      </div>
                    </label>
                  )}

                  {/* can_create_quote — hidden for super_admin and compta (no quote access) */}
                  {!['super_admin', 'compta'].includes(formData.new_role) && (
                    <label className="flex items-center space-x-3 cursor-pointer">
                      <input type="checkbox" checked={formData.can_create_quote}
                        onChange={e => handleInputChange('can_create_quote', e.target.checked)} className="w-4 h-4 rounded accent-primary" />
                      <div>
                        <span className="text-sm font-medium text-foreground">Peut créer des devis</span>
                        <p className="text-[10px] text-muted-foreground">Accès au panier et à la création de devis</p>
                      </div>
                    </label>
                  )}
                </div>
              </div>

              {/* Company + Seller name */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-foreground mb-1">Société</label>
                  <select value={formData.company_id} onChange={e => handleInputChange('company_id', e.target.value)}
                    className="w-full px-3 py-1.5 text-sm border border-input rounded-lg bg-secondary text-foreground">
                    <option value="">— Aucune —</option>
                    {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-foreground mb-1">Nom affiché (login + devis)</label>
                  <input type="text" value={formData.custom_seller_name} onChange={e => handleInputChange('custom_seller_name', e.target.value)}
                    className="w-full px-3 py-1.5 text-sm border border-input rounded-lg bg-secondary text-foreground" placeholder="ex: Ahmed — Commercial Casablanca" />
                </div>
              </div>

              {/* Phone */}
              <div>
                <label className="block text-xs font-medium text-foreground mb-1">Téléphone (WhatsApp)</label>
                <input type="tel" value={formData.phone} onChange={e => handleInputChange('phone', e.target.value)}
                  className="w-full px-3 py-1.5 text-sm border border-input rounded-lg bg-secondary text-foreground" placeholder="ex: 0661234567" />
                <p className="text-[10px] text-muted-foreground mt-1">Utilisé pour le partage WhatsApp vers le commercial.</p>
              </div>

              {/* Price type */}
              <div>
                <label className="block text-xs font-medium text-foreground mb-1">Type de prix affiché</label>
                <select value={formData.price_display_type} onChange={e => handleInputChange('price_display_type', e.target.value)}
                  className="w-full px-3 py-1.5 text-sm border border-input rounded-lg bg-secondary text-foreground">
                  <option value="normal">Prix Normal — prix de vente catalogue (100%)</option>
                  <option value="reseller">Prix Revendeur{priceRatios ? ` — -${priceRatios.reseller}% du prix normal` : ' — prix remisé partenaire'}</option>
                  <option value="buy">Prix d'Achat{priceRatios ? ` — -${priceRatios.buy}% du prix normal` : ' — coût de revient'}</option>
                  <option value="calculated">Prix Calculé — prix achat + % marge saisie</option>
                </select>
                {formData.price_display_type === 'normal' && <p className="text-[10px] text-muted-foreground mt-1">Prix TTC catalogue — utilisé pour les devis client standard.</p>}
                {formData.price_display_type === 'reseller' && <p className="text-[10px] text-amber-600 dark:text-amber-400 mt-1">⚠ Prix remisé pour revendeurs{priceRatios ? ` (≈ -${priceRatios.reseller}% vs prix normal)` : ''} — TTC catalogue.</p>}
                {formData.price_display_type === 'buy' && <p className="text-[10px] text-orange-600 dark:text-orange-400 mt-1">⚠ Prix coûtant{priceRatios ? ` (≈ -${priceRatios.buy}% vs prix normal)` : ''} — usage interne, marge nulle si facturé tel quel.</p>}
                {formData.price_display_type === 'calculated' && <p className="text-[10px] text-blue-600 dark:text-blue-400 mt-1">Prix d'achat + % marge défini ligne par ligne dans le devis.</p>}
              </div>

              {/* Brand restrictions */}
              {availableBrands.length > 0 && (
                <div>
                  <label className="block text-xs font-medium text-foreground mb-1">Marques autorisées</label>
                  <p className="text-[10px] text-muted-foreground mb-2">Vide = toutes les marques</p>
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-1.5 max-h-36 overflow-y-auto border border-input rounded-lg p-2.5">
                    {availableBrands.map(brand => (
                      <label key={brand} className="flex items-center space-x-1.5 cursor-pointer">
                        <input type="checkbox" checked={formData.allowed_brands.includes(brand)} onChange={() => handleBrandToggle(brand)} className="w-3.5 h-3.5 rounded accent-primary" />
                        <span className="text-xs text-foreground">{brand}</span>
                      </label>
                    ))}
                  </div>
                </div>
              )}

              {/* Stock location restrictions */}
              {availableStockLocations.length > 0 && (
                <div>
                  <label className="block text-xs font-medium text-foreground mb-1">Emplacements de stock autorisés</label>
                  <p className="text-[10px] text-muted-foreground mb-2">Vide = tous les emplacements</p>
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-1.5 max-h-36 overflow-y-auto border border-input rounded-lg p-2.5">
                    {availableStockLocations.map(location => (
                      <label key={location} className="flex items-center space-x-1.5 cursor-pointer">
                        <input type="checkbox" checked={formData.allowed_stock_locations.includes(location)} onChange={() => handleStockLocationToggle(location)} className="w-3.5 h-3.5 rounded accent-primary" />
                        <span className="text-xs text-foreground capitalize">{location.replace(/_/g, ' ')}</span>
                      </label>
                    ))}
                  </div>
                </div>
              )}

              {/* Actions */}
              <div className="flex space-x-2 pt-2">
                <button onClick={closeModal} className="flex-1 px-3 py-1.5 text-sm border border-input rounded-lg hover:bg-accent">Annuler</button>
                <button onClick={editingUser ? handleUpdateUser : handleCreateUser} disabled={isSubmitting}
                  className="flex-1 flex items-center justify-center space-x-1.5 px-3 py-1.5 text-sm bg-primary hover:bg-primary/90 text-primary-foreground rounded-lg disabled:opacity-50">
                  {isSubmitting
                    ? <><div className="animate-spin rounded-full h-3.5 w-3.5 border-b-2 border-white" /><span>Enregistrement...</span></>
                    : <><Save className="h-3.5 w-3.5" /><span>{editingUser ? 'Modifier' : 'Créer'}</span></>}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
