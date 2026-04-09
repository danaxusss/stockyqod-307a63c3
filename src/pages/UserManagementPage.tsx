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
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
          <p className="text-gray-600 dark:text-gray-400 mt-4">Chargement des utilisateurs...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div className="bg-white/90 dark:bg-slate-800/90 backdrop-blur-sm rounded-2xl shadow-xl p-6">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center space-x-3">
            <div className="p-3 bg-gradient-to-r from-purple-500 to-purple-600 rounded-xl">
              <Users className="h-6 w-6 text-white" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
                Gestion des Utilisateurs
              </h1>
              <p className="text-gray-600 dark:text-gray-400">
                Gérez les utilisateurs et leurs permissions
              </p>
            </div>
          </div>

          <button
            onClick={() => setShowCreateModal(true)}
            className="flex items-center space-x-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors"
          >
            <Plus className="h-4 w-4" />
            <span>Nouvel Utilisateur</span>
          </button>
        </div>

        {/* Statistics */}
        {stats && (
          <div className="grid grid-cols-1 md:grid-cols-5 gap-4 mb-6">
            <div className="bg-blue-50 dark:bg-blue-900/20 p-4 rounded-lg">
              <div className="flex items-center space-x-2">
                <Users className="h-5 w-5 text-blue-600 dark:text-blue-400" />
                <div>
                  <p className="text-sm text-blue-600 dark:text-blue-400">Total</p>
                  <p className="text-xl font-bold text-blue-900 dark:text-blue-100">{stats.totalUsers}</p>
                </div>
              </div>
            </div>
            
            <div className="bg-purple-50 dark:bg-purple-900/20 p-4 rounded-lg">
              <div className="flex items-center space-x-2">
                <Shield className="h-5 w-5 text-purple-600 dark:text-purple-400" />
                <div>
                  <p className="text-sm text-purple-600 dark:text-purple-400">Admins</p>
                  <p className="text-xl font-bold text-purple-900 dark:text-purple-100">{stats.adminUsers}</p>
                </div>
              </div>
            </div>
            
            <div className="bg-green-50 dark:bg-green-900/20 p-4 rounded-lg">
              <div className="flex items-center space-x-2">
                <User className="h-5 w-5 text-green-600 dark:text-green-400" />
                <div>
                  <p className="text-sm text-green-600 dark:text-green-400">Utilisateurs</p>
                  <p className="text-xl font-bold text-green-900 dark:text-green-100">{stats.regularUsers}</p>
                </div>
              </div>
            </div>
            
            <div className="bg-orange-50 dark:bg-orange-900/20 p-4 rounded-lg">
              <div className="flex items-center space-x-2">
                <UserCheck className="h-5 w-5 text-orange-600 dark:text-orange-400" />
                <div>
                  <p className="text-sm text-orange-600 dark:text-orange-400">Accès Devis</p>
                  <p className="text-xl font-bold text-orange-900 dark:text-orange-100">{stats.usersWithQuoteAccess}</p>
                </div>
              </div>
            </div>
            
            <div className="bg-red-50 dark:bg-red-900/20 p-4 rounded-lg">
              <div className="flex items-center space-x-2">
                <MapPin className="h-5 w-5 text-red-600 dark:text-red-400" />
                <div>
                  <p className="text-sm text-red-600 dark:text-red-400">Stock Limité</p>
                  <p className="text-xl font-bold text-red-900 dark:text-red-100">{stats.usersWithRestrictedStock}</p>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Filters */}
        <div className="flex flex-col sm:flex-row gap-4">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-10 pr-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white dark:bg-slate-700 text-gray-900 dark:text-white"
              placeholder="Rechercher un utilisateur..."
            />
          </div>
          
          <select
            value={filterRole}
            onChange={(e) => setFilterRole(e.target.value as 'all' | 'admin' | 'user')}
            className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white dark:bg-slate-700 text-gray-900 dark:text-white"
          >
            <option value="all">Tous les rôles</option>
            <option value="admin">Administrateurs</option>
            <option value="user">Utilisateurs</option>
          </select>
        </div>
      </div>

      {/* Users Table */}
      <div className="bg-white/90 dark:bg-slate-800/90 backdrop-blur-sm rounded-2xl shadow-xl overflow-hidden">
        {filteredUsers.length === 0 ? (
          <div className="p-12 text-center">
            <Users className="h-16 w-16 text-gray-400 mx-auto mb-4" />
            <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-2">
              {users.length === 0 ? 'Aucun Utilisateur' : 'Aucun Résultat'}
            </h3>
            <p className="text-gray-600 dark:text-gray-400">
              {users.length === 0 
                ? 'Créez votre premier utilisateur pour commencer'
                : 'Aucun utilisateur ne correspond à vos critères de recherche'
              }
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50 dark:bg-slate-700">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                    Utilisateur
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                    Rôle
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                    Permissions
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                    Stock Autorisé
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                    Type de Prix
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                {filteredUsers.map((user) => (
                  <tr key={user.id} className="hover:bg-gray-50 dark:hover:bg-slate-700/50">
                    <td className="px-4 py-4">
                      <div className="flex items-center space-x-3">
                        <div className={`p-2 rounded-lg ${user.is_admin ? 'bg-purple-100 dark:bg-purple-900/30' : 'bg-blue-100 dark:bg-blue-900/30'}`}>
                          {user.is_admin ? (
                            <Shield className="h-4 w-4 text-purple-600 dark:text-purple-400" />
                          ) : (
                            <User className="h-4 w-4 text-blue-600 dark:text-blue-400" />
                          )}
                        </div>
                        <div>
                          <div className="text-sm font-medium text-gray-900 dark:text-white">
                            {user.username}
                          </div>
                          <div className="text-sm text-gray-500 dark:text-gray-400">
                            Créé le {user.created_at.toLocaleDateString('fr-FR')}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-4">
                      <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${
                        user.is_admin
                          ? 'bg-purple-100 dark:bg-purple-900/20 text-purple-800 dark:text-purple-300'
                          : 'bg-blue-100 dark:bg-blue-900/20 text-blue-800 dark:text-blue-300'
                      }`}>
                        {user.is_admin ? 'Administrateur' : 'Utilisateur'}
                      </span>
                    </td>
                    <td className="px-4 py-4">
                      <div className="flex items-center space-x-2">
                        {user.can_create_quote ? (
                          <span className="inline-flex items-center px-2 py-1 text-xs bg-green-100 dark:bg-green-900/20 text-green-800 dark:text-green-300 rounded-full">
                            <UserCheck className="h-3 w-3 mr-1" />
                            Devis
                          </span>
                        ) : (
                          <span className="inline-flex items-center px-2 py-1 text-xs bg-red-100 dark:bg-red-900/20 text-red-800 dark:text-red-300 rounded-full">
                            <UserX className="h-3 w-3 mr-1" />
                            Pas de devis
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-4">
                      <div className="text-sm text-gray-900 dark:text-white">
                        {formatStockLocations(user.allowed_stock_locations)}
                      </div>
                    </td>
                    <td className="px-4 py-4">
                      <span className="inline-flex items-center px-2 py-1 text-xs bg-gray-100 dark:bg-gray-700 text-gray-800 dark:text-gray-300 rounded-full">
                        <DollarSign className="h-3 w-3 mr-1" />
                        {getPriceTypeLabel(user.price_display_type)}
                      </span>
                    </td>
                    <td className="px-4 py-4">
                      <div className="flex items-center space-x-2">
                        <button
                          onClick={() => handleEditUser(user)}
                          className="p-1 text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded transition-colors"
                          title="Modifier"
                        >
                          <Edit className="h-4 w-4" />
                        </button>
                        
                        <button
                          onClick={() => handleDeleteUser(user)}
                          className="p-1 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 rounded transition-colors"
                          title="Supprimer"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
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
          <div className="bg-white dark:bg-slate-800 rounded-xl shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between p-6 border-b border-gray-200 dark:border-gray-700">
              <div className="flex items-center space-x-3">
                <div className="p-2 bg-blue-100 dark:bg-blue-900 rounded-lg">
                  <User className="h-5 w-5 text-blue-600 dark:text-blue-300" />
                </div>
                <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
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
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                      Nom d'utilisateur *
                    </label>
                    <input
                      type="text"
                      value={formData.username}
                      onChange={(e) => handleInputChange('username', e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white dark:bg-slate-700 text-gray-900 dark:text-white"
                      placeholder="Nom d'utilisateur"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                      PIN (6 chiffres) *
                    </label>
                    <div className="relative">
                      <input
                        type={showPin ? "text" : "password"}
                        value={formData.pin}
                        onChange={(e) => handleInputChange('pin', e.target.value)}
                        className="w-full px-3 py-2 pr-10 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white dark:bg-slate-700 text-gray-900 dark:text-white"
                        placeholder="123456"
                        maxLength={6}
                      />
                      <button
                        type="button"
                        onClick={() => setShowPin(!showPin)}
                        className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
                      >
                        {showPin ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </button>
                    </div>
                  </div>
                </div>

                {/* Role and Permissions */}
                <div>
                  <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-4">
                    Rôle et Permissions
                  </h3>
                  
                  <div className="space-y-4">
                    <div className="flex items-center space-x-3">
                      <input
                        type="checkbox"
                        id="is_admin"
                        checked={formData.is_admin}
                        onChange={(e) => handleInputChange('is_admin', e.target.checked)}
                        className="w-4 h-4 text-blue-600 bg-gray-100 border-gray-300 rounded focus:ring-blue-500 dark:focus:ring-blue-600 dark:ring-offset-gray-800 focus:ring-2 dark:bg-gray-700 dark:border-gray-600"
                      />
                      <label htmlFor="is_admin" className="text-sm font-medium text-gray-900 dark:text-white">
                        Administrateur
                      </label>
                      <span className="text-xs text-gray-500 dark:text-gray-400">
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
                        className="w-4 h-4 text-blue-600 bg-gray-100 border-gray-300 rounded focus:ring-blue-500 dark:focus:ring-blue-600 dark:ring-offset-gray-800 focus:ring-2 dark:bg-gray-700 dark:border-gray-600"
                      />
                      <label htmlFor="is_reseller_account" className="text-sm font-medium text-gray-900 dark:text-white">
                        Compte Revendeur ?
                      </label>
                      <span className="text-xs text-gray-500 dark:text-gray-400">
                        (Affichage simplifié des produits)
                      </span>
                    </div>
                    <div className="flex items-center space-x-3">
                      <input
                        type="checkbox"
                        id="can_create_quote"
                        checked={formData.can_create_quote}
                        onChange={(e) => handleInputChange('can_create_quote', e.target.checked)}
                        className="w-4 h-4 text-blue-600 bg-gray-100 border-gray-300 rounded focus:ring-blue-500 dark:focus:ring-blue-600 dark:ring-offset-gray-800 focus:ring-2 dark:bg-gray-700 dark:border-gray-600"
                      />
                      <label htmlFor="can_create_quote" className="text-sm font-medium text-gray-900 dark:text-white">
                        Peut créer des devis
                      </label>
                      <span className="text-xs text-gray-500 dark:text-gray-400">
                        (Accès au panier et création de devis)
                      </span>
                    </div>
                  </div>
                </div>

                {/* Price Display Type */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    Type de Prix Affiché
                  </label>
                  <select
                    value={formData.price_display_type}
                    onChange={(e) => handleInputChange('price_display_type', e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white dark:bg-slate-700 text-gray-900 dark:text-white"
                  >
                    <option value="normal">Prix Normal</option>
                    <option value="reseller">Prix Revendeur</option>
                    <option value="buy">Prix d'Achat</option>
                    <option value="calculated">Prix Calculé (avec marge)</option>
                  </select>
                </div>

                {/* Brand Filtering */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    Marques Autorisées
                  </label>
                  <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">
                    Laissez vide pour autoriser toutes les marques
                  </p>
                  
                  {availableBrands.length > 0 ? (
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-2 max-h-40 overflow-y-auto border border-gray-300 dark:border-gray-600 rounded-lg p-3">
                      {availableBrands.map((brand) => (
                        <div key={brand} className="flex items-center space-x-2">
                          <input
                            type="checkbox"
                            id={`brand-${brand}`}
                            checked={formData.allowed_brands.includes(brand)}
                            onChange={() => handleBrandToggle(brand)}
                            className="w-4 h-4 text-blue-600 bg-gray-100 border-gray-300 rounded focus:ring-blue-500 dark:focus:ring-blue-600 dark:ring-offset-gray-800 focus:ring-2 dark:bg-gray-700 dark:border-gray-600"
                          />
                          <label 
                            htmlFor={`brand-${brand}`} 
                            className="text-sm text-gray-900 dark:text-white"
                          >
                            {brand}
                          </label>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="text-sm text-gray-500 dark:text-gray-400 italic">
                      Aucune marque disponible
                    </div>
                  )}
                </div>
                {/* Stock Locations */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    Emplacements de Stock Autorisés
                  </label>
                  <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">
                    Laissez vide pour autoriser tous les emplacements
                  </p>
                  
                  {availableStockLocations.length > 0 ? (
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-2 max-h-40 overflow-y-auto border border-gray-300 dark:border-gray-600 rounded-lg p-3">
                      {availableStockLocations.map((location) => (
                        <div key={location} className="flex items-center space-x-2">
                          <input
                            type="checkbox"
                            id={`location-${location}`}
                            checked={formData.allowed_stock_locations.includes(location)}
                            onChange={() => handleStockLocationToggle(location)}
                            className="w-4 h-4 text-blue-600 bg-gray-100 border-gray-300 rounded focus:ring-blue-500 dark:focus:ring-blue-600 dark:ring-offset-gray-800 focus:ring-2 dark:bg-gray-700 dark:border-gray-600"
                          />
                          <label 
                            htmlFor={`location-${location}`} 
                            className="text-sm text-gray-900 dark:text-white capitalize"
                          >
                            {location.replace(/_/g, ' ')}
                          </label>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="text-sm text-gray-500 dark:text-gray-400 italic">
                      Aucun emplacement de stock disponible
                    </div>
                  )}
                </div>
              </div>

              {/* Actions */}
              <div className="flex space-x-3 mt-8">
                <button
                  onClick={closeModal}
                  className="flex-1 px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
                >
                  Annuler
                </button>
                
                <button
                  onClick={editingUser ? handleUpdateUser : handleCreateUser}
                  disabled={isSubmitting}
                  className="flex-1 flex items-center justify-center space-x-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 dark:disabled:bg-gray-600 text-white rounded-lg transition-colors disabled:cursor-not-allowed"
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