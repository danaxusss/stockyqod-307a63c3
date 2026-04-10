// @ts-nocheck
import React, { useState, useEffect, useCallback } from 'react';
import { 
  Users, 
  Plus, 
  Edit, 
  Trash2, 
  Shield, 
  User, 
  Eye, 
  EyeOff,
  Save,
  X,
  AlertCircle,
  CheckCircle,
  Search,
  Filter,
  UserCheck,
  UserX,
  MapPin,
  DollarSign
} from 'lucide-react';
import { AppUser, CreateAppUserRequest, UpdateAppUserRequest } from '../types';
import { SupabaseUsersService } from '../utils/supabaseUsers';
import { useToast } from '../context/ToastContext';
import { useAuth } from '../hooks/useAuth';

interface UserFormData {
  username: string;
  pin: string;
  is_admin: boolean;
  can_create_quote: boolean;
  allowed_stock_locations: string[];
  allowed_brands: string[];
  price_display_type: string;
}

const initialFormData: UserFormData = {
  username: '',
  pin: '',
  is_admin: false,
  can_create_quote: true,
  allowed_stock_locations: [],
  allowed_brands: [],
  price_display_type: 'normal'
};

export default function UserManagementPage() {
  const { showToast } = useToast();
  const { isAdmin } = useAuth();

  // Data state
  const [users, setUsers] = useState<AppUser[]>([]);
  const [availableStockLocations, setAvailableStockLocations] = useState<string[]>([]);
  const [availableBrands, setAvailableBrands] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [stats, setStats] = useState<any>(null);

  // UI state
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editingUser, setEditingUser] = useState<AppUser | null>(null);
  const [formData, setFormData] = useState<UserFormData>(initialFormData);
  const [showPin, setShowPin] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterRole, setFilterRole] = useState<'all' | 'admin' | 'user'>('all');
  const [validationErrors, setValidationErrors] = useState<string[]>([]);

  // Reseller account state
  const [isResellerAccountChecked, setIsResellerAccountChecked] = useState(false);

  // Load data
  const loadData = useCallback(async () => {
    setIsLoading(true);
    try {
      const [usersData, locationsData, brandsData, statsData] = await Promise.all([
        SupabaseUsersService.getAllUsers(),
        SupabaseUsersService.getAvailableStockLocations(),
        SupabaseUsersService.getAvailableBrands(),
        SupabaseUsersService.getUserStats()
      ]);
      
      setUsers(usersData);
      setAvailableStockLocations(locationsData);
      setAvailableBrands(brandsData);
      setStats(statsData);
    } catch (error) {
      console.error('Failed to load user management data:', error);
      showToast({
        type: 'error',
        title: 'Erreur de chargement',
        message: 'Impossible de charger les données utilisateurs'
      });
    } finally {
      setIsLoading(false);
    }
  }, [showToast]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Form handlers
  const handleInputChange = (field: keyof UserFormData, value: any) => {
    setFormData(prev => ({ ...prev, [field]: value }));
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
    setValidationErrors(errors);
    return errors.length === 0;
  };

  const handleCreateUser = async () => {
    if (!validateForm()) return;

    setIsSubmitting(true);
    try {
      // Check username availability
      const isAvailable = await SupabaseUsersService.isUsernameAvailable(formData.username);
      if (!isAvailable) {
        setValidationErrors(['Ce nom d\'utilisateur est déjà pris']);
        return;
      }

      const userData: CreateAppUserRequest = {
        username: formData.username.trim(),
        pin: formData.pin,
        is_admin: formData.is_admin,
        can_create_quote: formData.can_create_quote,
        allowed_stock_locations: formData.allowed_stock_locations,
        price_display_type: formData.price_display_type
      };

      await SupabaseUsersService.createUser(userData);
      
      showToast({
        type: 'success',
        title: 'Utilisateur créé',
        message: `L'utilisateur ${formData.username} a été créé avec succès`
      });

      setShowCreateModal(false);
      setFormData(initialFormData);
      await loadData();
    } catch (error) {
      console.error('Failed to create user:', error);
      showToast({
        type: 'error',
        title: 'Erreur de création',
        message: error instanceof Error ? error.message : 'Impossible de créer l\'utilisateur'
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleEditUser = (user: AppUser) => {
    setEditingUser(user);
    const isReseller = user.price_display_type === 'reseller';
    setIsResellerAccountChecked(isReseller);
    setFormData({
      username: user.username,
      pin: user.pin,
      is_admin: user.is_admin,
      can_create_quote: user.can_create_quote,
      allowed_stock_locations: user.allowed_stock_locations,
      allowed_brands: user.allowed_brands || [],
      price_display_type: user.price_display_type
    });
  };

  const handleUpdateUser = async () => {
    if (!editingUser || !validateForm()) return;

    setIsSubmitting(true);
    try {
      // Check username availability (excluding current user)
      if (formData.username !== editingUser.username) {
        const isAvailable = await SupabaseUsersService.isUsernameAvailable(formData.username, editingUser.id);
        if (!isAvailable) {
          setValidationErrors(['Ce nom d\'utilisateur est déjà pris']);
          return;
        }
      }

      const updates: UpdateAppUserRequest = {
        username: formData.username.trim(),
        pin: formData.pin,
        is_admin: formData.is_admin,
        can_create_quote: formData.can_create_quote,
        allowed_stock_locations: formData.allowed_stock_locations,
        allowed_brands: formData.allowed_brands,
        price_display_type: formData.price_display_type
      };

      await SupabaseUsersService.updateUser(editingUser.id, updates);
      
      showToast({
        type: 'success',
        title: 'Utilisateur modifié',
        message: `L'utilisateur ${formData.username} a été modifié avec succès`
      });

      setEditingUser(null);
      setFormData(initialFormData);
      await loadData();
    } catch (error) {
      console.error('Failed to update user:', error);
      showToast({
        type: 'error',
        title: 'Erreur de modification',
        message: error instanceof Error ? error.message : 'Impossible de modifier l\'utilisateur'
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDeleteUser = async (user: AppUser) => {
    const confirmed = window.confirm(
      `Êtes-vous sûr de vouloir supprimer l'utilisateur "${user.username}" ?\n\nCette action est irréversible.`
    );

    if (!confirmed) return;

    try {
      await SupabaseUsersService.deleteUser(user.id);
      
      showToast({
        type: 'success',
        title: 'Utilisateur supprimé',
        message: `L'utilisateur ${user.username} a été supprimé avec succès`
      });

      await loadData();
    } catch (error) {
      console.error('Failed to delete user:', error);
      showToast({
        type: 'error',
        title: 'Erreur de suppression',
        message: error instanceof Error ? error.message : 'Impossible de supprimer l\'utilisateur'
      });
    }
  };

  const closeModal = () => {
    setShowCreateModal(false);
    setEditingUser(null);
    setFormData(initialFormData);
    setValidationErrors([]);
    setShowPin(false);
    setIsResellerAccountChecked(false);
  };

  // Filter users
  const filteredUsers = users.filter(user => {
    const matchesSearch = user.username.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesRole = filterRole === 'all' || 
                       (filterRole === 'admin' && user.is_admin) || 
                       (filterRole === 'user' && !user.is_admin);
    return matchesSearch && matchesRole;
  });

  const formatStockLocations = (locations: string[]) => {
    if (locations.length === 0) return 'Tous les emplacements';
    if (locations.length <= 2) return locations.join(', ');
    return `${locations.slice(0, 2).join(', ')} +${locations.length - 2}`;
  };

  const getPriceTypeLabel = (type: string) => {
    const labels = {
      normal: 'Prix Normal',
      reseller: 'Prix Revendeur',
      buy: 'Prix d\'Achat',
      calculated: 'Prix Calculé'
    };
    return labels[type as keyof typeof labels] || type;
  };

  if (isLoading) {
    return (
      <div className="max-w-7xl mx-auto">
        <div className="text-center py-12">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto"></div>
          <p className="text-muted-foreground mt-4">Chargement des utilisateurs...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="glass rounded-xl shadow-lg p-4">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center space-x-2.5">
            <div className="p-2 bg-primary rounded-lg">
              <Users className="h-4 w-4 text-primary-foreground" />
            </div>
            <div>
              <h1 className="text-lg font-bold text-foreground">Gestion Utilisateurs</h1>
              <p className="text-xs text-muted-foreground">Gérez les permissions</p>
            </div>
          </div>
          <button onClick={() => setShowCreateModal(true)} className="flex items-center space-x-1.5 px-3 py-1.5 bg-primary hover:bg-primary/90 text-primary-foreground rounded-lg transition-colors text-sm">
            <Plus className="h-3.5 w-3.5" /><span>Nouveau</span>
          </button>
        </div>

        {/* Statistics */}
        {stats && (
          <div className="grid grid-cols-2 md:grid-cols-5 gap-2.5 mb-4">
            {[
              { icon: Users, label: 'Total', value: stats.totalUsers, color: 'blue' },
              { icon: Shield, label: 'Admins', value: stats.adminUsers, color: 'purple' },
              { icon: User, label: 'Users', value: stats.regularUsers, color: 'green' },
              { icon: UserCheck, label: 'Devis', value: stats.usersWithQuoteAccess, color: 'orange' },
              { icon: MapPin, label: 'Stock Limité', value: stats.usersWithRestrictedStock, color: 'red' },
            ].map(({ icon: Icon, label, value, color }) => (
              <div key={label} className={`bg-${color}-50 dark:bg-${color}-900/20 p-2.5 rounded-lg`}>
                <div className="flex items-center space-x-1.5">
                  <Icon className={`h-4 w-4 text-${color}-600 dark:text-${color}-400`} />
                  <div>
                    <p className={`text-[10px] text-${color}-600 dark:text-${color}-400`}>{label}</p>
                    <p className={`text-base font-bold text-${color}-900 dark:text-${color}-100`}>{value}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Filters */}
        <div className="flex flex-col sm:flex-row gap-2.5">
          <div className="relative flex-1">
            <Search className="absolute left-2.5 top-1/2 transform -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <input type="text" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-8 pr-3 py-1.5 text-sm border border-input rounded-lg focus:ring-2 focus:ring-ring bg-secondary text-foreground" placeholder="Rechercher..." />
          </div>
          <select value={filterRole} onChange={(e) => setFilterRole(e.target.value as 'all' | 'admin' | 'user')}
            className="px-2.5 py-1.5 text-sm border border-input rounded-lg focus:ring-2 focus:ring-ring bg-secondary text-foreground">
            <option value="all">Tous</option><option value="admin">Admins</option><option value="user">Users</option>
          </select>
        </div>
      </div>

      {/* Users Table */}
      <div className="glass rounded-xl shadow-lg overflow-hidden">
        {filteredUsers.length === 0 ? (
          <div className="p-8 text-center">
            <Users className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
            <h3 className="text-base font-medium text-foreground mb-1">{users.length === 0 ? 'Aucun Utilisateur' : 'Aucun Résultat'}</h3>
            <p className="text-sm text-muted-foreground">{users.length === 0 ? 'Créez votre premier utilisateur' : 'Aucun résultat'}</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-secondary">
                <tr>
                  {['Utilisateur', 'Rôle', 'Permissions', 'Stock', 'Prix', 'Actions'].map(h => (
                    <th key={h} className="px-3 py-2 text-left text-[11px] font-medium text-muted-foreground uppercase tracking-wider">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                {filteredUsers.map((user) => (
                  <tr key={user.id} className="hover:bg-accent/50">
                    <td className="px-3 py-2.5">
                      <div className="flex items-center space-x-2">
                        <div className={`p-1 rounded ${user.is_admin ? 'bg-purple-100 dark:bg-purple-900/30' : 'bg-blue-100 dark:bg-blue-900/30'}`}>
                          {user.is_admin ? <Shield className="h-3 w-3 text-purple-600 dark:text-purple-400" /> : <User className="h-3 w-3 text-blue-600 dark:text-blue-400" />}
                        </div>
                        <div>
                          <div className="text-xs font-medium text-foreground">{user.username}</div>
                          <div className="text-[10px] text-muted-foreground">{user.created_at.toLocaleDateString('fr-FR')}</div>
                        </div>
                      </div>
                    </td>
                    <td className="px-3 py-2.5">
                      <span className={`inline-flex px-1.5 py-0.5 text-[10px] font-semibold rounded-full ${user.is_admin ? 'bg-purple-100 dark:bg-purple-900/20 text-purple-800 dark:text-purple-300' : 'bg-blue-100 dark:bg-blue-900/20 text-blue-800 dark:text-blue-300'}`}>
                        {user.is_admin ? 'Admin' : 'User'}
                      </span>
                    </td>
                    <td className="px-3 py-2.5">
                      {user.can_create_quote ? (
                        <span className="inline-flex items-center px-1.5 py-0.5 text-[10px] bg-green-100 dark:bg-green-900/20 text-green-800 dark:text-green-300 rounded-full">
                          <UserCheck className="h-2.5 w-2.5 mr-0.5" />Devis
                        </span>
                      ) : (
                        <span className="inline-flex items-center px-1.5 py-0.5 text-[10px] bg-red-100 dark:bg-red-900/20 text-red-800 dark:text-red-300 rounded-full">
                          <UserX className="h-2.5 w-2.5 mr-0.5" />Non
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-xs text-foreground">{formatStockLocations(user.allowed_stock_locations)}</td>
                    <td className="px-3 py-2.5">
                      <span className="inline-flex items-center px-1.5 py-0.5 text-[10px] bg-secondary text-gray-800 dark:text-gray-300 rounded-full">
                        <DollarSign className="h-2.5 w-2.5 mr-0.5" />{getPriceTypeLabel(user.price_display_type)}
                      </span>
                    </td>
                    <td className="px-3 py-2.5">
                      <div className="flex items-center space-x-1">
                        <button onClick={() => handleEditUser(user)} className="p-1 text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded transition-colors" title="Modifier"><Edit className="h-3.5 w-3.5" /></button>
                        <button onClick={() => handleDeleteUser(user)} className="p-1 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 rounded transition-colors" title="Supprimer"><Trash2 className="h-3.5 w-3.5" /></button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Create/Edit User Modal */}
      {(showCreateModal || editingUser) && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-card rounded-xl shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between p-6 border-b border-border">
              <div className="flex items-center space-x-3">
                <div className="p-2 bg-blue-100 dark:bg-blue-900 rounded-lg">
                  <User className="h-5 w-5 text-blue-600 dark:text-blue-300" />
                </div>
                <h2 className="text-lg font-semibold text-foreground">
                  {editingUser ? 'Modifier l\'Utilisateur' : 'Nouvel Utilisateur'}
                </h2>
              </div>
              <button
                onClick={closeModal}
                className="p-1 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
              >
                <X className="h-5 w-5 text-gray-500" />
              </button>
            </div>

            <div className="p-6">
              {/* Validation Errors */}
              {validationErrors.length > 0 && (
                <div className="mb-6 p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
                  <div className="flex items-center space-x-2 mb-2">
                    <AlertCircle className="h-4 w-4 text-red-600 dark:text-red-400" />
                    <h3 className="text-sm font-medium text-red-800 dark:text-red-200">
                      Erreurs de validation
                    </h3>
                  </div>
                  <ul className="text-sm text-red-700 dark:text-red-300 space-y-1">
                    {validationErrors.map((error, index) => (
                      <li key={index}>• {error}</li>
                    ))}
                  </ul>
                </div>
              )}

              <div className="space-y-6">
                {/* Basic Info */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-foreground mb-2">
                      Nom d'utilisateur *
                    </label>
                    <input
                      type="text"
                      value={formData.username}
                      onChange={(e) => handleInputChange('username', e.target.value)}
                      className="w-full px-3 py-2 border border-input rounded-lg focus:ring-2 focus:ring-ring bg-secondary text-foreground"
                      placeholder="Nom d'utilisateur"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-foreground mb-2">
                      PIN (6 chiffres) *
                    </label>
                    <div className="relative">
                      <input
                        type={showPin ? "text" : "password"}
                        value={formData.pin}
                        onChange={(e) => handleInputChange('pin', e.target.value)}
                        className="w-full px-3 py-2 pr-10 border border-input rounded-lg focus:ring-2 focus:ring-ring bg-secondary text-foreground"
                        placeholder="123456"
                        maxLength={6}
                      />
                      <button
                        type="button"
                        onClick={() => setShowPin(!showPin)}
                        className="absolute right-3 top-1/2 transform -translate-y-1/2 text-muted-foreground hover:text-gray-600 dark:hover:text-gray-300"
                      >
                        {showPin ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </button>
                    </div>
                  </div>
                </div>

                {/* Role and Permissions */}
                <div>
                  <h3 className="text-lg font-medium text-foreground mb-4">
                    Rôle et Permissions
                  </h3>
                  
                  <div className="space-y-4">
                    <div className="flex items-center space-x-3">
                      <input
                        type="checkbox"
                        id="is_admin"
                        checked={formData.is_admin}
                        onChange={(e) => handleInputChange('is_admin', e.target.checked)}
                        className="w-4 h-4 text-blue-600 bg-gray-100 border-gray-300 rounded focus:ring-ring dark:focus:ring-blue-600 dark:ring-offset-gray-800 focus:ring-2 dark:bg-gray-700 dark:border-gray-600"
                      />
                      <label htmlFor="is_admin" className="text-sm font-medium text-foreground">
                        Administrateur
                      </label>
                      <span className="text-xs text-muted-foreground">
                        (Accès complet au système)
                      </span>
                    </div>

                    <div className="flex items-center space-x-3">
                      <input
                        type="checkbox"
                        id="is_reseller_account"
                        checked={isResellerAccountChecked}
                        onChange={(e) => {
                          setIsResellerAccountChecked(e.target.checked);
                        }}
                        className="w-4 h-4 text-blue-600 bg-gray-100 border-gray-300 rounded focus:ring-ring dark:focus:ring-blue-600 dark:ring-offset-gray-800 focus:ring-2 dark:bg-gray-700 dark:border-gray-600"
                      />
                      <label htmlFor="is_reseller_account" className="text-sm font-medium text-foreground">
                        Compte Revendeur ?
                      </label>
                      <span className="text-xs text-muted-foreground">
                        (Affichage simplifié des produits)
                      </span>
                    </div>
                    <div className="flex items-center space-x-3">
                      <input
                        type="checkbox"
                        id="can_create_quote"
                        checked={formData.can_create_quote}
                        onChange={(e) => handleInputChange('can_create_quote', e.target.checked)}
                        className="w-4 h-4 text-blue-600 bg-gray-100 border-gray-300 rounded focus:ring-ring dark:focus:ring-blue-600 dark:ring-offset-gray-800 focus:ring-2 dark:bg-gray-700 dark:border-gray-600"
                      />
                      <label htmlFor="can_create_quote" className="text-sm font-medium text-foreground">
                        Peut créer des devis
                      </label>
                      <span className="text-xs text-muted-foreground">
                        (Accès au panier et création de devis)
                      </span>
                    </div>
                  </div>
                </div>

                {/* Price Display Type */}
                <div>
                  <label className="block text-sm font-medium text-foreground mb-2">
                    Type de Prix Affiché
                  </label>
                  <select
                    value={formData.price_display_type}
                    onChange={(e) => handleInputChange('price_display_type', e.target.value)}
                    className="w-full px-3 py-2 border border-input rounded-lg focus:ring-2 focus:ring-ring bg-secondary text-foreground"
                  >
                    <option value="normal">Prix Normal</option>
                    <option value="reseller">Prix Revendeur</option>
                    <option value="buy">Prix d'Achat</option>
                    <option value="calculated">Prix Calculé (avec marge)</option>
                  </select>
                </div>

                {/* Brand Filtering */}
                <div>
                  <label className="block text-sm font-medium text-foreground mb-2">
                    Marques Autorisées
                  </label>
                  <p className="text-xs text-muted-foreground mb-3">
                    Laissez vide pour autoriser toutes les marques
                  </p>
                  
                  {availableBrands.length > 0 ? (
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-2 max-h-40 overflow-y-auto border border-input rounded-lg p-3">
                      {availableBrands.map((brand) => (
                        <div key={brand} className="flex items-center space-x-2">
                          <input
                            type="checkbox"
                            id={`brand-${brand}`}
                            checked={formData.allowed_brands.includes(brand)}
                            onChange={() => handleBrandToggle(brand)}
                            className="w-4 h-4 text-blue-600 bg-gray-100 border-gray-300 rounded focus:ring-ring dark:focus:ring-blue-600 dark:ring-offset-gray-800 focus:ring-2 dark:bg-gray-700 dark:border-gray-600"
                          />
                          <label 
                            htmlFor={`brand-${brand}`} 
                            className="text-sm text-foreground"
                          >
                            {brand}
                          </label>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="text-sm text-muted-foreground italic">
                      Aucune marque disponible
                    </div>
                  )}
                </div>
                {/* Stock Locations */}
                <div>
                  <label className="block text-sm font-medium text-foreground mb-2">
                    Emplacements de Stock Autorisés
                  </label>
                  <p className="text-xs text-muted-foreground mb-3">
                    Laissez vide pour autoriser tous les emplacements
                  </p>
                  
                  {availableStockLocations.length > 0 ? (
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-2 max-h-40 overflow-y-auto border border-input rounded-lg p-3">
                      {availableStockLocations.map((location) => (
                        <div key={location} className="flex items-center space-x-2">
                          <input
                            type="checkbox"
                            id={`location-${location}`}
                            checked={formData.allowed_stock_locations.includes(location)}
                            onChange={() => handleStockLocationToggle(location)}
                            className="w-4 h-4 text-blue-600 bg-gray-100 border-gray-300 rounded focus:ring-ring dark:focus:ring-blue-600 dark:ring-offset-gray-800 focus:ring-2 dark:bg-gray-700 dark:border-gray-600"
                          />
                          <label 
                            htmlFor={`location-${location}`} 
                            className="text-sm text-foreground capitalize"
                          >
                            {location.replace(/_/g, ' ')}
                          </label>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="text-sm text-muted-foreground italic">
                      Aucun emplacement de stock disponible
                    </div>
                  )}
                </div>
              </div>

              {/* Actions */}
              <div className="flex space-x-3 mt-8">
                <button
                  onClick={closeModal}
                  className="flex-1 px-4 py-2 border border-input rounded-lg hover:bg-accent transition-colors"
                >
                  Annuler
                </button>
                
                <button
                  onClick={editingUser ? handleUpdateUser : handleCreateUser}
                  disabled={isSubmitting}
                  className="flex-1 flex items-center justify-center space-x-2 px-4 py-2 bg-primary hover:bg-primary/90 disabled:bg-gray-300 dark:disabled:bg-gray-600 text-primary-foreground rounded-lg transition-colors disabled:cursor-not-allowed"
                >
                  {isSubmitting ? (
                    <>
                      <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                      <span>{editingUser ? 'Modification...' : 'Création...'}</span>
                    </>
                  ) : (
                    <>
                      <Save className="h-4 w-4" />
                      <span>{editingUser ? 'Modifier' : 'Créer'}</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}