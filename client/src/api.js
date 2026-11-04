// API client for Pest Control Master Scheduling System

const BASE_URL = '/api';

export function toQueryString(params = {}) {
  const clean = {};
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '' && value !== 'undefined' && value !== 'null') {
      clean[key] = value;
    }
  }
  return new URLSearchParams(clean).toString();
}

export async function fetchJson(endpoint, options = {}) {
  const url = `${BASE_URL}${endpoint}`;
  const headers = {
    'Content-Type': 'application/json',
    ...options.headers
  };

  const config = {
    ...options,
    headers
  };

  if (options.body && typeof options.body === 'object' && !(options.body instanceof FormData)) {
    config.body = JSON.stringify(options.body);
  }

  const res = await fetch(url, config);
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch (err) {
    throw new Error(`Server response error (${res.status}): ${text.slice(0, 100)}`);
  }
  if (!res.ok || data.success === false) {
    throw new Error(data.error || `HTTP error ${res.status}`);
  }
  return data;
}

// Dashboard
export const getDashboardStats = (date) => fetchJson(`/dashboard${date ? `?date=${date}` : ''}`);

// Customers
export const getCustomers = (params = {}) => {
  const q = toQueryString(params);
  return fetchJson(`/customers?${q}`);
};
export const getCustomerById = (id, params = {}) => {
  const q = toQueryString(params);
  return fetchJson(`/customers/${id}${q ? `?${q}` : ''}`);
};
export const createCustomer = (data) => fetchJson('/customers', { method: 'POST', body: data });
export const updateCustomer = (id, data) => fetchJson(`/customers/${id}`, { method: 'PUT', body: data });
export const deleteCustomer = (id) => fetchJson(`/customers/${id}`, { method: 'DELETE' });
export const addCustomerLocation = (id, data) => fetchJson(`/customers/${id}/locations`, { method: 'POST', body: data });

// Treatments
export const getTreatments = () => fetchJson('/treatments');
export const createTreatment = (data) => fetchJson('/treatments', { method: 'POST', body: data });
export const updateTreatment = (id, data) => fetchJson(`/treatments/${id}`, { method: 'PUT', body: data });

// Staff
export const getStaff = (params = {}) => {
  const q = toQueryString(params);
  return fetchJson(`/staff?${q}`);
};
export const createStaff = (data) => fetchJson('/staff', { method: 'POST', body: data });
export const updateStaff = (id, data) => fetchJson(`/staff/${id}`, { method: 'PUT', body: data });
export const deleteStaff = (id) => fetchJson(`/staff/${id}`, { method: 'DELETE' });

// Recurring Services
export const getRecurringServices = (params = {}) => {
  const q = toQueryString(params);
  return fetchJson(`/recurring?${q}`);
};
export const createRecurringService = (data) => fetchJson('/recurring', { method: 'POST', body: data });
export const updateRecurringService = (id, data) => fetchJson(`/recurring/${id}`, { method: 'PUT', body: data });
export const deleteRecurringService = (id, cancelFutureJobs = true) => fetchJson(`/recurring/${id}?cancel_future_jobs=${cancelFutureJobs}`, { method: 'DELETE' });
export const generateRecurringSchedule = (id, horizonMonths = 3) => fetchJson(`/recurring/${id}/generate-schedule`, { method: 'POST', body: { horizon_months: horizonMonths } });
export const previewNextDate = (baseDate, frequency, preferredDay) => {
  const q = toQueryString({ base_date: baseDate, frequency, preferred_day: preferredDay || '' });
  return fetchJson(`/recurring/calculate-next?${q}`);
};

// Jobs
export const getJobs = (params = {}) => {
  const q = toQueryString(params);
  return fetchJson(`/jobs?${q}`);
};
export const getJobById = (id) => fetchJson(`/jobs/${id}`);
export const createJob = (data) => fetchJson('/jobs', { method: 'POST', body: data });
export const assignJob = (id, technicianId, extra = {}) => fetchJson(`/jobs/${id}/assign`, { method: 'PUT', body: { technician_id: technicianId, ...extra } });
export const bulkAssignJobs = (jobIds, technicianId, extra = {}) => fetchJson('/jobs/bulk-assign', { method: 'POST', body: { job_ids: jobIds, technician_id: technicianId, ...extra } });
export const startJob = (id) => fetchJson(`/jobs/${id}/start`, { method: 'PUT' });
export const completeJob = (id, data) => fetchJson(`/jobs/${id}/complete`, { method: 'PUT', body: data });
export const updateJob = (id, data) => fetchJson(`/jobs/${id}`, { method: 'PUT', body: data });
export const postponeJob = (id, data) => fetchJson(`/jobs/${id}/postpone`, { method: 'PUT', body: data });
export const cancelJob = (id, reason) => fetchJson(`/jobs/${id}/cancel`, { method: 'PUT', body: { reason } });

// Calendar
export const getCalendarEvents = (params = {}) => {
  const q = toQueryString(params);
  return fetchJson(`/calendar/events?${q}`);
};

// Reports
export const getReport = (type, params = {}) => {
  const q = toQueryString(params);
  return fetchJson(`/reports/${type}?${q}`);
};

// Excel Import
export const getImportSheets = () => fetchJson('/import/sheets');
export const previewImportSheet = (sheetName, filePath) => fetchJson('/import/preview', { method: 'POST', body: { sheet_name: sheetName, file_path: filePath } });
export const executeImportSheet = (sheetName, columnMapping, filePath) => fetchJson('/import/execute', { method: 'POST', body: { sheet_name: sheetName, column_mapping: columnMapping, file_path: filePath } });

// Automation & Search
export const runDailyAutomation = () => fetchJson('/automation/run-daily', { method: 'POST' });
export const generateUpcomingJobs = (horizonDays) => fetchJson('/automation/generate-jobs', { method: 'POST', body: { horizon_days: horizonDays } });
export const globalSearch = (q) => fetchJson(`/automation/search?q=${encodeURIComponent(q)}`);

// Notifications
export const getNotifications = (params = {}) => {
  const q = new URLSearchParams(params).toString();
  return fetchJson(`/notifications?${q}`);
};
export const markNotificationRead = (id) => fetchJson(`/notifications/${id}/read`, { method: 'PUT' });
export const markAllNotificationsRead = () => fetchJson('/notifications/mark-all-read', { method: 'POST' });

// Customer Confirmation Portal
export const getCustomerAppointment = (jobCode) => fetchJson(`/confirmations/${jobCode}`);
export const confirmAppointment = (jobCode) => fetchJson(`/confirmations/${jobCode}/confirm`, { method: 'POST' });
export const requestReschedule = (jobCode, data) => fetchJson(`/confirmations/${jobCode}/reschedule`, { method: 'POST', body: data });

// Reminders
export const getRemindersQueue = () => fetchJson('/reminders/queue');
export const getTechnicianRouteReminder = (techId) => fetchJson(`/reminders/technician-route/${techId}`);
export const logReminderSent = (data) => fetchJson('/reminders/log-sent', { method: 'POST', body: data });

// Sri Lanka SMS Gateways
export const getSmsSettings = () => fetchJson('/sms/settings');
export const updateSmsSettings = (data) => fetchJson('/sms/settings', { method: 'POST', body: data });
export const getSmsTemplates = () => fetchJson('/sms/templates');
export const saveSmsTemplates = (data) => fetchJson('/sms/templates', { method: 'POST', body: data });
export const sendCustomSms = (data) => fetchJson('/sms/send-custom', { method: 'POST', body: data });
export const validatePhone = (phone) => fetchJson('/sms/validate-phone', { method: 'POST', body: { phone } });
export const sendTestSms = (to, message) => fetchJson('/sms/send-test', { method: 'POST', body: { to, message } });
export const sendJobSmsReminder = (jobId, reminderType = '24H', overrides = {}) => fetchJson('/sms/send-job-reminder', { method: 'POST', body: { job_id: jobId, reminder_type: reminderType, ...overrides } });
export const bulkSendSmsReminders = (data = {}) => fetchJson('/sms/bulk-send', { method: 'POST', body: data });
export const getSmsLogs = (params = {}) => {
  const q = new URLSearchParams(params).toString();
  return fetchJson(`/sms/logs?${q}`);
};
export const sendTechDispatchSms = (data) => fetchJson('/sms/send-tech-dispatch', { method: 'POST', body: data });

// Database Backups & Monthly Archives
export const getDatabaseBackups = () => fetchJson('/backup');
export const createDatabaseBackup = (data = {}) => fetchJson('/backup/create', { method: 'POST', body: data });
export const restoreDatabaseBackup = (id) => fetchJson(`/backup/restore/${id}`, { method: 'POST' });
export const deleteDatabaseBackup = (id) => fetchJson(`/backup/${id}`, { method: 'DELETE' });
export const getBackupDownloadUrl = (id) => `/api/backup/download/${id}`;
export const getLiveDatabaseDownloadUrl = () => '/api/backup/download-live';
export const resetAllSystemData = (data = {}) => fetchJson('/backup/reset-all', { method: 'POST', body: data });

// Fleet & Machinery Management
export const getVehicles = (params = {}) => {
  const q = new URLSearchParams(params).toString();
  return fetchJson(`/fleet/vehicles?${q}`);
};
export const createVehicle = (data) => fetchJson('/fleet/vehicles', { method: 'POST', body: data });
export const updateVehicle = (id, data) => fetchJson(`/fleet/vehicles/${id}`, { method: 'PUT', body: data });
export const deleteVehicle = (id) => fetchJson(`/fleet/vehicles/${id}`, { method: 'DELETE' });
export const getMachines = (params = {}) => {
  const q = new URLSearchParams(params).toString();
  return fetchJson(`/fleet/machines?${q}`);
};
export const createMachine = (data) => fetchJson('/fleet/machines', { method: 'POST', body: data });
export const checkFleetAvailability = (params = {}) => {
  const q = new URLSearchParams(params).toString();
  return fetchJson(`/fleet/check-availability?${q}`);
};


