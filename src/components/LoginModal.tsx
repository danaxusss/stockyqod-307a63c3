import React, { useState } from 'react';
import { X, Shield, User, Eye, EyeOff, Package } from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import { useUserAuth } from '../hooks/useUserAuth';
import { SupabaseUsersService } from '../utils/supabaseUsers';
import { AppUser } from '../types';
import { useToast } from '../context/ToastContext';

interface LoginModalProps {
  roleType: 'user' | 'admin';
  isInitialGate?: boolean;
  onClose: () => void;
  onLoginSuccess?: () => void;
}

export function LoginModal({ roleType, isInitialGate = false, onClose, onLoginSuccess }: LoginModalProps) {
  const [pin, setPin] = useState('');
  const [username, setUsername] = useState('');
  const [selectedUsername, setSelectedUsername] = useState('');
  const [availableUsers, setAvailableUsers] = useState<AppUser[]>([]);
  const [isLoadingUsers, setIsLoadingUsers] = useState(false);
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [showPin, setShowPin] = useState(false);
  const { login: adminLogin, loginWithUsername: adminLoginWithUsername } = useAuth();
  const { loginWithPin: userLoginWithPin, loginWithCredentials: userLoginWithCredentials } = useUserAuth();
  const { showToast } = useToast();

  // Fetch users when modal opens for user login
  React.useEffect(() => {
    if (roleType === 'user') {
      const fetchUsers = async () => {
        setIsLoadingUsers(true);
        try {
          const users = await SupabaseUsersService.getAllUsers();
          setAvailableUsers(users.sort((a, b) => a.username.localeCompare(b.username)));
        } catch (error) {
          console.error('Failed to fetch users:', error);
          showToast({
            type: 'error',
            title: 'Erreur de chargement',
            message: 'Impossible de charger la liste des utilisateurs'
          });
        } finally {
          setIsLoadingUsers(false);
        }
      };

      fetchUsers();
    }
  }, [roleType, showToast]);

  const USER_PIN = '100300'; // 6-digit PIN for normal users

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    console.log('Login attempt:', { roleType, pin: pin.length === 6 ? '******' : 'invalid length' });
    
    if (pin.length !== 6) {
      setError('Le PIN doit contenir 6 chiffres');
      return;
    }

    // For user login, ensure a user is selected
    if (roleType === 'user' && !selectedUsername.trim()) {
      setError('Veuillez sélectionner votre nom d\'utilisateur');
      return;
    }

    setIsLoading(true);
    setError('');

    // Add a small delay to show loading state and make the login feel more secure
    setTimeout(() => {
      if (roleType === 'admin') {
        console.log('Attempting admin login...');
        
        const attemptLogin = async () => {
          let success = false;
          
          if (username.trim()) {
            // Try username/PIN login
            success = await adminLoginWithUsername(username.trim(), pin);
          } else {
            // Try PIN-only login (backward compatibility)
            success = await adminLogin(pin);
          }
          
          if (success) {
            console.log('Admin login successful');
            onLoginSuccess?.();
            onClose();
          } else {
            console.log('Admin login failed - invalid credentials');
            setError(username.trim() ? 'Nom d\'utilisateur ou PIN invalide' : 'PIN invalide');
            setPin('');
            setUsername('');
          }
          setIsLoading(false);
        };
        
        attemptLogin();
      } else {
        // User login - try both user PIN and admin PIN
        console.log('Attempting user login...');
        
        const attemptUserLogin = async () => {
          let success = false;
          
          // Always use username/PIN login for users now
          success = await userLoginWithCredentials(selectedUsername.trim(), pin);
          
          if (success) {
            console.log('User login successful');
            onLoginSuccess?.();
            onClose();
          } else {
            console.log('Login failed - invalid credentials');
            setError('Nom d\'utilisateur ou PIN invalide');
            setPin('');
            setSelectedUsername('');
          }
          setIsLoading(false);
        };
        
        attemptUserLogin();
      }
    }, 300);
  };

  const handlePinChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value.replace(/\D/g, '').slice(0, 6);
    setPin(value);
    setError('');
  };

  const handleUsernameChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setUsername(e.target.value);
    setError('');
  };

  const handleUserSelection = (e: React.ChangeEvent<HTMLSelectElement>) => {
    setSelectedUsername(e.target.value);
    setError('');
  };

  const getModalConfig = () => {
    if (roleType === 'admin') {
      return {
        icon: Shield,
        iconBg: 'bg-amber-100 dark:bg-amber-900',
        iconColor: 'text-amber-600 dark:text-amber-300',
        title: 'Accès Administrateur',
        description: username.trim() ? 'Nom d\'utilisateur et PIN' : 'PIN à 6 chiffres',
        submitText: 'Connexion'
      };
    } else {
      return {
        icon: User,
        iconBg: 'bg-blue-100 dark:bg-blue-900',
        iconColor: 'text-blue-600 dark:text-blue-300',
        title: 'Accès Utilisateur',
        description: 'Sélectionnez votre nom et entrez votre PIN',
        submitText: 'Accéder au Système'
      };
    }
  };

  const config = getModalConfig();
  const Icon = config.icon;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white dark:bg-slate-800 rounded-xl shadow-2xl max-w-md w-full">
        <div className="flex items-center justify-between p-6 border-b border-gray-200 dark:border-gray-700">
          <div className="flex items-center space-x-3">
            <div className={`p-2 ${config.iconBg} rounded-lg`}>
              <Icon className={`h-5 w-5 ${config.iconColor}`} />
            </div>
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
              {config.title}
            </h2>
          </div>
          {!isInitialGate && (
            <button
              onClick={onClose}
              disabled={isLoading}
              className="p-1 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors disabled:opacity-50"
            >
              <X className="h-5 w-5 text-gray-500" />
            </button>
          )}
        </div>

        <form onSubmit={handleSubmit} className="p-6">
          {roleType === 'user' && isInitialGate && (
            <div className="text-center mb-6">
              <div className="inline-flex items-center justify-center w-16 h-16 bg-gradient-to-r from-blue-500 to-blue-600 rounded-2xl mb-4">
                <Package className="h-8 w-8 text-white" />
              </div>
              <h3 className="text-xl font-bold text-gray-900 dark:text-white mb-2">
                Stocky - Système d'Inventaire
              </h3>
              <p className="text-gray-600 dark:text-gray-400">
                Entrez votre PIN pour accéder au système
              </p>
            </div>
          )}

          <div className="mb-4">
            {/* User selection dropdown for regular users */}
            {roleType === 'user' && (
              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Sélectionnez votre nom d'utilisateur
                </label>
                {isLoadingUsers ? (
                  <div className="w-full px-4 py-3 border border-gray-300 dark:border-gray-600 rounded-lg bg-gray-50 dark:bg-slate-600 text-gray-500 dark:text-gray-400 flex items-center justify-center">
                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-600 mr-2"></div>
                    Chargement des utilisateurs...
                  </div>
                ) : (
                  <select
                    value={selectedUsername}
                    onChange={handleUserSelection}
                    disabled={isLoading}
                    className="w-full px-4 py-3 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white dark:bg-slate-700 text-gray-900 dark:text-white disabled:opacity-50"
                  >
                    <option value="">Sélectionner votre nom d'utilisateur</option>
                    {availableUsers.map((user) => (
                      <option key={user.id} value={user.username}>
                        {user.username}
                      </option>
                    ))}
                  </select>
                )}
              </div>
            )}

            {/* Username field for admin (optional) */}
            {roleType === 'admin' && username && (
              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Nom d'utilisateur
                </label>
                <input
                  type="text"
                  value={username}
                  onChange={handleUsernameChange}
                  disabled={isLoading}
                  className="w-full px-4 py-3 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white dark:bg-slate-700 text-gray-900 dark:text-white disabled:opacity-50"
                  placeholder="Nom d'utilisateur"
                  autoComplete="username"
                />
              </div>
            )}
            
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              {config.description}
            </label>
            <div className="relative">
              <input
                type={showPin ? "text" : "password"}
                value={pin}
                onChange={handlePinChange}
                disabled={isLoading}
                className="w-full px-4 py-3 pr-12 text-center text-2xl tracking-widest border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white dark:bg-slate-700 text-gray-900 dark:text-white disabled:opacity-50"
                placeholder="••••••"
                maxLength={6}
                autoFocus
                autoComplete="off"
              />
              <button
                type="button"
                onClick={() => setShowPin(!showPin)}
                disabled={isLoading}
                className="absolute right-3 top-1/2 transform -translate-y-1/2 p-1 hover:bg-gray-100 dark:hover:bg-gray-600 rounded transition-colors disabled:opacity-50"
              >
                {showPin ? (
                  <EyeOff className="h-4 w-4 text-gray-500" />
                ) : (
                  <Eye className="h-4 w-4 text-gray-500" />
                )}
              </button>
            </div>
          </div>

          {error && (
            <div className="mb-4 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
              <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
            </div>
          )}

          <div className="flex space-x-3">
            {!isInitialGate && (
              <button
                type="button"
                onClick={onClose}
                disabled={isLoading}
                className="flex-1 px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors disabled:opacity-50"
              >
                Annuler
              </button>
            )}
            <button
              type="submit"
              disabled={pin.length !== 6 || (roleType === 'user' && !selectedUsername.trim()) || (roleType === 'admin' && username && !username.trim()) || isLoading || isLoadingUsers}
              className={`${isInitialGate ? 'w-full' : 'flex-1'} px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 dark:disabled:bg-gray-600 text-white rounded-lg transition-colors disabled:cursor-not-allowed flex items-center justify-center`}
            >
              {isLoading ? (
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
              ) : (
                config.submitText
              )}
            </button>
          </div>

          {roleType === 'user' && isInitialGate && (
            <div className="mt-4 text-center">
              <p className="text-xs text-gray-500 dark:text-gray-400">
                Système sécurisé - Accès autorisé uniquement
              </p>
              {roleType === 'admin' && (
                <button
                  type="button"
                  onClick={() => setUsername(username ? '' : 'admin')}
                  className="mt-2 text-xs text-blue-600 dark:text-blue-400 hover:underline"
                >
                  {username ? 'Utiliser PIN uniquement' : 'Connexion avec nom d\'utilisateur'}
                </button>
              )}
            </div>
          )}
        </form>
      </div>
    </div>
  );
}