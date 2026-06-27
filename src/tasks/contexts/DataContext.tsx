import React, { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react';
import { Task, TaskStatus, Contact, User, UserRole } from '@/tasks/types';
import { useNotifications } from '@/tasks/contexts/NotificationContext';
import { useAuth } from '@/tasks/contexts/AuthAdapter';
import { sendWhatsAppNotification } from '@/tasks/lib/whatsapp';
import { supabase } from '@/integrations/supabase/client';
import { getCompanyContext } from '@/utils/supabaseCompanyFilter';

interface DataContextType {
  tasks: Task[];
  contacts: Contact[];
  users: User[];
  usersLoading: boolean;
  updateTaskStatus: (taskId: string, status: TaskStatus, comment?: string) => void;
  addTask: (task: Task) => void;
  deleteTask: (taskId: string) => void;
  updateTask: (taskId: string, updates: Partial<Task>) => void;
  addContact: (contact: Contact) => void;
  deleteContact: (contactId: string) => void;
  getUserById: (id: string) => User | undefined;
}

const DataContext = createContext<DataContextType | undefined>(undefined);

// Map an app-wide app_users row into the Tasks module's User shape.
// Only users with tasks access (super_admin or a tasks_role) participate.
function mapAppUserToTaskUser(data: any): User | null {
  const isSuper = data.is_superadmin === true;
  const role: UserRole | null = isSuper ? 'super_admin' : (data.tasks_role ?? null);
  if (!role) return null;
  return {
    id: data.id,
    pin: data.pin || '',
    first_name: (data.custom_seller_name && String(data.custom_seller_name).trim()) || data.username || '—',
    last_name: '',
    role,
    phone: data.phone || undefined,
    avatar_url: undefined,
    is_active: true,
    created_at: data.created_at ? String(data.created_at) : new Date().toISOString(),
  };
}

function mapDbTask(data: any): Task {
  return {
    id: data.id,
    company_id: data.company_id ?? null,
    type: data.type,
    status: data.status,
    client_name: data.client_name,
    client_phone: data.client_phone,
    address: data.address,
    problem_details: data.problem_details || undefined,
    invoice_number: data.invoice_number || undefined,
    payment_details: data.payment_details || undefined,
    comment: data.comment || undefined,
    priority: data.priority,
    created_by: data.created_by,
    assigned_to: data.assigned_to,
    due_date: data.due_date || undefined,
    archived_at: data.archived_at || undefined,
    edited: data.edited,
    created_at: data.created_at,
    updated_at: data.updated_at,
  };
}

function mapDbContact(data: any): Contact {
  return {
    id: data.id,
    company_id: data.company_id ?? null,
    name: data.name,
    phone: data.phone || '',
    role_label: data.role_label || '',
    created_by: data.created_by,
    created_at: data.created_at,
  };
}

export function DataProvider({ children }: { children: React.ReactNode }) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [usersLoading, setUsersLoading] = useState(true);
  const { addNotification } = useNotifications();
  const { user: currentUser } = useAuth();
  const skipRealtimeRef = useRef<Set<string>>(new Set());

  const fetchTasks = useCallback(async () => {
    const ctx = getCompanyContext();
    let query = supabase.from('tasks').select('*').order('created_at', { ascending: false });
    if (ctx.companyId && !ctx.bypassFilter) query = query.eq('company_id', ctx.companyId);
    const { data, error } = await query;
    if (!error && data) setTasks(data.map(mapDbTask));
  }, []);

  const fetchContacts = useCallback(async () => {
    const ctx = getCompanyContext();
    let query = supabase.from('task_contacts').select('*').order('created_at', { ascending: false });
    if (ctx.companyId && !ctx.bypassFilter) query = query.eq('company_id', ctx.companyId);
    const { data, error } = await query;
    if (!error && data) setContacts(data.map(mapDbContact));
  }, []);

  const fetchUsers = useCallback(async () => {
    setUsersLoading(true);
    const { data, error } = await supabase.from('app_users').select('*').order('created_at');
    if (!error && data) {
      setUsers(data.map(mapAppUserToTaskUser).filter((u): u is User => u !== null));
    }
    setUsersLoading(false);
  }, []);

  useEffect(() => {
    fetchTasks();
    fetchContacts();
    fetchUsers();
  }, [fetchTasks, fetchContacts, fetchUsers]);

  // Realtime subscription for tasks
  useEffect(() => {
    const channel = supabase
      .channel('tasks-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tasks' }, (payload) => {
        if (payload.eventType === 'INSERT') {
          const newTask = mapDbTask(payload.new);
          if (skipRealtimeRef.current.has(newTask.id)) {
            skipRealtimeRef.current.delete(newTask.id);
            return;
          }
          setTasks(prev => {
            if (prev.some(t => t.id === newTask.id)) return prev;
            return [newTask, ...prev];
          });
        } else if (payload.eventType === 'UPDATE') {
          const updated = mapDbTask(payload.new);
          setTasks(prev => prev.map(t => t.id === updated.id ? updated : t));
        } else if (payload.eventType === 'DELETE') {
          const deletedId = (payload.old as any).id;
          setTasks(prev => prev.filter(t => t.id !== deletedId));
        }
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, []);

  const getAdminIds = useCallback(() => {
    return users.filter(u => u.role === 'super_admin').map(u => u.id);
  }, [users]);

  const getPhonesForUserIds = useCallback((userIds: string[]) => {
    return userIds
      .map(id => users.find(u => u.id === id)?.phone)
      .filter(Boolean) as string[];
  }, [users]);

  const updateTaskStatus = useCallback(async (taskId: string, status: TaskStatus, comment?: string) => {
    const task = tasks.find(t => t.id === taskId);
    if (!task) return;

    const statusLabels: Record<TaskStatus, string> = { pending: 'En attente', doing: 'En cours', done: 'Terminé', refused: 'Refusé' };
    const notifyIds = new Set([task.created_by, task.assigned_to]);
    if (currentUser) notifyIds.delete(currentUser.id);
    const pushIds: string[] = [];
    notifyIds.forEach(uid => {
      addNotification(uid, 'status_changed', 'Statut modifié', `${task.client_name}: ${statusLabels[status]}`, taskId);
      pushIds.push(uid);
    });
    if (pushIds.length > 0) {
      const phones = getPhonesForUserIds(pushIds);
      sendWhatsAppNotification(phones, 'Statut modifié', `${task.client_name}: ${statusLabels[status]}`, taskId, 'status_changed');
    }

    const updateData: any = { status, updated_at: new Date().toISOString() };
    if (comment) updateData.comment = comment;
    if (status === 'done') updateData.archived_at = new Date().toISOString();

    await supabase.from('tasks').update(updateData).eq('id', taskId);
  }, [tasks, addNotification, currentUser, getPhonesForUserIds]);

  const addTask = useCallback(async (task: Task) => {
    const ctx = getCompanyContext();
    skipRealtimeRef.current.add(task.id);
    setTasks(prev => [task, ...prev]);

    if (task.assigned_to !== task.created_by) {
      addNotification(task.assigned_to, 'task_assigned', 'Nouvelle tâche assignée', `${task.client_name}: ${task.problem_details || 'Nouvelle tâche'}`, task.id);
      const assigneePhones = getPhonesForUserIds([task.assigned_to]);
      sendWhatsAppNotification(assigneePhones, 'Nouvelle tâche assignée', `${task.client_name}: ${task.problem_details || 'Nouvelle tâche'}`, task.id, 'task_assigned');
    }
    const adminPushIds: string[] = [];
    getAdminIds().forEach(adminId => {
      if (adminId !== task.created_by) {
        addNotification(adminId, 'task_created', 'Tâche créée', `${task.client_name} par ${currentUser?.first_name || 'un utilisateur'}`, task.id);
        adminPushIds.push(adminId);
      }
    });
    if (adminPushIds.length > 0) {
      const adminPhones = getPhonesForUserIds(adminPushIds);
      sendWhatsAppNotification(adminPhones, 'Tâche créée', `${task.client_name} par ${currentUser?.first_name || 'un utilisateur'}`, task.id, 'task_created');
    }

    const { error } = await supabase.from('tasks').insert({
      id: task.id,
      company_id: ctx.companyId || null,
      type: task.type,
      status: task.status,
      client_name: task.client_name,
      client_phone: task.client_phone,
      address: task.address,
      problem_details: task.problem_details || null,
      invoice_number: task.invoice_number || null,
      payment_details: task.payment_details || null,
      comment: task.comment || null,
      priority: task.priority,
      created_by: task.created_by,
      assigned_to: task.assigned_to,
      due_date: task.due_date || null,
      archived_at: task.archived_at || null,
      edited: task.edited || false,
      created_at: task.created_at,
      updated_at: task.updated_at,
    });
    if (error) console.error('Error adding task:', error);
  }, [addNotification, currentUser, getAdminIds, getPhonesForUserIds]);

  const deleteTask = useCallback(async (taskId: string) => {
    const task = tasks.find(t => t.id === taskId);
    if (task) {
      const notifyIds = new Set([task.created_by, task.assigned_to]);
      if (currentUser) notifyIds.delete(currentUser.id);
      const pushIds = Array.from(notifyIds);
      pushIds.forEach(uid => {
        addNotification(uid, 'status_changed', 'Tâche supprimée', `${task.client_name} a été supprimée`, taskId);
      });
      if (pushIds.length > 0) {
        const phones = getPhonesForUserIds(pushIds);
        sendWhatsAppNotification(phones, 'Tâche supprimée', `${task.client_name} a été supprimée`, taskId, 'task_deleted');
      }
    }
    setTasks(prev => prev.filter(t => t.id !== taskId));
    await supabase.from('tasks').delete().eq('id', taskId);
  }, [tasks, addNotification, currentUser, getPhonesForUserIds]);

  const updateTask = useCallback(async (taskId: string, updates: Partial<Task>) => {
    const oldTask = tasks.find(t => t.id === taskId);
    if (oldTask) {
      if (updates.assigned_to && updates.assigned_to !== oldTask.assigned_to) {
        addNotification(updates.assigned_to, 'task_reassigned', 'Tâche réassignée', `${oldTask.client_name} vous a été assignée`, taskId);
        const reassignPhones = getPhonesForUserIds([updates.assigned_to]);
        sendWhatsAppNotification(reassignPhones, 'Tâche réassignée', `${oldTask.client_name} vous a été assignée`, taskId, 'task_reassigned');
      }

      const significantChanges: string[] = [];
      if (updates.priority && updates.priority !== oldTask.priority) significantChanges.push(`Priorité: ${updates.priority}`);
      if (updates.due_date !== undefined && updates.due_date !== oldTask.due_date) significantChanges.push(`Date: ${updates.due_date || 'retirée'}`);
      if (updates.problem_details && updates.problem_details !== oldTask.problem_details) significantChanges.push('Détails modifiés');
      if (updates.address && updates.address !== oldTask.address) significantChanges.push('Adresse modifiée');

      if (significantChanges.length > 0) {
        const notifyIds = new Set([oldTask.created_by, oldTask.assigned_to]);
        if (updates.assigned_to) notifyIds.add(updates.assigned_to);
        if (currentUser) notifyIds.delete(currentUser.id);
        const pushIds = Array.from(notifyIds);
        const changeMsg = `${oldTask.client_name}: ${significantChanges.join(', ')}`;
        const notifType = updates.priority === 'urgent' && oldTask.priority !== 'urgent' ? 'priority_changed' : 'status_changed';
        const notifTitle = updates.priority === 'urgent' && oldTask.priority !== 'urgent' ? 'Priorité urgente' : 'Tâche modifiée';
        pushIds.forEach(uid => { addNotification(uid, notifType, notifTitle, changeMsg, taskId); });
        if (pushIds.length > 0) {
          const phones = getPhonesForUserIds(pushIds);
          sendWhatsAppNotification(phones, notifTitle, changeMsg, taskId, notifType);
        }
      }
    }

    setTasks(prev => prev.map(t => t.id === taskId ? { ...t, ...updates, updated_at: new Date().toISOString() } : t));

    const dbUpdates: any = { ...updates, updated_at: new Date().toISOString() };
    for (const key of ['problem_details', 'invoice_number', 'payment_details', 'comment', 'due_date', 'archived_at']) {
      if (key in dbUpdates && dbUpdates[key] === undefined) dbUpdates[key] = null;
    }
    await supabase.from('tasks').update(dbUpdates).eq('id', taskId);
  }, [tasks, addNotification, currentUser, getPhonesForUserIds]);

  const addContact = useCallback(async (contact: Contact) => {
    const ctx = getCompanyContext();
    setContacts(prev => [contact, ...prev]);
    const { error } = await supabase.from('task_contacts').insert({
      id: contact.id,
      company_id: ctx.companyId || null,
      name: contact.name,
      phone: contact.phone || '',
      role_label: contact.role_label || '',
      created_by: contact.created_by,
      created_at: contact.created_at,
    });
    if (error) { console.error('Error adding contact:', error); fetchContacts(); }
  }, [fetchContacts]);

  const deleteContact = useCallback(async (contactId: string) => {
    setContacts(prev => prev.filter(c => c.id !== contactId));
    await supabase.from('task_contacts').delete().eq('id', contactId);
  }, []);

  const getUserById = useCallback((id: string) => users.find(u => u.id === id), [users]);

  return (
    <DataContext.Provider value={{ tasks, contacts, users, usersLoading, updateTaskStatus, addTask, deleteTask, updateTask, addContact, deleteContact, getUserById }}>
      {children}
    </DataContext.Provider>
  );
}

export function useData() {
  const ctx = useContext(DataContext);
  if (!ctx) throw new Error('useData must be used within DataProvider');
  return ctx;
}
