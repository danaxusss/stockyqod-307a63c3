import React, { useState } from 'react';
import { X, Shield, User, Eye, EyeOff, Package } from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import { useUserAuth } from '../hooks/useUserAuth';
import { SupabaseUsersService } from '../utils/supabaseUsers';
import { SupabaseCompaniesService } from '../utils/supabaseCompanies';
import { AppUser, Company } from '../types';
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
  const [companiesMap, setCompaniesMap] = useState<Record<string, string>>({});
  const [isLoadingUsers, setIsLoadingUsers] = useState(false);
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [showPin, setShowPin] = useState(false);
  const { login: adminLogin, loginWithUsername: adminLoginWithUsername } = useAuth();
  const { loginWithPin: userLoginWithPin, loginWithCredentials: userLoginWithCredentials } = useUserAuth();
  const { showToast } = useToast();

  React.useEffect(() => {
    if (roleType === 'user') {
      const fetchUsers = async () => {
        setIsLoadingUsers(true);
        try {
          const [users, companies] = await Promise.all([
            SupabaseUsersService.getAllUsers(),
            SupabaseCompaniesService.getAllCompanies(),
          ]);
          const map: Record<string, string> = {};
          companies.forEach((c: Company) => { map[c.id] = c.name; });
          setCompaniesMap(map);
          setAvailableUsers(users.sort((a, b) => {
            const nameA = a.custom_seller_name || a.username;
            const nameB = b.custom_seller_name || b.username;
            return nameA.localeCompare(nameB);
          }));
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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (pin.length !== 6) {
      setError('Le PIN doit contenir 6 chiffres');
      return;
    }

    if (roleType === 'user' && !selectedUsername.trim()) {
      setError('Veuillez sélectionner votre nom d\'utilisateur');
      return;
    }

    setIsLoading(true);
    setError('');

    setTimeout(() => {
      if (roleType === 'admin') {
        const attemptLogin = async () => {
          let success = false;
          if (username.trim()) {
            success = await adminLoginWithUsername(username.trim(), pin);
          } else {
            success = await adminLogin(pin);
          }
          if (success) {
            onLoginSuccess?.();
            onClose();
          } else {
            setError(username.trim() ? 'Nom d\'utilisateur ou PIN invalide' : 'PIN invalide');
            setPin('');
            setUsername('');
          }
          setIsLoading(false);
        };
        attemptLogin();
      } else {
        const attemptUserLogin = async () => {
          const success = await userLoginWithCredentials(selectedUsername.trim(), pin);
          if (success) {
            onLoginSuccess?.();
            onClose();
          } else {
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

  const isAdminMode = roleType === 'admin';

  return (
    <div className="fixed inset-0 bg-background/80 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-card border border-border rounded-2xl shadow-2xl max-w-md w-full overflow-hidden" style={{ boxShadow: 'var(--shadow-elevated)' }}>
        {/* Header gradient bar */}
        <div className="h-1 w-full bg-gradient-to-r from-primary to-primary/60" />
        
        <div className="flex items-center justify-between p-6 border-b border-border">
          <div className="flex items-center space-x-3">
            <div className={`p-2.5 rounded-xl ${isAdminMode ? 'bg-primary/15 text-primary' : 'bg-accent text-accent-foreground'}`}>
              {isAdminMode ? <Shield className="h-5 w-5" /> : <User className="h-5 w-5" />}
            </div>
            <h2 className="text-lg font-semibold text-foreground">
              {isAdminMode ? 'Accès Administrateur' : 'Accès Utilisateur'}
            </h2>
          </div>
          {!isInitialGate && (
            <button
              onClick={onClose}
              disabled={isLoading}
              className="p-1.5 hover:bg-muted rounded-lg transition-colors disabled:opacity-50"
            >
              <X className="h-4 w-4 text-muted-foreground" />
            </button>
          )}
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-5">
          {roleType === 'user' && isInitialGate && (
            <div className="text-center">
              <div className="inline-flex items-center justify-center w-16 h-16 bg-primary rounded-2xl mb-4" style={{ boxShadow: 'var(--shadow-glow)' }}>
                <Package className="h-8 w-8 text-primary-foreground" />
              </div>
              <h3 className="text-xl font-bold text-foreground mb-1">
                Stocky
              </h3>
              <p className="text-sm text-muted-foreground">
                Entrez votre PIN pour accéder au système
              </p>
            </div>
          )}

          {/* User selection */}
          {roleType === 'user' && (
            <div>
              <label className="block text-sm font-medium text-foreground mb-2">
                Nom d'utilisateur
              </label>
              {isLoadingUsers ? (
                <div className="w-full px-4 py-3 border border-border rounded-xl bg-muted text-muted-foreground flex items-center justify-center">
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-primary mr-2"></div>
                  Chargement...
                </div>
              ) : (
                <select
                  value={selectedUsername}
                  onChange={handleUserSelection}
                  disabled={isLoading}
                  className="w-full px-4 py-3 border border-border rounded-xl focus:ring-2 focus:ring-ring focus:border-transparent bg-background text-foreground disabled:opacity-50 transition-all"
                >
                  <option value="">Sélectionner votre profil</option>
                  {availableUsers.map((user) => {
                    const companyName = user.company_id ? companiesMap[user.company_id] : null;
                    const label = user.custom_seller_name
                      ? `${user.custom_seller_name}${companyName ? ` (${companyName})` : ''}`
                      : user.username;
                    return (
                      <option key={user.id} value={user.username}>{label}</option>
                    );
                  })}
                </select>
              )}
            </div>
          )}

          {/* Admin username */}
          {roleType === 'admin' && username && (
            <div>
              <label className="block text-sm font-medium text-foreground mb-2">Nom d'utilisateur</label>
              <input
                type="text"
                value={username}
                onChange={handleUsernameChange}
                disabled={isLoading}
                className="w-full px-4 py-3 border border-border rounded-xl focus:ring-2 focus:ring-ring focus:border-transparent bg-background text-foreground disabled:opacity-50 transition-all"
                placeholder="Nom d'utilisateur"
                autoComplete="username"
              />
            </div>
          )}

          {/* PIN */}
          <div>
            <label className="block text-sm font-medium text-foreground mb-2">
              PIN à 6 chiffres
            </label>
            <div className="relative">
              <input
                type={showPin ? "text" : "password"}
                value={pin}
                onChange={handlePinChange}
                disabled={isLoading}
                className="w-full px-4 py-3 pr-12 text-center text-2xl tracking-[0.3em] border border-border rounded-xl focus:ring-2 focus:ring-ring focus:border-transparent bg-background text-foreground disabled:opacity-50 transition-all"
                placeholder="••••••"
                maxLength={6}
                autoFocus
                autoComplete="off"
              />
              <button
                type="button"
                onClick={() => setShowPin(!showPin)}
                disabled={isLoading}
                className="absolute right-3 top-1/2 transform -translate-y-1/2 p-1 hover:bg-muted rounded transition-colors disabled:opacity-50"
              >
                {showPin ? <EyeOff className="h-4 w-4 text-muted-foreground" /> : <Eye className="h-4 w-4 text-muted-foreground" />}
              </button>
            </div>
          </div>

          {error && (
            <div className="p-3 bg-destructive/10 border border-destructive/20 rounded-xl">
              <p className="text-sm text-destructive">{error}</p>
            </div>
          )}

          <div className="flex space-x-3 pt-1">
            {!isInitialGate && (
              <button
                type="button"
                onClick={onClose}
                disabled={isLoading}
                className="flex-1 px-4 py-2.5 border border-border rounded-xl hover:bg-muted transition-colors disabled:opacity-50 text-foreground"
              >
                Annuler
              </button>
            )}
            <button
              type="submit"
              disabled={pin.length !== 6 || (roleType === 'user' && !selectedUsername.trim()) || isLoading || isLoadingUsers}
              className={`${isInitialGate ? 'w-full' : 'flex-1'} px-4 py-2.5 bg-primary hover:bg-primary/90 disabled:bg-muted disabled:text-muted-foreground text-primary-foreground rounded-xl transition-all disabled:cursor-not-allowed flex items-center justify-center font-medium`}
            >
              {isLoading ? (
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-primary-foreground"></div>
              ) : (
                isAdminMode ? 'Connexion' : 'Accéder au Système'
              )}
            </button>
          </div>

          {roleType === 'user' && isInitialGate && (
            <p className="text-center text-xs text-muted-foreground">
              Système sécurisé — Accès autorisé uniquement
            </p>
          )}
        </form>
      </div>
    </div>
  );
}
