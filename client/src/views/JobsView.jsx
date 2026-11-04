import React, { useState, useEffect, useMemo } from 'react';
import {
  Briefcase, Plus, Search, Filter, Calendar as CalendarIcon,
  PlayCircle, CheckCircle2, Clock, AlertTriangle, XCircle,
  MapPin, Phone, User, Check, X, Camera, PenTool, Edit, UserPlus,
  Users, HardHat, Copy, Send, ExternalLink, MessageSquare, Smartphone, Sparkles, Lock,
  RefreshCw, Building, CheckCircle, Truck, Cpu, Wrench, Download, Printer, Share2, LayoutGrid, List
} from 'lucide-react';
import {
  getJobs, getJobById, createJob, assignJob, bulkAssignJobs, getVehicles, getMachines, createVehicle, updateVehicle, deleteVehicle, createMachine,
  startJob, completeJob, postponeJob, cancelJob,
  getStaff, getTreatments, getCustomers, getCustomerById, sendTechDispatchSms
} from '../api';
import SignaturePad from '../components/SignaturePad';
import EditJobModal from '../components/EditJobModal';
import { downloadJobPdfReport, printJobReport, shareJobOnWhatsApp } from '../utils/jobExportUtils';

export default function JobsView({
  initialJobId,
  initialStatusFilter = '',
  onSelectCustomer,
  onOpenAddCustomer,
  currentRole,
  currentTechnicianId,
  isMobileView = false
}) {
  const isTechnicianMode = currentRole === 'TECHNICIAN' || isMobileView || (Boolean(currentTechnicianId) && currentRole !== 'ADMIN' && currentRole !== 'MANAGER' && currentRole !== 'SUPERVISOR');

  const getEffectiveTechId = () => {
    if (currentTechnicianId) return String(currentTechnicianId);
    try {
      const pref = localStorage.getItem('tech_preferred_id');
      if (pref) return String(pref);
      const authUser = localStorage.getItem('auth_user');
      if (authUser) {
        const u = JSON.parse(authUser);
        if (u?.id) return String(u.id);
      }
      const techSess = localStorage.getItem('tech_session_v1') || localStorage.getItem('tech_session');
      if (techSess) {
        const s = JSON.parse(techSess);
        const id = s?.technician?.id || s?.id;
        if (id) return String(id);
      }
    } catch (e) {}
    return '';
  };

  const [activeTechId, setActiveTechId] = useState(() => isTechnicianMode ? getEffectiveTechId() : '');

  const [jobs, setJobs] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);

  // Edit Job Modal
  const [editingJob, setEditingJob] = useState(null);

  // Filters
  const [statusFilter, setStatusFilter] = useState(() => initialStatusFilter || '');
  const [dateFilter, setDateFilter] = useState('');
  const [dateFromFilter, setDateFromFilter] = useState('');
  const [dateToFilter, setDateToFilter] = useState('');
  const [technicianFilter, setTechnicianFilter] = useState(() => (isTechnicianMode ? getEffectiveTechId() : ''));
  const [treatmentFilter, setTreatmentFilter] = useState('');
  const [assignmentFilter, setAssignmentFilter] = useState(''); // '' | 'ASSIGNED' | 'UNASSIGNED'
  const [vehicleFilter, setVehicleFilter] = useState('');
  const [machineFilter, setMachineFilter] = useState('');
  const [search, setSearch] = useState('');
  const [viewMode, setViewMode] = useState('table'); // 'table' | 'cards'
  const [fleetVehicles, setFleetVehicles] = useState([]);
  const [fleetMachines, setFleetMachines] = useState([]);

  useEffect(() => {
    if (initialStatusFilter !== undefined && initialStatusFilter !== '') {
      setStatusFilter(initialStatusFilter);
    }
  }, [initialStatusFilter]);

  useEffect(() => {
    if (isTechnicianMode) {
      const resolved = getEffectiveTechId();
      if (resolved) {
        setActiveTechId(resolved);
        setTechnicianFilter(resolved);
      }
    }
  }, [isTechnicianMode, currentTechnicianId]);

  // Selected job for detail modal
  const [selectedJob, setSelectedJob] = useState(null);
  const [jobDetails, setJobDetails] = useState(null);
  const [drawerCopied, setDrawerCopied] = useState(false);
  const [drawerSmsSending, setDrawerSmsSending] = useState(false);
  const [drawerSmsFeedback, setDrawerSmsFeedback] = useState(null);

  // Multi-select for bulk assignment
  const [selectedJobIds, setSelectedJobIds] = useState([]);
  const [bulkTechId, setBulkTechId] = useState('');
  const [bulkSendSms, setBulkSendSms] = useState(false);
  const [createSendSms, setCreateSendSms] = useState(false);

  // Modals
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showCompleteModal, setShowCompleteModal] = useState(false);
  const [showPostponeModal, setShowPostponeModal] = useState(false);
  const [showCancelModal, setShowCancelModal] = useState(false);
  const [tomorrowNoticeJob, setTomorrowNoticeJob] = useState(null);

  // Completion Form
  const [completionNotes, setCompletionNotes] = useState('');
  const [customerSignature, setCustomerSignature] = useState(null);
  const [showSignaturePad, setShowSignaturePad] = useState(false);
  const [photoUrl, setPhotoUrl] = useState('');

  const handlePhotoCapture = (e) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (event) => {
        setPhotoUrl(event.target.result);
      };
      reader.readAsDataURL(file);
    }
  };

  // Postpone Form
  const [postponeDate, setPostponeDate] = useState('');
  const [postponeReason, setPostponeReason] = useState('');

  // Metadata
  const [staff, setStaff] = useState([]);
  const [treatments, setTreatments] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [loadingCustomers, setLoadingCustomers] = useState(false);
  const [customerSearchQuery, setCustomerSearchQuery] = useState('');
  const [customerLocations, setCustomerLocations] = useState([]);
  const [loadingLocations, setLoadingLocations] = useState(false);

  // Create Manual Job Form
  const colomboToday = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Colombo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(new Date());

  const colomboTomorrow = (() => {
    const parts = colomboToday.split('-').map(Number);
    const dt = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2] + 1));
    return dt.toISOString().substring(0, 10);
  })();

  const getJobEffectiveDate = (j) => {
    if (!j) return '';
    return (j.status === 'POSTPONED' && j.postponed_to_date)
      ? String(j.postponed_to_date).substring(0, 10)
      : String(j.scheduled_date || '').substring(0, 10);
  };

  const isJobScheduledAfterToday = (j) => {
    const eff = getJobEffectiveDate(j);
    return Boolean(eff && eff > colomboToday);
  };

  const [newJobForm, setNewJobForm] = useState({
    customer_id: '', location_id: '', treatment_id: '', technician_id: '',
    salesman_id: '', scheduled_date: colomboToday,
    scheduled_time: '09:00', duration_minutes: 60, crew_count: 1, notes: '',
    vehicle_id: '', vehicle_no: '', machine_id: '', machine_name: '', team_members: ''
  });

  const loadAllCustomers = async () => {
    setLoadingCustomers(true);
    try {
      const res = await getCustomers({ limit: 500 });
      setCustomers(res.customers || []);
    } catch (e) {
      console.error('Failed to load customers:', e);
    } finally {
      setLoadingCustomers(false);
    }
  };

  const resetNewJobForm = () => {
    setNewJobForm({
      customer_id: '', location_id: '', treatment_id: '', technician_id: '',
      salesman_id: '', scheduled_date: colomboToday,
      scheduled_time: '09:00', duration_minutes: 60, crew_count: 1, notes: '',
      vehicle_id: '', vehicle_no: '', machine_id: '', machine_name: '', team_members: ''
    });
    setCustomerSearchQuery('');
    setCustomerLocations([]);
    setIsCustomCreateVehicle(false);
    setIsCustomCreateMachine(false);
  };

  // Create Modal Fleet & Machinery states
  const [createVehiclesList, setCreateVehiclesList] = useState([]);
  const [createMachinesList, setCreateMachinesList] = useState([]);
  const [loadingCreateFleet, setLoadingCreateFleet] = useState(false);
  const [isCustomCreateVehicle, setIsCustomCreateVehicle] = useState(false);
  const [isCustomCreateMachine, setIsCustomCreateMachine] = useState(false);

  useEffect(() => {
    if (newJobForm.scheduled_date && showCreateModal) {
      setLoadingCreateFleet(true);
      Promise.all([
        getVehicles({ scheduled_date: newJobForm.scheduled_date }),
        getMachines({ scheduled_date: newJobForm.scheduled_date })
      ]).then(([vRes, mRes]) => {
        setCreateVehiclesList(vRes.vehicles || []);
        setCreateMachinesList(mRes.machines || []);
      }).catch(console.error).finally(() => setLoadingCreateFleet(false));
    }
  }, [newJobForm.scheduled_date, showCreateModal]);

  const handleAddNewVehicleForCreate = async () => {
    const num = prompt('Enter Vehicle Registration Number (e.g. WP CAD-5120):');
    if (!num || !num.trim()) return;
    const type = prompt('Enter Vehicle Type (e.g. Van, Double Cab, Lorry, Motorbike, Three-Wheeler):', 'Van');
    try {
      const res = await createVehicle({ vehicle_number: num.trim().toUpperCase(), vehicle_type: type?.trim() || 'Van' });
      if (res.success && res.vehicle) {
        setCreateVehiclesList(prev => [...prev, { ...res.vehicle, is_available: true }]);
        setNewJobForm(prev => ({ ...prev, vehicle_id: res.vehicle.id, vehicle_no: res.vehicle.vehicle_number }));
        setIsCustomCreateVehicle(false);
      }
    } catch (err) {
      alert('Error adding vehicle: ' + err.message);
    }
  };

  const handleRenameVehicleForCreate = async () => {
    if (!newJobForm.vehicle_id) {
      alert('Please select a vehicle from the dropdown first to update or rename it.');
      return;
    }
    const current = createVehiclesList.find(x => String(x.id) === String(newJobForm.vehicle_id));
    if (!current) return;
    const newNum = prompt('Update Vehicle Registration Number:', current.vehicle_number);
    if (!newNum || !newNum.trim()) return;
    const newType = prompt('Update Vehicle Type (Van, Double Cab, Lorry, Motorbike, Three-Wheeler):', current.vehicle_type || 'Van');
    try {
      const res = await updateVehicle(current.id, {
        vehicle_number: newNum.trim().toUpperCase(),
        vehicle_type: newType?.trim() || current.vehicle_type || 'Van'
      });
      if (res.success && res.vehicle) {
        setCreateVehiclesList(prev => prev.map(v => v.id === current.id ? { ...v, ...res.vehicle } : v));
        setNewJobForm(prev => ({ ...prev, vehicle_no: res.vehicle.vehicle_number }));
        alert('Vehicle updated successfully to ' + res.vehicle.vehicle_number + ' (' + (res.vehicle.vehicle_type || 'Vehicle') + ')!');
      }
    } catch (err) {
      alert('Error updating vehicle: ' + err.message);
    }
  };

  const handleDeleteVehicleForCreate = async () => {
    if (!newJobForm.vehicle_id) {
      alert('Please select a vehicle from the dropdown first to remove it.');
      return;
    }
    const current = createVehiclesList.find(x => String(x.id) === String(newJobForm.vehicle_id));
    if (!current) return;
    if (!confirm('Are you sure you want to remove vehicle "' + current.vehicle_number + ' (' + (current.vehicle_type || 'Vehicle') + ')"?\n\nThis will remove it from the vehicle fleet list.')) {
      return;
    }
    try {
      const res = await deleteVehicle(current.id);
      if (res.success) {
        setCreateVehiclesList(prev => prev.filter(v => v.id !== current.id));
        setNewJobForm(prev => ({ ...prev, vehicle_id: '', vehicle_no: '' }));
        alert('Vehicle ' + current.vehicle_number + ' removed from fleet.');
      }
    } catch (err) {
      alert('Error deleting vehicle: ' + err.message);
    }
  };

  const handleAddNewMachineForCreate = async () => {
    const name = prompt('Enter Machine / Equipment Name (e.g. Thermal Fogger TF-35):');
    if (!name || !name.trim()) return;
    const type = prompt('Enter Machine Type (e.g. Thermal Fogger, ULV Sprayer, Hand Sprayer):', 'Fogger');
    try {
      const res = await createMachine({ machine_name: name.trim(), machine_type: type?.trim() || 'Fogger' });
      if (res.success && res.machine) {
        setCreateMachinesList(prev => [...prev, { ...res.machine, is_available: true }]);
        setNewJobForm(prev => ({ ...prev, machine_id: res.machine.id, machine_name: res.machine.machine_name }));
        setIsCustomCreateMachine(false);
      }
    } catch (err) {
      alert('Error adding machine: ' + err.message);
    }
  };

  const handleSelectCustomerForNewJob = async (customerId) => {
    setNewJobForm(prev => ({ ...prev, customer_id: customerId, location_id: '' }));
    if (!customerId) {
      setCustomerLocations([]);
      return;
    }
    setLoadingLocations(true);
    try {
      const res = await getCustomerById(customerId);
      const locs = res.locations || [];
      setCustomerLocations(locs);
      const primaryLoc = locs.find(l => l.is_primary) || locs[0];
      if (primaryLoc) {
        setNewJobForm(prev => ({ ...prev, location_id: primaryLoc.id }));
      }
    } catch (e) {
      console.error(e);
      setCustomerLocations([]);
    } finally {
      setLoadingLocations(false);
    }
  };

  const handleSelectTreatmentForNewJob = (treatmentId) => {
    const t = treatments.find(item => String(item.id) === String(treatmentId));
    setNewJobForm(prev => ({
      ...prev,
      treatment_id: treatmentId,
      duration_minutes: t?.default_duration_minutes || prev.duration_minutes || 60
    }));
  };

  const filteredCustomers = customers.filter(c => {
    if (!customerSearchQuery) return true;
    const q = customerSearchQuery.toLowerCase();
    return (
      (c.name && c.name.toLowerCase().includes(q)) ||
      (c.customer_code && c.customer_code.toLowerCase().includes(q)) ||
      (c.phone && c.phone.includes(q)) ||
      (c.location && c.location.toLowerCase().includes(q))
    );
  });

  const selectedCustomerObj = customers.find(c => String(c.id) === String(newJobForm.customer_id));

  const [rawJobs, setRawJobs] = useState([]);
  const [serverCounts, setServerCounts] = useState(null);

  const loadJobs = async () => {
    setLoading(true);
    try {
      const effectiveTech = isTechnicianMode ? (activeTechId || getEffectiveTechId()) : (technicianFilter || undefined);
      const res = await getJobs({
        role: isTechnicianMode ? 'TECHNICIAN' : 'MANAGER',
        status: statusFilter || undefined,
        date: dateFilter || undefined,
        from_date: (!dateFilter && dateFromFilter) ? dateFromFilter : undefined,
        to_date: (!dateFilter && dateToFilter) ? dateToFilter : undefined,
        technician_id: effectiveTech || undefined,
        assignment: assignmentFilter || undefined,
        treatment_id: treatmentFilter || undefined,
        vehicle_no: vehicleFilter || undefined,
        machine_name: machineFilter || undefined,
        search: search || undefined,
        limit: 1000
      });
      let jobList = res.jobs || [];
      if (isTechnicianMode && effectiveTech) {
        jobList = jobList.filter(j => String(j.technician_id || j.assigned_technician_id) === String(effectiveTech));
      }
      if (dateFilter) {
        jobList = jobList.filter(j => getJobEffectiveDate(j) === dateFilter);
      }
      setRawJobs(jobList);
      setTotal(res.total !== undefined ? res.total : jobList.length);
      if (res.counts) {
        setServerCounts(res.counts);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  // Compute KPI counts using exact database serverCounts (with fallback to rawJobs)
  const kpiStats = useMemo(() => {
    if (serverCounts) {
      return {
        all: serverCounts.all ?? rawJobs.length,
        inProgress: serverCounts.in_progress ?? 0,
        completed: serverCounts.completed ?? 0,
        toDo: serverCounts.pending ?? 0,
        assigned: serverCounts.assigned ?? 0,
        toBeDone: serverCounts.to_be_done ?? 0,
        confirmed: serverCounts.confirmed ?? 0,
        postponed: serverCounts.postponed ?? 0,
        cancelled: serverCounts.cancelled ?? 0,
        overdue: serverCounts.overdue ?? 0,
        unconfirmed: serverCounts.unconfirmed ?? 0,
        unassigned: serverCounts.unassigned ?? 0,
        scopeTotal: serverCounts.scope_total ?? serverCounts.all ?? rawJobs.length,
        scopeUnassigned: serverCounts.scope_unassigned ?? serverCounts.unassigned ?? 0,
        todayJobs: serverCounts.today_jobs ?? 0,
        tomorrowJobs: serverCounts.tomorrow_jobs ?? 0,
        allDatesJobs: serverCounts.all_dates_jobs ?? serverCounts.all ?? rawJobs.length,
        byTechnician: serverCounts.by_technician || {}
      };
    }

    return {
      all: rawJobs.length,
      inProgress: rawJobs.filter(j => j.status === 'IN_PROGRESS').length,
      completed: rawJobs.filter(j => j.status === 'COMPLETED').length,
      toDo: rawJobs.filter(j => j.status === 'ASSIGNED' || j.status === 'SCHEDULED' || j.status === 'TO_BE_DONE' || j.status === 'CONFIRMED' || j.status === 'PENDING').length,
      assigned: rawJobs.filter(j => j.status === 'ASSIGNED').length,
      toBeDone: rawJobs.filter(j => j.status === 'TO_BE_DONE').length,
      confirmed: rawJobs.filter(j => j.status === 'CONFIRMED').length,
      postponed: rawJobs.filter(j => j.status === 'POSTPONED').length,
      cancelled: rawJobs.filter(j => j.status === 'CANCELLED').length,
      overdue: rawJobs.filter(j => getJobEffectiveDate(j) < colomboToday && j.status !== 'COMPLETED' && j.status !== 'CANCELLED').length,
      unconfirmed: rawJobs.filter(j => j.customer_confirmation_status !== 'CONFIRMED' && j.status !== 'COMPLETED' && j.status !== 'CANCELLED').length,
      unassigned: rawJobs.filter(j => !j.technician_id && !j.assigned_technician_id && !j.technician_name && j.status !== 'CANCELLED').length,
      scopeTotal: rawJobs.length,
      scopeUnassigned: rawJobs.filter(j => !j.technician_id && !j.assigned_technician_id && !j.technician_name && j.status !== 'CANCELLED').length,
      todayJobs: 0,
      tomorrowJobs: 0,
      allDatesJobs: rawJobs.length,
      byTechnician: {}
    };
  }, [serverCounts, rawJobs, colomboToday]);

  // Compute unique Vehicle & Machine options for filter dropdowns
  const vehicleFilterOptions = useMemo(() => {
    const set = new Set();
    fleetVehicles.forEach(v => { if (v?.vehicle_number) set.add(v.vehicle_number); });
    rawJobs.forEach(j => {
      const v = j?.vehicle_no || j?.vehicle_number;
      if (v) set.add(v);
    });
    return Array.from(set).sort();
  }, [fleetVehicles, rawJobs]);

  const machineFilterOptions = useMemo(() => {
    const set = new Set();
    fleetMachines.forEach(m => { if (m?.machine_name) set.add(m.machine_name); });
    rawJobs.forEach(j => {
      const m = j?.machine_name || j?.machine_type;
      if (m) set.add(m);
    });
    return Array.from(set).sort();
  }, [fleetMachines, rawJobs]);

  // Apply all active filters instantaneously
  const displayedJobs = useMemo(() => {
    return rawJobs.filter(j => {
      if (!j) return false;

      // Date range filter (when exact dateFilter is not set)
      const effDate = getJobEffectiveDate(j);
      if (!dateFilter && dateFromFilter && effDate < dateFromFilter) return false;
      if (!dateFilter && dateToFilter && effDate > dateToFilter) return false;

      // Technician filter
      if (!isTechnicianMode && technicianFilter) {
        const staffMember = staff.find(s => String(s.id) === String(technicianFilter));
        const techName = staffMember?.full_name?.toLowerCase();
        const techCleanName = staffMember?.full_name ? staffMember.full_name.replace(/\s*\(.*?\)\s*/g, '').trim().toLowerCase() : '';
        const techUsername = staffMember?.username?.toLowerCase();
        const matchesLead = String(j.technician_id || j.assigned_technician_id || '') === String(technicianFilter);
        const matchesTeam = Boolean(techName && j.team_members && j.team_members.toLowerCase().includes(techName));
        const matchesCleanTeam = Boolean(techCleanName && j.team_members && j.team_members.toLowerCase().includes(techCleanName));
        const matchesUsername = Boolean(techUsername && j.team_members && j.team_members.toLowerCase().includes(techUsername));
        const matchesWorkers = Boolean(j.workers_info && String(j.workers_info).includes(String(technicianFilter)));
        if (!matchesLead && !matchesTeam && !matchesCleanTeam && !matchesUsername && !matchesWorkers) return false;
      }

      // Assignment status filter (Assigned vs Unassigned)
      const hasTech = Boolean(j.technician_id || j.assigned_technician_id || j.technician_name || (j.team_members && j.team_members.trim()));
      if (assignmentFilter === 'ASSIGNED' && !hasTech) return false;
      if (assignmentFilter === 'UNASSIGNED' && hasTech) return false;

      // Treatment filter
      if (treatmentFilter && String(j.treatment_id || '') !== String(treatmentFilter)) return false;

      // Vehicle filter
      if (vehicleFilter) {
        const v = j.vehicle_no || j.vehicle_number || '';
        if (v !== vehicleFilter) return false;
      }

      // Machine filter
      if (machineFilter) {
        const m = j.machine_name || j.machine_type || '';
        if (m !== machineFilter) return false;
      }

      // Status filter
      if (statusFilter) {
        if (statusFilter === 'OVERDUE') {
          if (!(effDate < colomboToday && j.status !== 'COMPLETED' && j.status !== 'CANCELLED' && j.status !== 'POSTPONED' && j.status !== 'IN_PROGRESS')) return false;
        } else if (statusFilter === 'UNCONFIRMED') {
          if (!(effDate >= colomboToday && j.customer_confirmation_status === 'UNCONFIRMED' && j.status !== 'COMPLETED' && j.status !== 'CANCELLED')) return false;
        } else if (statusFilter === 'PENDING') {
          if (!['TO_BE_DONE', 'ASSIGNED', 'CONFIRMED', 'SCHEDULED', 'PENDING'].includes(j.status)) return false;
        } else if (statusFilter === 'ASSIGNED') {
          const isAssigned = j.status === 'ASSIGNED' || j.status === 'SCHEDULED' || (j.technician_id && !['COMPLETED', 'CANCELLED'].includes(j.status)) || (j.team_members && j.team_members.trim() && !['COMPLETED', 'CANCELLED'].includes(j.status));
          if (!isAssigned) return false;
        } else if (statusFilter === 'TO_BE_DONE') {
          if (j.status !== 'TO_BE_DONE' && j.status !== 'PENDING') return false;
        } else if (j.status !== statusFilter) {
          return false;
        }
      }

      // Search query
      if (search && search.trim()) {
        const q = search.toLowerCase().trim();
        const match =
          (j.job_code && j.job_code.toLowerCase().includes(q)) ||
          (j.customer_name && j.customer_name.toLowerCase().includes(q)) ||
          (j.customer_code && j.customer_code.toLowerCase().includes(q)) ||
          (j.customer_phone && String(j.customer_phone).toLowerCase().includes(q)) ||
          (j.location_name && j.location_name.toLowerCase().includes(q)) ||
          (j.location_address && j.location_address.toLowerCase().includes(q)) ||
          (j.technician_name && j.technician_name.toLowerCase().includes(q)) ||
          (j.treatment_code && j.treatment_code.toLowerCase().includes(q)) ||
          (j.treatment_name && j.treatment_name.toLowerCase().includes(q)) ||
          (j.vehicle_no && j.vehicle_no.toLowerCase().includes(q)) ||
          (j.vehicle_number && j.vehicle_number.toLowerCase().includes(q)) ||
          (j.machine_name && j.machine_name.toLowerCase().includes(q)) ||
          (j.team_members && j.team_members.toLowerCase().includes(q));
        if (!match) return false;
      }

      return true;
    });
  }, [
    rawJobs, dateFilter, dateFromFilter, dateToFilter, isTechnicianMode,
    technicianFilter, assignmentFilter, treatmentFilter, vehicleFilter,
    machineFilter, statusFilter, search, colomboToday
  ]);

  useEffect(() => {
    setJobs(displayedJobs);
  }, [displayedJobs]);

  const hasActiveFilters = Boolean(
    statusFilter || dateFilter || dateFromFilter || dateToFilter ||
    (!isTechnicianMode && technicianFilter) || assignmentFilter ||
    treatmentFilter || vehicleFilter || machineFilter || search
  );

  const handleClearAllFilters = () => {
    setStatusFilter('');
    setDateFilter('');
    setDateFromFilter('');
    setDateToFilter('');
    if (!isTechnicianMode) setTechnicianFilter('');
    setAssignmentFilter('');
    setTreatmentFilter('');
    setVehicleFilter('');
    setMachineFilter('');
    setSearch('');
  };

  const loadJobDetails = async (id) => {
    try {
      const res = await getJobById(id);
      if (isTechnicianMode && res.job && isJobScheduledAfterToday(res.job)) {
        setTomorrowNoticeJob(res.job);
        return;
      }
      setSelectedJob(res.job);
      setJobDetails(res);
    } catch (e) {
      console.error(e);
    }
  };

  useEffect(() => {
    loadJobs();
  }, [
    statusFilter, dateFilter, dateFromFilter, dateToFilter,
    technicianFilter, assignmentFilter, treatmentFilter,
    vehicleFilter, machineFilter, search, activeTechId
  ]);

  useEffect(() => {
    getStaff().then(r => setStaff(r.staff || []));
    getTreatments().then(r => setTreatments(r.treatments || []));
    getVehicles().then(r => setFleetVehicles(r.vehicles || [])).catch(() => {});
    getMachines().then(r => setFleetMachines(r.machines || [])).catch(() => {});
    loadAllCustomers();
  }, []);

  useEffect(() => {
    if (showCreateModal && customers.length === 0) {
      loadAllCustomers();
    }
  }, [showCreateModal]);

  useEffect(() => {
    if (initialJobId) {
      loadJobDetails(initialJobId);
    }
  }, [initialJobId]);

  const handleStartJob = async (jobOrId) => {
    const jobObj = typeof jobOrId === 'object' ? jobOrId : jobs.find(j => j.id === jobOrId);
    const jobId = typeof jobOrId === 'object' ? jobOrId.id : jobOrId;
    if (isTechnicianMode && jobObj && isJobScheduledAfterToday(jobObj)) {
      setTomorrowNoticeJob(jobObj);
      return;
    }
    try {
      await startJob(jobId);
      loadJobs();
      if (selectedJob?.id === jobId) loadJobDetails(jobId);
    } catch (err) {
      alert(`Error starting job: ${err.message}`);
    }
  };

  const handleCompleteSubmit = async (e) => {
    e.preventDefault();
    if (!selectedJob) return;

    try {
      await completeJob(selectedJob.id, {
        technician_notes: completionNotes,
        customer_signature: customerSignature,
        photos: photoUrl ? [{ url: photoUrl, type: 'COMPLETION' }] : []
      });

      alert('Job marked as COMPLETED! Next recurring date calculated & next job generated.');
      setShowCompleteModal(false);
      setCompletionNotes('');
      setCustomerSignature(null);
      setPhotoUrl('');
      loadJobs();
      loadJobDetails(selectedJob.id);
    } catch (err) {
      alert(`Error: ${err.message}`);
    }
  };

  const handlePostponeSubmit = async (e) => {
    e.preventDefault();
    if (!selectedJob || !postponeDate) return;

    try {
      await postponeJob(selectedJob.id, {
        postponed_to_date: postponeDate,
        reason: postponeReason
      });
      alert(`Job postponed to ${postponeDate}`);
      setShowPostponeModal(false);
      setPostponeDate('');
      setPostponeReason('');
      loadJobs();
      loadJobDetails(selectedJob.id);
    } catch (err) {
      alert(`Error: ${err.message}`);
    }
  };

  const handleBulkAssign = async () => {
    if (selectedJobIds.length === 0 || !bulkTechId) return;
    try {
      const res = await bulkAssignJobs(selectedJobIds, bulkTechId, {
        send_sms: bulkSendSms,
        custom_base_url: window.location.origin
      });
      if (bulkSendSms) {
        alert(`Successfully assigned ${selectedJobIds.length} jobs.\n\nSMS with unexpiring job links dispatched to technician phone.`);
      } else {
        alert(`Successfully assigned ${selectedJobIds.length} jobs to technician.\n(SMS dispatch was DISABLED - no SMS was sent).`);
      }
      setSelectedJobIds([]);
      setBulkTechId('');
      loadJobs();
    } catch (err) {
      alert(`Error: ${err.message}`);
    }
  };

  const handleCreateJob = async (e) => {
    e.preventDefault();
    try {
      const res = await createJob({
        ...newJobForm,
        send_sms: createSendSms,
        custom_base_url: window.location.origin
      });
      if (createSendSms && res.smsResult && res.smsResult.success) {
        alert(`Job created successfully!\n\nSMS with Job Start Link was sent directly to technician (${res.smsResult.formattedPhone || 'Delivered'}).`);
      } else if (createSendSms && res.smsResult && !res.smsResult.success) {
        alert(`Job created successfully, but SMS could not be sent: ${res.smsResult.error || 'Failed'}`);
      } else {
        alert('Job created successfully! (SMS dispatch was disabled)');
      }
      setShowCreateModal(false);
      resetNewJobForm();
      loadJobs();
    } catch (err) {
      alert(`Error: ${err.message}`);
    }
  };

  const toggleSelectJob = (id) => {
    if (selectedJobIds.includes(id)) {
      setSelectedJobIds(selectedJobIds.filter(i => i !== id));
    } else {
      setSelectedJobIds([...selectedJobIds, id]);
    }
  };

  return (
    <div className="space-y-6 pb-12">

      {/* PREMIUM COMMAND HEADER & INTERACTIVE KPI FILTER CARDS */}
      <div className="bg-gradient-to-br from-[#2E1065] via-[#4C1D95] to-[#1E1B4B] rounded-3xl p-5 sm:p-6 text-white shadow-xl border border-purple-700/50 relative overflow-hidden">
        <div className="absolute -top-24 -right-24 w-72 h-72 bg-orange-500/15 rounded-full blur-3xl pointer-events-none" />

        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 relative z-10">
          <div className="space-y-1">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/15 backdrop-blur-md border border-white/20 text-[10px] font-black uppercase tracking-widest text-amber-300">
              <Sparkles className="w-3.5 h-3.5 text-amber-300" />
              <span>Dispatch &amp; Field Operations Control Center</span>
            </div>
            <h1 className="text-2xl sm:text-3xl font-black text-white tracking-tight flex items-center gap-2.5">
              <Briefcase className="w-7 h-7 text-[#FF8A00]" />
              <span>Operational Jobs &amp; Service Assignments</span>
            </h1>
            <p className="text-xs sm:text-sm text-purple-200 font-medium max-w-2xl">
              Filter, assign, dispatch, and track daily pest control jobs by date, status, technician, treatment, vehicle, or equipment.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            <button
              type="button"
              onClick={loadJobs}
              className="p-2.5 rounded-2xl bg-white/15 hover:bg-white/25 text-white border border-white/20 transition cursor-pointer"
              title="Refresh Jobs List"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin text-amber-300' : ''}`} />
            </button>

            {!isMobileView && !isTechnicianMode && (
              <>
                {onOpenAddCustomer && (
                  <button
                    type="button"
                    onClick={onOpenAddCustomer}
                    className="flex items-center gap-1.5 px-4 py-2.5 bg-white/15 hover:bg-white/25 text-white text-xs font-black rounded-2xl border border-white/25 transition cursor-pointer"
                  >
                    <UserPlus className="w-4 h-4 text-amber-300" />
                    <span>+ Add Customer</span>
                  </button>
                )}

                <button
                  type="button"
                  onClick={() => setShowCreateModal(true)}
                  className="flex items-center gap-1.5 px-4 py-2.5 bg-gradient-to-r from-[#F97316] to-[#EA580C] hover:from-[#EA580C] hover:to-[#C2410C] text-white text-xs font-black rounded-2xl shadow-lg shadow-orange-950/40 transition cursor-pointer"
                >
                  <Plus className="w-4 h-4" />
                  <span>Create Manual Job</span>
                </button>
              </>
            )}
          </div>
        </div>

        {/* 5 Interactive KPI Filter Cards */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2.5 mt-5 relative z-10">
          <button
            type="button"
            onClick={() => { setStatusFilter(''); setAssignmentFilter(''); }}
            className={`p-3.5 rounded-2xl border text-left transition cursor-pointer ${
              statusFilter === '' && assignmentFilter === ''
                ? 'bg-white text-[#3B0764] border-white shadow-lg scale-[1.01]'
                : 'bg-white/10 hover:bg-white/15 text-white border-white/15'
            }`}
          >
            <div className="flex items-center justify-between">
              <span className={`text-[10px] font-black uppercase tracking-wider ${statusFilter === '' && assignmentFilter === '' ? 'text-[#5B21B6]' : 'text-purple-200'}`}>
                Total Jobs
              </span>
              <Briefcase className={`w-4 h-4 ${statusFilter === '' && assignmentFilter === '' ? 'text-[#F97316]' : 'text-amber-300'}`} />
            </div>
            <div className="text-2xl font-black mt-1">{kpiStats.all}</div>
            <div className={`text-[10px] font-semibold mt-0.5 ${statusFilter === '' && assignmentFilter === '' ? 'text-slate-600' : 'text-white/75'}`}>
              {dateFilter ? `On ${dateFilter}` : 'All loaded schedule'}
            </div>
          </button>

          <button
            type="button"
            onClick={() => { setStatusFilter(statusFilter === 'IN_PROGRESS' ? '' : 'IN_PROGRESS'); setAssignmentFilter(''); }}
            className={`p-3.5 rounded-2xl border text-left transition cursor-pointer ${
              statusFilter === 'IN_PROGRESS'
                ? 'bg-gradient-to-r from-[#F97316] to-[#EA580C] text-white border-amber-300 shadow-lg scale-[1.01]'
                : 'bg-white/10 hover:bg-white/15 text-white border-white/15'
            }`}
          >
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-black uppercase tracking-wider text-amber-200 flex items-center gap-1">
                <span className="w-2 h-2 rounded-full bg-amber-300 animate-ping" />
                <span>In Progress</span>
              </span>
              <PlayCircle className="w-4 h-4 text-amber-300" />
            </div>
            <div className="text-2xl font-black mt-1">{kpiStats.inProgress}</div>
            <div className="text-[10px] text-white/80 font-semibold mt-0.5">Active in field now</div>
          </button>

          <button
            type="button"
            onClick={() => { setStatusFilter(statusFilter === 'PENDING' ? '' : 'PENDING'); setAssignmentFilter(''); }}
            className={`p-3.5 rounded-2xl border text-left transition cursor-pointer ${
              statusFilter === 'PENDING'
                ? 'bg-white text-[#3B0764] border-white shadow-lg scale-[1.01]'
                : 'bg-white/10 hover:bg-white/15 text-white border-white/15'
            }`}
          >
            <div className="flex items-center justify-between">
              <span className={`text-[10px] font-black uppercase tracking-wider ${statusFilter === 'PENDING' ? 'text-[#5B21B6]' : 'text-purple-200'}`}>
                Scheduled / To Do
              </span>
              <Clock className={`w-4 h-4 ${statusFilter === 'PENDING' ? 'text-[#5B21B6]' : 'text-purple-300'}`} />
            </div>
            <div className="text-2xl font-black mt-1">{kpiStats.toDo}</div>
            <div className={`text-[10px] font-semibold mt-0.5 ${statusFilter === 'PENDING' ? 'text-slate-600' : 'text-white/75'}`}>
              Ready for execution
            </div>
          </button>

          <button
            type="button"
            onClick={() => { setStatusFilter(statusFilter === 'COMPLETED' ? '' : 'COMPLETED'); setAssignmentFilter(''); }}
            className={`p-3.5 rounded-2xl border text-left transition cursor-pointer ${
              statusFilter === 'COMPLETED'
                ? 'bg-gradient-to-r from-emerald-600 to-teal-600 text-white border-emerald-300 shadow-lg scale-[1.01]'
                : 'bg-white/10 hover:bg-white/15 text-white border-white/15'
            }`}
          >
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-black uppercase tracking-wider text-emerald-200">
                Completed
              </span>
              <CheckCircle2 className="w-4 h-4 text-emerald-300" />
            </div>
            <div className="text-2xl font-black mt-1">{kpiStats.completed}</div>
            <div className="text-[10px] text-white/80 font-semibold mt-0.5">Finished &amp; signed off</div>
          </button>

          <button
            type="button"
            onClick={() => {
              setAssignmentFilter(assignmentFilter === 'UNASSIGNED' ? '' : 'UNASSIGNED');
              setStatusFilter('');
            }}
            className={`p-3.5 rounded-2xl border text-left transition cursor-pointer col-span-2 sm:col-span-1 ${
              assignmentFilter === 'UNASSIGNED'
                ? 'bg-gradient-to-r from-rose-600 to-orange-600 text-white border-rose-300 shadow-lg scale-[1.01]'
                : 'bg-white/10 hover:bg-white/15 text-white border-white/15'
            }`}
          >
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-black uppercase tracking-wider text-rose-200">
                Unassigned Jobs
              </span>
              <AlertTriangle className="w-4 h-4 text-amber-300" />
            </div>
            <div className="text-2xl font-black mt-1">{kpiStats.unassigned}</div>
            <div className="text-[10px] text-white/80 font-semibold mt-0.5">Needs technician dispatch</div>
          </button>
        </div>
      </div>

      {/* SMART MULTI-DIMENSIONAL FILTER & CONTROL PANEL */}
      <div className="bg-white rounded-3xl border-2 border-purple-100 shadow-sm p-4 sm:p-5 space-y-4">

        {/* ROW 1: Quick Date Horizon Tabs + Date Pickers + View Switcher */}
        <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-3 pb-3.5 border-b border-slate-100">
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => {
                setDateFilter(colomboToday);
                setDateFromFilter('');
                setDateToFilter('');
              }}
              className={`px-4 py-2.5 rounded-xl font-black text-xs flex items-center gap-1.5 transition cursor-pointer ${
                dateFilter === colomboToday
                  ? 'bg-gradient-to-r from-[#F97316] to-[#EA580C] text-white shadow-sm'
                  : 'bg-orange-50/70 text-orange-800 hover:bg-orange-100 border border-orange-200/80'
              }`}
            >
              <CalendarIcon className="w-3.5 h-3.5 shrink-0" />
              <span>Today Jobs ({colomboToday})</span>
              <span className={`px-1.5 py-0.2 rounded-full text-[10px] font-black ${
                dateFilter === colomboToday ? 'bg-white/25 text-white' : 'bg-orange-200/80 text-orange-950'
              }`}>
                {kpiStats.todayJobs}
              </span>
            </button>

            <button
              type="button"
              onClick={() => {
                setDateFilter(colomboTomorrow);
                setDateFromFilter('');
                setDateToFilter('');
              }}
              className={`px-4 py-2.5 rounded-xl font-black text-xs flex items-center gap-1.5 transition cursor-pointer ${
                dateFilter === colomboTomorrow
                  ? 'bg-gradient-to-r from-[#5B21B6] to-[#6D28D9] text-white shadow-sm'
                  : 'bg-purple-50/80 text-[#4C1D95] hover:bg-purple-100 border border-purple-200/80'
              }`}
            >
              <Clock className="w-3.5 h-3.5 shrink-0" />
              <span>Tomorrow Jobs ({colomboTomorrow})</span>
              <span className={`px-1.5 py-0.2 rounded-full text-[10px] font-black ${
                dateFilter === colomboTomorrow ? 'bg-white/25 text-white' : 'bg-purple-200/80 text-purple-950'
              }`}>
                {kpiStats.tomorrowJobs}
              </span>
            </button>

            <button
              type="button"
              onClick={() => {
                setDateFilter('');
                setDateFromFilter('');
                setDateToFilter('');
              }}
              className={`px-4 py-2.5 rounded-xl font-black text-xs flex items-center gap-1.5 transition cursor-pointer ${
                dateFilter === '' && !dateFromFilter && !dateToFilter
                  ? 'bg-[#3B0764] text-white shadow-sm'
                  : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
              }`}
            >
              <Briefcase className="w-3.5 h-3.5 shrink-0" />
              <span>All Dates ({kpiStats.allDatesJobs})</span>
            </button>

            {/* Exact Date Picker */}
            <div className="flex items-center gap-1.5 bg-slate-50 border border-slate-200 rounded-xl px-3 py-1.5 text-xs">
              <span className="text-[10px] font-black uppercase text-slate-400">Exact Date:</span>
              <input
                type="date"
                value={dateFilter}
                onChange={(e) => {
                  setDateFilter(e.target.value);
                  setDateFromFilter('');
                  setDateToFilter('');
                }}
                className="bg-transparent font-bold text-slate-800 focus:outline-hidden cursor-pointer text-xs"
              />
              {dateFilter && (
                <button
                  type="button"
                  onClick={() => setDateFilter('')}
                  className="text-slate-400 hover:text-slate-700 cursor-pointer"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            {/* Date Range Picker (From - To) */}
            <div className="flex items-center gap-1.5 bg-slate-50 border border-slate-200 rounded-xl px-3 py-1.5 text-xs">
              <span className="text-[10px] font-black uppercase text-slate-400">Range:</span>
              <input
                type="date"
                value={dateFromFilter}
                onChange={(e) => {
                  setDateFromFilter(e.target.value);
                  setDateFilter('');
                }}
                className="bg-transparent font-bold text-slate-800 focus:outline-hidden cursor-pointer text-xs"
                title="From Date"
              />
              <span className="text-slate-400 font-bold">→</span>
              <input
                type="date"
                value={dateToFilter}
                onChange={(e) => {
                  setDateToFilter(e.target.value);
                  setDateFilter('');
                }}
                className="bg-transparent font-bold text-slate-800 focus:outline-hidden cursor-pointer text-xs"
                title="To Date"
              />
              {(dateFromFilter || dateToFilter) && (
                <button
                  type="button"
                  onClick={() => {
                    setDateFromFilter('');
                    setDateToFilter('');
                  }}
                  className="text-slate-400 hover:text-slate-700 cursor-pointer"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          </div>

          {/* Right: Desktop View Mode Toggle (Table vs Cards) & Clear Filters */}
          <div className="flex items-center gap-2">
            {hasActiveFilters && (
              <button
                type="button"
                onClick={handleClearAllFilters}
                className="px-3.5 py-2 rounded-xl bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 font-black text-xs flex items-center gap-1.5 transition cursor-pointer"
              >
                <X className="w-3.5 h-3.5" />
                <span>Reset All Filters</span>
              </button>
            )}

            {!isMobileView && (
              <div className="hidden lg:flex items-center bg-slate-100 p-1 rounded-xl border border-slate-200">
                <button
                  type="button"
                  onClick={() => setViewMode('table')}
                  className={`px-3 py-1.5 rounded-lg text-xs font-black flex items-center gap-1.5 transition cursor-pointer ${
                    viewMode === 'table'
                      ? 'bg-white text-[#4C1D95] shadow-2xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  <List className="w-3.5 h-3.5" />
                  <span>Table</span>
                </button>
                <button
                  type="button"
                  onClick={() => setViewMode('cards')}
                  className={`px-3 py-1.5 rounded-lg text-xs font-black flex items-center gap-1.5 transition cursor-pointer ${
                    viewMode === 'cards'
                      ? 'bg-white text-[#4C1D95] shadow-2xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  <LayoutGrid className="w-3.5 h-3.5" />
                  <span>Cards</span>
                </button>
              </div>
            )}
          </div>
        </div>

        {/* ROW 2: Interactive Technician Filter Pills (Admin / Manager Mode) */}
        {!isTechnicianMode && (
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-black uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
                <HardHat className="w-3.5 h-3.5 text-[#F97316]" />
                <span>Quick Filter by Technician / Assignment</span>
              </span>
              {technicianFilter && (
                <button
                  type="button"
                  onClick={() => setTechnicianFilter('')}
                  className="text-[11px] font-bold text-[#6D28D9] hover:underline cursor-pointer"
                >
                  Show All Technicians
                </button>
              )}
            </div>
            <div className="flex items-center gap-2 overflow-x-auto pb-1">
              <button
                type="button"
                onClick={() => {
                  setTechnicianFilter('');
                  setAssignmentFilter('');
                }}
                className={`px-3.5 py-1.5 rounded-xl text-xs font-black shrink-0 transition cursor-pointer border ${
                  !technicianFilter && !assignmentFilter
                    ? 'bg-[#4C1D95] text-white border-[#4C1D95] shadow-xs'
                    : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-purple-50'
                }`}
              >
                👷 All Technicians ({kpiStats.scopeTotal})
              </button>

              <button
                type="button"
                onClick={() => {
                  setTechnicianFilter('');
                  setAssignmentFilter(assignmentFilter === 'UNASSIGNED' ? '' : 'UNASSIGNED');
                }}
                className={`px-3.5 py-1.5 rounded-xl text-xs font-black shrink-0 transition cursor-pointer border ${
                  assignmentFilter === 'UNASSIGNED'
                    ? 'bg-rose-600 text-white border-rose-600 shadow-xs'
                    : 'bg-rose-50/70 text-rose-800 border-rose-200 hover:bg-rose-100'
                }`}
              >
                ⚠️ Unassigned Only ({kpiStats.scopeUnassigned})
              </button>

              {staff.filter(s => s.role === 'TECHNICIAN' && s.is_active !== 0).map(tech => {
                const count = kpiStats.byTechnician[tech.id] !== undefined
                  ? kpiStats.byTechnician[tech.id]
                  : rawJobs.filter(j => {
                      const techName = tech.full_name?.toLowerCase();
                      const cleanTechName = tech.full_name ? tech.full_name.replace(/\s*\(.*?\)\s*/g, '').trim().toLowerCase() : '';
                      const techUsername = tech.username?.toLowerCase();
                      const matchesLead = String(j.technician_id || j.assigned_technician_id || '') === String(tech.id);
                      const matchesTeam = Boolean(techName && j.team_members && j.team_members.toLowerCase().includes(techName));
                      const matchesClean = Boolean(cleanTechName && j.team_members && j.team_members.toLowerCase().includes(cleanTechName));
                      const matchesUsername = Boolean(techUsername && j.team_members && j.team_members.toLowerCase().includes(techUsername));
                      return matchesLead || matchesTeam || matchesClean || matchesUsername;
                    }).length;
                const isSelected = String(technicianFilter) === String(tech.id);
                return (
                  <button
                    key={tech.id}
                    type="button"
                    onClick={() => {
                      setAssignmentFilter('');
                      setTechnicianFilter(isSelected ? '' : String(tech.id));
                    }}
                    className={`px-3.5 py-1.5 rounded-xl text-xs font-black shrink-0 transition cursor-pointer border flex items-center gap-1.5 ${
                      isSelected
                        ? 'bg-gradient-to-r from-[#F97316] to-[#EA580C] text-white border-orange-500 shadow-xs'
                        : 'bg-white text-slate-800 border-slate-200 hover:border-purple-300 hover:bg-purple-50/50'
                    }`}
                  >
                    <span>{tech.full_name}</span>
                    <span className={`px-1.5 py-0.2 rounded-full text-[10px] font-black ${
                      isSelected ? 'bg-white/25 text-white' : 'bg-slate-100 text-slate-600'
                    }`}>
                      {count}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* ROW 3: Interactive Status Filter Pills */}
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
          {[
            { id: '', label: `All Statuses (${kpiStats.all})` },
            { id: 'IN_PROGRESS', label: `🔴 In Progress (${kpiStats.inProgress})` },
            { id: 'PENDING', label: `📋 Active / To Do (${kpiStats.toDo})` },
            { id: 'ASSIGNED', label: `👷 Assigned (${kpiStats.assigned})` },
            { id: 'TO_BE_DONE', label: `⏳ To Be Done (${kpiStats.toBeDone})` },
            { id: 'CONFIRMED', label: `✔️ Confirmed (${kpiStats.confirmed})` },
            { id: 'COMPLETED', label: `✅ Completed (${kpiStats.completed})` },
            { id: 'POSTPONED', label: `⏸️ Postponed (${kpiStats.postponed})` },
            { id: 'OVERDUE', label: `⚠️ Overdue (${kpiStats.overdue})` },
            { id: 'UNCONFIRMED', label: `❓ Unconfirmed (${kpiStats.unconfirmed})` },
            { id: 'CANCELLED', label: `✕ Cancelled (${kpiStats.cancelled})` }
          ].map(st => (
            <button
              key={st.id || 'all'}
              type="button"
              onClick={() => setStatusFilter(statusFilter === st.id ? '' : st.id)}
              className={`px-3 py-1.5 rounded-xl text-[11px] font-black shrink-0 transition cursor-pointer ${
                statusFilter === st.id
                  ? 'bg-[#3B0764] text-white shadow-xs'
                  : 'bg-slate-100 text-slate-700 hover:bg-purple-50 hover:text-[#4C1D95]'
              }`}
            >
              {st.label}
            </button>
          ))}
        </div>

        {/* ROW 4: Multi-Column Advanced Filters (Search, Status, Technician, Treatment, Vehicle, Machine) */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-2.5 text-xs pt-1">
          {/* 1. Instant Search */}
          <div className="relative sm:col-span-2">
            <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search job code, customer, phone, location, tech, vehicle, machine..."
              className="w-full bg-slate-50 pl-10 pr-8 py-2.5 rounded-xl border border-slate-200 font-semibold text-slate-900 focus:bg-white focus:outline-hidden focus:border-[#6D28D9]"
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 cursor-pointer"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          {/* 2. Technician Dropdown */}
          {!isTechnicianMode ? (
            <select
              value={technicianFilter}
              onChange={(e) => {
                setTechnicianFilter(e.target.value);
                if (e.target.value) setAssignmentFilter('');
              }}
              className="w-full bg-slate-50 px-3 py-2.5 rounded-xl border border-slate-200 font-bold text-slate-800 focus:outline-hidden focus:border-[#6D28D9] cursor-pointer"
            >
              <option value="">👷 All Technicians</option>
              {staff.filter(s => s.role === 'TECHNICIAN').map(s => (
                <option key={s.id} value={s.id}>{s.full_name}</option>
              ))}
            </select>
          ) : (
            <div className="w-full bg-purple-50/70 px-3 py-2.5 rounded-xl border border-purple-200/80 text-xs font-bold text-[#4C1D95] flex items-center gap-1.5 truncate">
              <User className="w-3.5 h-3.5 shrink-0 text-[#6D28D9]" />
              <span className="truncate">My Assigned Jobs</span>
            </div>
          )}

          {/* 3. Treatment Filter */}
          <select
            value={treatmentFilter}
            onChange={(e) => setTreatmentFilter(e.target.value)}
            className="w-full bg-slate-50 px-3 py-2.5 rounded-xl border border-slate-200 font-bold text-slate-800 focus:outline-hidden focus:border-[#6D28D9] cursor-pointer"
          >
            <option value="">🧪 All Treatments</option>
            {treatments.map(t => (
              <option key={t.id} value={t.id}>{t.code} — {t.name}</option>
            ))}
          </select>

          {/* 4. Vehicle Filter */}
          <select
            value={vehicleFilter}
            onChange={(e) => setVehicleFilter(e.target.value)}
            className="w-full bg-slate-50 px-3 py-2.5 rounded-xl border border-slate-200 font-bold text-slate-800 focus:outline-hidden focus:border-[#6D28D9] cursor-pointer"
          >
            <option value="">🚚 All Vehicles</option>
            {vehicleFilterOptions.map(v => (
              <option key={v} value={v}>🚗 {v}</option>
            ))}
          </select>

          {/* 5. Machine Filter */}
          <select
            value={machineFilter}
            onChange={(e) => setMachineFilter(e.target.value)}
            className="w-full bg-slate-50 px-3 py-2.5 rounded-xl border border-slate-200 font-bold text-slate-800 focus:outline-hidden focus:border-[#6D28D9] cursor-pointer"
          >
            <option value="">⚙️ All Machines</option>
            {machineFilterOptions.map(m => (
              <option key={m} value={m}>⚙️ {m}</option>
            ))}
          </select>
        </div>

        {/* Active Filter Summary Bar */}
        <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-100 text-xs">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-black text-slate-800">
              Showing <span className="text-[#6D28D9]">{jobs.length}</span> of {total || kpiStats.all} Matching Job(s)
            </span>
            {dateFilter && (
              <span className="px-2.5 py-0.5 rounded-full bg-orange-100 text-orange-800 font-bold text-[11px] flex items-center gap-1 shadow-2xs">
                📅 Date: {dateFilter}
                <X className="w-3 h-3 cursor-pointer hover:text-orange-950" onClick={() => setDateFilter('')} />
              </span>
            )}
            {(dateFromFilter || dateToFilter) && (
              <span className="px-2.5 py-0.5 rounded-full bg-purple-100 text-purple-800 font-bold text-[11px] flex items-center gap-1 shadow-2xs">
                📅 Range: {dateFromFilter || '...'} → {dateToFilter || '...'}
                <X className="w-3 h-3 cursor-pointer hover:text-purple-950" onClick={() => { setDateFromFilter(''); setDateToFilter(''); }} />
              </span>
            )}
            {technicianFilter && !isTechnicianMode && (
              <span className="px-2.5 py-0.5 rounded-full bg-amber-100 text-amber-900 font-bold text-[11px] flex items-center gap-1 shadow-2xs">
                👷 Tech: {staff.find(s => String(s.id) === String(technicianFilter))?.full_name || 'Technician'}
                <X className="w-3 h-3 cursor-pointer hover:text-amber-950" onClick={() => setTechnicianFilter('')} />
              </span>
            )}
            {treatmentFilter && (
              <span className="px-2.5 py-0.5 rounded-full bg-teal-100 text-teal-900 font-bold text-[11px] flex items-center gap-1 shadow-2xs">
                🧪 Treatment: {treatments.find(t => String(t.id) === String(treatmentFilter))?.name || 'Treatment'}
                <X className="w-3 h-3 cursor-pointer hover:text-teal-950" onClick={() => setTreatmentFilter('')} />
              </span>
            )}
            {statusFilter && (
              <span className="px-2.5 py-0.5 rounded-full bg-indigo-100 text-indigo-800 font-bold text-[11px] flex items-center gap-1 shadow-2xs">
                📌 Status: {statusFilter}
                <X className="w-3 h-3 cursor-pointer hover:text-indigo-950" onClick={() => setStatusFilter('')} />
              </span>
            )}
            {assignmentFilter && (
              <span className="px-2.5 py-0.5 rounded-full bg-rose-100 text-rose-800 font-bold text-[11px] flex items-center gap-1 shadow-2xs">
                👷 {assignmentFilter}
                <X className="w-3 h-3 cursor-pointer hover:text-rose-950" onClick={() => setAssignmentFilter('')} />
              </span>
            )}
            {vehicleFilter && (
              <span className="px-2.5 py-0.5 rounded-full bg-blue-100 text-blue-800 font-bold text-[11px] flex items-center gap-1 shadow-2xs">
                🚗 {vehicleFilter}
                <X className="w-3 h-3 cursor-pointer hover:text-blue-950" onClick={() => setVehicleFilter('')} />
              </span>
            )}
            {machineFilter && (
              <span className="px-2.5 py-0.5 rounded-full bg-emerald-100 text-emerald-800 font-bold text-[11px] flex items-center gap-1 shadow-2xs">
                ⚙️ {machineFilter}
                <X className="w-3 h-3 cursor-pointer hover:text-emerald-950" onClick={() => setMachineFilter('')} />
              </span>
            )}
            {search && (
              <span className="px-2.5 py-0.5 rounded-full bg-slate-200 text-slate-800 font-bold text-[11px] flex items-center gap-1 shadow-2xs">
                🔍 "{search}"
                <X className="w-3 h-3 cursor-pointer hover:text-slate-950" onClick={() => setSearch('')} />
              </span>
            )}
            {hasActiveFilters && (
              <button
                type="button"
                onClick={handleClearAllFilters}
                className="px-2.5 py-0.5 rounded-full bg-rose-50 hover:bg-rose-100 text-rose-700 font-black text-[11px] flex items-center gap-1 border border-rose-200 cursor-pointer transition ml-1"
              >
                <X className="w-3 h-3" /> Clear All Filters
              </button>
            )}
          </div>

          {!isTechnicianMode && jobs.length > 0 && (
            <div className="text-[11px] text-slate-500 font-medium">
              Tip: Check multiple jobs to bulk-assign a technician, or click any row for full details &amp; PDF export.
            </div>
          )}
        </div>

        {/* Bulk Assign Action Bar (appears when 1 or more jobs are checked - Admin only) */}
        {!isTechnicianMode && selectedJobIds.length > 0 && (
          <div className="p-3.5 bg-gradient-to-r from-emerald-50 to-teal-50 rounded-2xl border-2 border-emerald-300 flex flex-wrap items-center justify-between gap-3 text-xs animate-in fade-in">
            <div className="flex items-center gap-2">
              <span className="px-2.5 py-1 rounded-lg bg-emerald-600 text-white font-black">
                {selectedJobIds.length} Selected
              </span>
              <span className="font-bold text-emerald-950">Bulk Assign Selected Jobs to Technician:</span>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <select
                value={bulkTechId}
                onChange={(e) => setBulkTechId(e.target.value)}
                className="bg-white px-3 py-2 rounded-xl border border-emerald-300 font-bold text-slate-800"
              >
                <option value="">Select Technician to Assign...</option>
                {staff.filter(s => s.role === 'TECHNICIAN').map(s => (
                  <option key={s.id} value={s.id}>{s.full_name}</option>
                ))}
              </select>

              <button
                type="button"
                onClick={() => setBulkSendSms(!bulkSendSms)}
                className={`px-3 py-2 rounded-xl font-bold flex items-center gap-1.5 border transition cursor-pointer ${
                  bulkSendSms
                    ? 'bg-emerald-600 text-white border-emerald-700 shadow-2xs'
                    : 'bg-white text-slate-600 border-slate-300 hover:bg-slate-50'
                }`}
                title="Toggle whether to dispatch SMS with Job link to technician"
              >
                <MessageSquare className="w-3.5 h-3.5" />
                <span>Send SMS Link: {bulkSendSms ? 'ENABLED ✓' : 'DISABLED ✕'}</span>
              </button>

              <button
                onClick={handleBulkAssign}
                disabled={!bulkTechId}
                className="px-4 py-2 bg-[#4C1D95] hover:bg-[#3B0764] text-white font-black rounded-xl shadow-xs disabled:opacity-50 cursor-pointer"
              >
                Assign {selectedJobIds.length} Job(s)
              </button>

              <button
                type="button"
                onClick={() => setSelectedJobIds([])}
                className="px-3 py-2 bg-white hover:bg-slate-100 text-slate-600 font-bold rounded-xl border border-slate-200 cursor-pointer"
              >
                Clear
              </button>
            </div>
          </div>
        )}
      </div>

      {/* JOB CARDS GRID VIEW (Always on Mobile/Tablet, or when 'cards' viewMode is chosen on Desktop) */}
      <div className={`${isMobileView || viewMode === 'cards' ? 'block' : 'lg:hidden'}`}>
        {jobs.length === 0 ? (
          <div className="bg-white p-10 rounded-3xl border border-slate-200 text-center space-y-2">
            <Briefcase className="w-12 h-12 text-slate-300 mx-auto" />
            <p className="text-base font-black text-slate-800">No Matching Jobs Found</p>
            <p className="text-xs text-slate-500">Your current filter combination has 0 matching jobs.</p>
            {hasActiveFilters && (
              <div className="pt-2">
                <button
                  type="button"
                  onClick={handleClearAllFilters}
                  className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-[#F97316] to-[#EA580C] hover:from-[#EA580C] hover:to-[#C2410C] text-white font-black text-xs shadow-md shadow-orange-500/20 active:scale-98 transition cursor-pointer"
                >
                  ✕ Reset All Filters &amp; View All Jobs
                </button>
              </div>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {jobs.map(job => {
              const isLockedTomorrow = isTechnicianMode && isJobScheduledAfterToday(job);
              const vehicleStr = job.vehicle_no || job.vehicle_number;
              const machineStr = job.machine_name || job.machine_type;

              return (
                <div
                  key={job.id}
                  onClick={() => isLockedTomorrow ? setTomorrowNoticeJob(job) : loadJobDetails(job.id)}
                  className={`bg-white p-4 sm:p-5 rounded-3xl border-2 shadow-xs hover:shadow-md space-y-3.5 transition cursor-pointer flex flex-col justify-between relative overflow-hidden ${
                    job.status === 'IN_PROGRESS'
                      ? 'border-amber-400 bg-amber-50/10'
                      : job.status === 'COMPLETED'
                        ? 'border-emerald-200'
                        : isLockedTomorrow
                          ? 'border-purple-200/90 bg-purple-50/20'
                          : 'border-purple-100'
                  }`}
                >
                  <div
                    className="absolute top-0 left-0 bottom-0 w-1.5"
                    style={{
                      backgroundColor: job.status === 'IN_PROGRESS'
                        ? '#F97316'
                        : job.status === 'COMPLETED'
                          ? '#10B981'
                          : (job.treatment_color || '#6D28D9')
                    }}
                  />

                  <div className="space-y-3 pl-1.5">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="text-[10px] font-mono font-black bg-slate-100 text-slate-700 px-2 py-0.5 rounded-md">
                            {job.job_code}
                          </span>
                          <span
                            style={{ backgroundColor: `${job.treatment_color || '#6D28D9'}20`, color: job.treatment_color || '#6D28D9' }}
                            className="px-2 py-0.5 rounded-md text-[10px] font-black"
                          >
                            🧪 {job.treatment_code}
                          </span>
                          {isLockedTomorrow && (
                            <span className="px-2 py-0.5 bg-[#5B21B6] text-white rounded-md text-[9px] font-black uppercase tracking-wider flex items-center gap-1">
                              <Lock className="w-2.5 h-2.5" /> Tomorrow Only
                            </span>
                          )}
                        </div>
                        <h3 className="text-base font-black text-slate-900 mt-1.5 leading-snug truncate">{job.customer_name}</h3>
                        <div className="text-[11px] font-bold text-slate-500 mt-0.5 flex items-center gap-1.5">
                          <CalendarIcon className="w-3.5 h-3.5 text-[#6D28D9]" />
                          <span>{getJobEffectiveDate(job)}</span>
                          <span>&bull;</span>
                          <span>{job.scheduled_time || '09:00'} ({job.duration_minutes || 60}m)</span>
                        </div>
                      </div>
                      <span className={`px-2.5 py-1 rounded-full text-[10px] font-black shrink-0 ${
                        job.status === 'COMPLETED' ? 'bg-emerald-100 text-emerald-800 border border-emerald-300' :
                        job.status === 'IN_PROGRESS' ? 'bg-amber-100 text-amber-900 border border-amber-300 animate-pulse' :
                        job.status === 'POSTPONED' ? 'bg-purple-100 text-purple-800' :
                        'bg-slate-100 text-slate-700'
                      }`}>
                        {job.status}
                      </span>
                    </div>

                    <div className="flex items-center gap-1.5 text-xs text-slate-600 bg-slate-50 px-3 py-2 rounded-xl border border-slate-100">
                      <MapPin className="w-3.5 h-3.5 text-[#F97316] shrink-0" />
                      <span className="truncate font-medium">{job.location_name || job.location_address || 'Main Location'}</span>
                    </div>

                    {/* Technician, Crew, Vehicle & Machine Mini Grid */}
                    <div className="grid grid-cols-2 gap-1.5 text-[11px]">
                      <div className="p-2 rounded-xl bg-purple-50/60 border border-purple-100">
                        <div className="text-[9px] font-black uppercase text-purple-600">👷 Technician</div>
                        <div className="font-black text-slate-900 truncate mt-0.5">{job.technician_name || 'Unassigned'}</div>
                      </div>
                      <div className="p-2 rounded-xl bg-slate-50 border border-slate-200/70">
                        <div className="text-[9px] font-black uppercase text-slate-500">👥 Crew / People</div>
                        <div className="font-black text-slate-900 truncate mt-0.5">{job.crew_count || 1} People</div>
                      </div>
                      <div className="p-2 rounded-xl bg-slate-50 border border-slate-200/70">
                        <div className="text-[9px] font-black uppercase text-slate-500">🚚 Vehicle No</div>
                        <div className="font-black text-slate-900 truncate mt-0.5">{vehicleStr || 'Not Assigned'}</div>
                      </div>
                      <div className="p-2 rounded-xl bg-slate-50 border border-slate-200/70">
                        <div className="text-[9px] font-black uppercase text-slate-500">⚙️ Machine</div>
                        <div className="font-black text-slate-900 truncate mt-0.5">{machineStr || 'Standard'}</div>
                      </div>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-100 pl-1.5" onClick={(e) => e.stopPropagation()}>
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => downloadJobPdfReport(job)}
                        className="px-2.5 py-1.5 rounded-lg bg-purple-50 hover:bg-purple-100 text-[#4C1D95] border border-purple-200 font-black text-[10px] flex items-center gap-1 cursor-pointer"
                        title="Download Job PDF"
                      >
                        <Download className="w-3 h-3" />
                        <span>PDF</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => shareJobOnWhatsApp(job, false)}
                        className="px-2.5 py-1.5 rounded-lg bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-200 font-black text-[10px] flex items-center gap-1 cursor-pointer"
                        title="Share on WhatsApp"
                      >
                        <Share2 className="w-3 h-3" />
                        <span>WA</span>
                      </button>
                      {!isTechnicianMode && (
                        <button
                          type="button"
                          onClick={() => setEditingJob(job)}
                          className="px-2.5 py-1.5 rounded-lg bg-amber-50 hover:bg-amber-100 text-amber-800 border border-amber-200 font-black text-[10px] flex items-center gap-1 cursor-pointer"
                        >
                          <Edit className="w-3 h-3" />
                          <span>Edit</span>
                        </button>
                      )}
                    </div>

                    {isLockedTomorrow ? (
                      <button
                        type="button"
                        onClick={() => setTomorrowNoticeJob(job)}
                        className="px-3 py-1.5 bg-purple-50 hover:bg-purple-100 text-[#4C1D95] border border-purple-200 font-black rounded-full text-[11px] inline-flex items-center gap-1.5 cursor-pointer"
                      >
                        <Lock className="w-3 h-3 text-[#6D28D9]" />
                        <span>Work Tomorrow Only</span>
                      </button>
                    ) : isTechnicianMode ? (
                      job.status !== 'COMPLETED' && job.status !== 'CANCELLED' && (
                        job.status === 'IN_PROGRESS' ? (
                          <button
                            type="button"
                            onClick={() => {
                              setSelectedJob(job);
                              setShowCompleteModal(true);
                            }}
                            className="px-3.5 py-1.5 bg-emerald-600 text-white font-black rounded-full text-[11px] inline-flex items-center gap-1 shadow-xs cursor-pointer"
                          >
                            <CheckCircle2 className="w-3.5 h-3.5" /> Complete
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() => handleStartJob(job)}
                            className="px-3.5 py-1.5 bg-gradient-to-r from-[#F97316] to-[#EA580C] text-white font-black rounded-full text-[11px] inline-flex items-center gap-1 shadow-xs cursor-pointer"
                          >
                            <PlayCircle className="w-3.5 h-3.5" /> Start
                          </button>
                        )
                      )
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* DESKTOP JOBS TABLE VIEW */}
      <div className={`${isMobileView || viewMode === 'cards' ? 'hidden' : 'hidden lg:block'} bg-white rounded-3xl border-2 border-purple-100 shadow-sm overflow-hidden`}>
        {jobs.length === 0 ? (
          <div className="p-12 text-center space-y-2">
            <Briefcase className="w-12 h-12 text-slate-300 mx-auto" />
            <div className="text-base font-black text-slate-800">No Jobs Match Your Active Filters</div>
            <p className="text-xs text-slate-500">Your current filter combination has 0 matching jobs.</p>
            {hasActiveFilters && (
              <div className="pt-2">
                <button
                  type="button"
                  onClick={handleClearAllFilters}
                  className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-[#F97316] to-[#EA580C] hover:from-[#EA580C] hover:to-[#C2410C] text-white font-black text-xs shadow-md shadow-orange-500/20 active:scale-98 transition cursor-pointer"
                >
                  ✕ Reset All Filters &amp; View All Jobs
                </button>
              </div>
            )}
          </div>
        ) : (
          <div className="divide-y divide-slate-100 overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-gradient-to-r from-purple-50/90 via-slate-50 to-orange-50/60 text-[#3B0764] font-black uppercase text-[10px] tracking-wider border-b border-purple-100">
                <tr>
                  {!isTechnicianMode && (
                    <th className="p-4 w-8">
                      <input
                        type="checkbox"
                        checked={selectedJobIds.length === jobs.length && jobs.length > 0}
                        onChange={(e) => {
                          if (e.target.checked) setSelectedJobIds(jobs.map(j => j.id));
                          else setSelectedJobIds([]);
                        }}
                        className="rounded text-[#6D28D9] focus:ring-[#6D28D9] cursor-pointer"
                      />
                    </th>
                  )}
                  <th className="px-3 py-3.5">Job Code &amp; Schedule</th>
                  <th className="px-3 py-3.5">Customer &amp; Contact</th>
                  <th className="px-3 py-3.5">Service Location</th>
                  <th className="px-3 py-3.5">Treatment</th>
                  <th className="px-3 py-3.5">Technician, Crew &amp; Fleet</th>
                  <th className="px-3 py-3.5">Status</th>
                  <th className="px-4 py-3.5 text-right">Quick Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {jobs.map(job => {
                  const isLockedTomorrow = isTechnicianMode && isJobScheduledAfterToday(job);
                  return (
                    <tr
                      key={job.id}
                      onClick={() => isLockedTomorrow ? setTomorrowNoticeJob(job) : loadJobDetails(job.id)}
                      className={`hover:bg-purple-50/40 cursor-pointer transition ${
                        job.status === 'IN_PROGRESS' ? 'bg-amber-50/30' : ''
                      }`}
                    >
                      {!isTechnicianMode && (
                        <td className="p-4" onClick={(e) => e.stopPropagation()}>
                          <input
                            type="checkbox"
                            checked={selectedJobIds.includes(job.id)}
                            onChange={() => toggleSelectJob(job.id)}
                            className="rounded text-[#6D28D9] focus:ring-[#6D28D9] cursor-pointer"
                          />
                        </td>
                      )}

                      <td className="px-3 py-3.5 whitespace-nowrap">
                        <div className="font-mono font-black text-slate-900">{job.job_code}</div>
                        <div className="text-[11px] text-slate-600 font-semibold mt-0.5 flex items-center gap-1.5">
                          <span>📅 {getJobEffectiveDate(job)}</span>
                          <span>&bull;</span>
                          <span>⏰ {job.scheduled_time || '09:00'}</span>
                        </div>
                      </td>

                      <td className="px-3 py-3.5">
                        <div className="font-black text-slate-900 text-sm">{job.customer_name}</div>
                        {job.customer_phone && (
                          <div className="text-[11px] font-mono text-slate-500 mt-0.5">{job.customer_phone}</div>
                        )}
                      </td>

                      <td className="px-3 py-3.5 text-slate-600 max-w-[200px]">
                        <div className="flex items-center gap-1 font-semibold text-slate-800">
                          <MapPin className="w-3.5 h-3.5 text-[#F97316] shrink-0" />
                          <span className="truncate">{job.location_name || 'Main Site'}</span>
                        </div>
                        {job.location_address && (
                          <div className="text-[11px] text-slate-400 truncate pl-4">{job.location_address}</div>
                        )}
                      </td>

                      <td className="px-3 py-3.5 whitespace-nowrap">
                        <span
                          style={{ backgroundColor: `${job.treatment_color || '#6D28D9'}18`, color: job.treatment_color || '#6D28D9' }}
                          className="px-2.5 py-1 rounded-lg text-xs font-black inline-block"
                        >
                          {job.treatment_code}
                        </span>
                      </td>

                      <td className="px-3 py-3.5 whitespace-nowrap">
                        {job.technician_name ? (
                          <div>
                            <div className="flex items-center gap-1.5 font-black text-slate-900">
                              <User className="w-3.5 h-3.5 text-[#6D28D9]" />
                              <span>{job.technician_name}</span>
                            </div>
                            <div className="flex flex-wrap items-center gap-1 mt-1">
                              <span className="bg-amber-100 text-amber-900 px-1.5 py-0.5 rounded text-[9px] font-black inline-flex items-center gap-0.5">
                                👥 {job.crew_count || 1} {Number(job.crew_count || 1) === 1 ? 'Person' : 'People'}
                              </span>
                              {(job.vehicle_no || job.vehicle_number) && (
                                <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-blue-50 text-blue-800 text-[9px] font-black border border-blue-200">
                                  🚗 {job.vehicle_no || job.vehicle_number}
                                </span>
                              )}
                              {(job.machine_name || job.machine_type) && (
                                <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-purple-50 text-purple-800 text-[9px] font-black border border-purple-200">
                                  ⚙️ {job.machine_name || job.machine_type}
                                </span>
                              )}
                            </div>
                          </div>
                        ) : (
                          <span className="px-2.5 py-1 rounded-lg bg-rose-50 text-rose-700 border border-rose-200 font-black text-[10px] inline-flex items-center gap-1">
                            <AlertTriangle className="w-3 h-3" /> Unassigned
                          </span>
                        )}
                      </td>

                      <td className="px-3 py-3.5 whitespace-nowrap">
                        <span className={`px-2.5 py-1 rounded-full text-[10px] font-black ${
                          job.status === 'COMPLETED' ? 'bg-emerald-100 text-emerald-800 border border-emerald-300' :
                          job.status === 'IN_PROGRESS' ? 'bg-amber-100 text-amber-900 border border-amber-300 animate-pulse' :
                          job.status === 'POSTPONED' ? 'bg-indigo-100 text-indigo-800' :
                          job.status === 'CANCELLED' ? 'bg-rose-100 text-rose-800' :
                          'bg-slate-100 text-slate-700'
                        }`}>
                          {job.status}
                        </span>
                      </td>

                      <td className="px-4 py-3.5 text-right whitespace-nowrap space-x-1" onClick={(e) => e.stopPropagation()}>
                        <button
                          type="button"
                          onClick={() => downloadJobPdfReport(job)}
                          className="px-2 py-1 bg-purple-50 hover:bg-purple-100 text-[#4C1D95] font-black rounded-lg text-[10px] inline-flex items-center gap-1 border border-purple-200 transition cursor-pointer"
                          title="Download Full Job PDF"
                        >
                          <Download className="w-3 h-3" />
                          <span>PDF</span>
                        </button>

                        <button
                          type="button"
                          onClick={() => shareJobOnWhatsApp(job, false)}
                          className="px-2 py-1 bg-emerald-50 hover:bg-emerald-100 text-emerald-800 font-black rounded-lg text-[10px] inline-flex items-center gap-1 border border-emerald-200 transition cursor-pointer"
                          title="Share on WhatsApp"
                        >
                          <Share2 className="w-3 h-3" />
                          <span>WA</span>
                        </button>

                        {!isTechnicianMode && (
                          <button
                            type="button"
                            onClick={() => setEditingJob(job)}
                            className="px-2.5 py-1 bg-amber-50 hover:bg-amber-100 text-amber-800 font-black rounded-lg text-[10px] inline-flex items-center gap-1 border border-amber-200 transition cursor-pointer"
                            title="Edit Job Details"
                          >
                            <Edit className="w-3 h-3 text-amber-600" />
                            <span>Edit</span>
                          </button>
                        )}

                        {isLockedTomorrow ? (
                          <button
                            type="button"
                            onClick={() => setTomorrowNoticeJob(job)}
                            className="px-2.5 py-1 bg-indigo-50 hover:bg-indigo-100 text-indigo-800 font-bold rounded-lg text-[10px] inline-flex items-center gap-1 border border-indigo-200 transition"
                          >
                            <Lock className="w-3 h-3 text-indigo-600" /> Tomorrow Only
                          </button>
                        ) : (
                          job.status !== 'COMPLETED' && job.status !== 'CANCELLED' && (
                            <>
                              {job.status === 'IN_PROGRESS' ? (
                                <button
                                  onClick={() => {
                                    setSelectedJob(job);
                                    setShowCompleteModal(true);
                                  }}
                                  className="px-2.5 py-1 bg-emerald-600 hover:bg-emerald-700 text-white font-black rounded-lg text-[10px] inline-flex items-center gap-1 shadow-2xs transition cursor-pointer"
                                >
                                  <CheckCircle2 className="w-3 h-3" /> Complete
                                </button>
                              ) : (
                                <button
                                  onClick={() => handleStartJob(job)}
                                  className="px-2.5 py-1 bg-[#F97316] hover:bg-[#EA580C] text-white font-black rounded-lg text-[10px] inline-flex items-center gap-1 transition cursor-pointer"
                                >
                                  <PlayCircle className="w-3 h-3" /> Start
                                </button>
                              )}
                            </>
                          )
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Job Details Drawer / Inspection Modal */}
      {selectedJob && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-xs z-50 flex justify-end">
          <div className="bg-white w-full max-w-xl h-full shadow-2xl overflow-y-auto flex flex-col animate-in slide-in-from-right duration-200">

            {/* Header */}
            <div className="p-5 border-b border-slate-200 sticky top-0 bg-white z-10 space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <span className="text-xs font-mono font-bold bg-slate-100 text-slate-700 px-2 py-0.5 rounded">
                    {selectedJob.job_code}
                  </span>
                  <h2 className="font-extrabold text-lg text-slate-900 mt-1">{selectedJob.customer_name}</h2>
                </div>
                <div className="flex items-center gap-2">
                  {!isTechnicianMode && (
                    <button
                      type="button"
                      onClick={() => setEditingJob(selectedJob)}
                      className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-50 hover:bg-amber-100 text-amber-800 font-bold text-xs rounded-xl border border-amber-200 transition shadow-2xs cursor-pointer"
                      title="Edit All Job Details"
                    >
                      <Edit className="w-3.5 h-3.5 text-amber-600" />
                      <span>Edit Job</span>
                    </button>
                  )}
                  <button onClick={() => setSelectedJob(null)} className="p-2 text-slate-400 hover:text-slate-700 rounded-lg hover:bg-slate-100 transition cursor-pointer">
                    <X className="w-5 h-5" />
                  </button>
                </div>
              </div>

              {/* PDF Download, WhatsApp Share & Print Toolbar inside Job Drawer */}
              <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => downloadJobPdfReport(selectedJob)}
                  className="px-3 py-1.5 rounded-xl bg-[#4C1D95] hover:bg-[#3B0764] text-white font-black text-xs flex items-center gap-1.5 shadow-2xs transition cursor-pointer"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>Download PDF</span>
                </button>
                <button
                  type="button"
                  onClick={() => shareJobOnWhatsApp(selectedJob, false)}
                  className="px-3 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-black text-xs flex items-center gap-1.5 shadow-2xs transition cursor-pointer"
                >
                  <Share2 className="w-3.5 h-3.5" />
                  <span>WhatsApp Share</span>
                </button>
                <button
                  type="button"
                  onClick={() => printJobReport(selectedJob)}
                  className="px-3 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-800 border border-slate-200 font-black text-xs flex items-center gap-1.5 transition cursor-pointer"
                >
                  <Printer className="w-3.5 h-3.5" />
                  <span>Print</span>
                </button>
              </div>
            </div>

            {/* Content */}
            <div className="p-6 space-y-5 flex-1 text-xs">

              {/* Status and Action Buttons */}
              <div className="p-4 bg-slate-50 rounded-2xl border border-slate-200 flex items-center justify-between">
                <div>
                  <div className="text-[10px] font-bold text-slate-400 uppercase">Current Status</div>
                  <span className={`mt-1 inline-block px-3 py-1 rounded-full text-xs font-black ${
                    selectedJob.status === 'COMPLETED' ? 'bg-emerald-100 text-emerald-800' :
                    selectedJob.status === 'IN_PROGRESS' ? 'bg-amber-100 text-amber-800' :
                    selectedJob.status === 'POSTPONED' ? 'bg-indigo-100 text-indigo-800' :
                    'bg-slate-200 text-slate-800'
                  }`}>
                    {selectedJob.status}
                  </span>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  {!isTechnicianMode && (
                    <button
                      type="button"
                      onClick={() => setEditingJob(selectedJob)}
                      className="px-3 py-1.5 bg-amber-500 hover:bg-amber-600 text-white font-bold rounded-xl shadow-xs flex items-center gap-1 transition cursor-pointer"
                    >
                      <Edit className="w-3.5 h-3.5" /> Edit Details
                    </button>
                  )}

                  {selectedJob.status !== 'COMPLETED' && (
                    <>
                      <button
                        onClick={() => setShowCompleteModal(true)}
                        className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl shadow-xs flex items-center gap-1 cursor-pointer"
                      >
                        <Check className="w-3.5 h-3.5" /> Complete Job
                      </button>
                      <button
                        onClick={() => setShowPostponeModal(true)}
                        className="px-3 py-1.5 bg-slate-200 hover:bg-slate-300 text-slate-800 font-bold rounded-xl cursor-pointer"
                      >
                        Postpone
                      </button>
                    </>
                  )}
                </div>
              </div>

              {/* Service Details Card */}
              <div className="grid grid-cols-2 gap-4 p-4 bg-white rounded-2xl border border-slate-200">
                <div>
                  <span className="text-slate-400 text-[10px] uppercase font-bold">Treatment</span>
                  <div className="font-bold text-slate-900 text-sm mt-0.5">{selectedJob.treatment_code}</div>
                </div>
                <div>
                  <span className="text-slate-400 text-[10px] uppercase font-bold">Scheduled Time</span>
                  <div className="font-bold text-slate-900 text-sm mt-0.5">{selectedJob.scheduled_date} at {selectedJob.scheduled_time || '09:00'}</div>
                </div>
                <div>
                  <span className="text-slate-400 text-[10px] uppercase font-bold">Technician</span>
                  <div className="font-bold text-slate-900 mt-0.5">{selectedJob.technician_name || 'Unassigned'}</div>
                </div>
                <div>
                  <span className="text-slate-400 text-[10px] uppercase font-bold">Location</span>
                  <div className="font-bold text-slate-900 mt-0.5">{selectedJob.location_name || 'Main Location'}</div>
                </div>
              </div>

              {/* Quick Assign / Reassign Technician Control */}
              {!isTechnicianMode && (
                <div className="p-4 bg-gradient-to-r from-emerald-50 to-teal-50 border border-emerald-200 rounded-2xl flex flex-wrap items-center justify-between gap-3 shadow-2xs">
                  <div>
                    <span className="text-[10px] font-black text-emerald-800 uppercase tracking-wider block">Lead Technician Assignment</span>
                    <span className="text-xs text-slate-600 font-medium">Assign or change the field technician for this job</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <select
                      value={selectedJob.technician_id || ''}
                      onChange={async (e) => {
                        const newTechId = e.target.value;
                        try {
                          await assignJob(selectedJob.id, newTechId || null);
                          loadJobDetails(selectedJob.id);
                          loadJobs();
                        } catch (err) {
                          alert('Error assigning technician: ' + err.message);
                        }
                      }}
                      className="text-xs bg-white border border-emerald-300 rounded-xl px-3 py-2 font-bold text-slate-800 focus:outline-hidden focus:ring-2 focus:ring-emerald-500 shadow-2xs"
                    >
                      <option value="">-- Unassigned --</option>
                      {staff.filter(s => s.role === 'TECHNICIAN').map(s => (
                        <option key={s.id} value={s.id}>{s.full_name}</option>
                      ))}
                    </select>
                  </div>
                </div>
              )}

              {/* Field Crew & Accompanying Labourers Allocation Card */}
              {(() => {
                let workers = [];
                try {
                  if (selectedJob.workers_info) {
                    workers = typeof selectedJob.workers_info === 'string'
                      ? JSON.parse(selectedJob.workers_info)
                      : selectedJob.workers_info;
                  }
                } catch (e) {}

                const crewSize = selectedJob.crew_count || (1 + workers.length);

                return (
                  <div className="p-4 bg-gradient-to-br from-indigo-50/60 to-blue-50/60 rounded-2xl border border-indigo-100 shadow-2xs space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <div className="w-7 h-7 rounded-lg bg-indigo-600 text-white flex items-center justify-center font-black text-xs shadow-xs">
                          <HardHat className="w-4 h-4" />
                        </div>
                        <div>
                          <h4 className="text-xs font-black text-slate-900 uppercase tracking-wider">Field Crew Allocation</h4>
                          <p className="text-[11px] text-slate-500">Technician & deployed team members</p>
                        </div>
                      </div>
                      <span className="px-2.5 py-1 bg-white border border-indigo-200 rounded-full text-[11px] font-bold text-indigo-700 shadow-2xs flex items-center gap-1">
                        <Users className="w-3.5 h-3.5 text-indigo-600" />
                        {crewSize} {crewSize === 1 ? 'Person (Solo)' : 'People Total'}
                      </span>
                    </div>

                    <div className="bg-white/90 rounded-xl p-3 border border-indigo-100/80 space-y-2">
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-slate-500 font-semibold">Lead Technician:</span>
                        <span className="font-bold text-slate-900 flex items-center gap-1.5">
                          <User className="w-3.5 h-3.5 text-emerald-600" />
                          {selectedJob.technician_name || 'Unassigned'}
                        </span>
                      </div>

                      {workers && workers.length > 0 ? (
                        <div className="pt-2 border-t border-indigo-50 space-y-2">
                          <span className="text-[10px] font-bold text-indigo-700 uppercase tracking-wider block">
                            Accompanying Labourers / Helpers ({workers.length})
                          </span>
                          <div className="space-y-1.5">
                            {workers.map((w, idx) => (
                              <div key={idx} className="flex items-center justify-between p-2 rounded-lg bg-slate-50 border border-slate-200/70 text-xs">
                                <div className="flex items-center gap-2">
                                  <div className="w-5 h-5 rounded-full bg-indigo-100 text-indigo-700 flex items-center justify-center text-[10px] font-black">
                                    {idx + 1}
                                  </div>
                                  <span className="font-bold text-slate-800">{w.name || `Labourer #${idx + 1}`}</span>
                                </div>
                                {w.phone && (
                                  <a
                                    href={`tel:${w.phone}`}
                                    className="font-mono text-emerald-700 hover:text-emerald-800 text-[11px] font-bold flex items-center gap-1 bg-white px-2 py-0.5 rounded border border-emerald-100"
                                  >
                                    <Phone className="w-3 h-3 text-emerald-600" /> {w.phone}
                                  </a>
                                )}
                              </div>
                            ))}
                          </div>
                        </div>
                      ) : (
                        <div className="text-[11px] text-slate-400 italic pt-1">
                          No additional accompanying labourers registered (Solo dispatch or unassigned helpers).
                        </div>
                      )}
                    </div>
                  </div>
                );
              })()}

              {/* Technician Mobile Dispatch & Permanent Job Start Link */}
              {(() => {
                const jobStartUrl = typeof window !== 'undefined' ? `${window.location.origin}/tech?job=${selectedJob.id}` : `/tech?job=${selectedJob.id}`;
                const techPhone = selectedJob.technician_phone || '';
                const techName = selectedJob.technician_name || 'Assigned Technician';
                const cleanPhone = techPhone.replace(/\D/g, '');
                const intlPhone = cleanPhone.startsWith('0') ? '94' + cleanPhone.substring(1) : cleanPhone.startsWith('94') ? cleanPhone : '94' + cleanPhone;

                const smsText = `PestControl: Hello ${techName}, Job #${selectedJob.job_code} assigned for ${selectedJob.customer_name} on ${selectedJob.scheduled_date} at ${selectedJob.scheduled_time || '09:00'}. Click here to open your mobile panel & start work: ${jobStartUrl}`;
                const encodedSms = encodeURIComponent(smsText);

                const handleCopy = (e) => {
                  e.preventDefault();
                  navigator.clipboard.writeText(jobStartUrl);
                  setDrawerCopied(true);
                  setTimeout(() => setDrawerCopied(false), 2500);
                };

                const handleSendSms = async (e) => {
                  e.preventDefault();
                  if (!techPhone) {
                    alert('No phone number registered for this technician.');
                    return;
                  }
                  setDrawerSmsSending(true);
                  setDrawerSmsFeedback(null);
                  try {
                    const res = await sendTechDispatchSms({
                      job_id: selectedJob.id,
                      technician_phone: techPhone,
                      technician_name: techName,
                      custom_base_url: window.location.origin
                    });
                    setDrawerSmsFeedback({ type: 'success', msg: res.message || 'SMS dispatched successfully!' });
                  } catch (err) {
                    setDrawerSmsFeedback({ type: 'error', msg: `Failed: ${err.message}` });
                  } finally {
                    setDrawerSmsSending(false);
                  }
                };

                return (
                  <div className="p-4 bg-gradient-to-br from-emerald-50/70 via-teal-50/50 to-indigo-50/70 rounded-2xl border border-emerald-200/80 shadow-2xs space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <div className="w-8 h-8 rounded-xl bg-gradient-to-tr from-emerald-600 to-teal-500 text-white flex items-center justify-center font-black shadow-xs">
                          <Smartphone className="w-4 h-4" />
                        </div>
                        <div>
                          <h4 className="text-xs font-black text-slate-900 uppercase tracking-wider flex items-center gap-1.5">
                            <span>Tech Job Start Link (SMS / WhatsApp)</span>
                            <span className="px-1.5 py-0.2 bg-emerald-100 text-emerald-800 rounded font-mono text-[9px] font-bold">Unexpiring</span>
                          </h4>
                          <p className="text-[11px] text-slate-500">1-tap auto open technician work panel</p>
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 bg-white p-2 rounded-xl border border-emerald-200">
                      <input
                        type="text"
                        readOnly
                        value={jobStartUrl}
                        className="flex-1 bg-transparent text-xs font-mono text-emerald-800 font-semibold focus:outline-hidden select-all truncate"
                      />
                      <button
                        type="button"
                        onClick={handleCopy}
                        className="px-2.5 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-800 rounded-lg font-bold text-xs flex items-center gap-1 transition shrink-0 cursor-pointer"
                      >
                        {drawerCopied ? (
                          <>
                            <Check className="w-3.5 h-3.5 text-emerald-600" />
                            <span className="text-emerald-700">Copied!</span>
                          </>
                        ) : (
                          <>
                            <Copy className="w-3.5 h-3.5 text-slate-600" />
                            <span>Copy</span>
                          </>
                        )}
                      </button>
                      <a
                        href={jobStartUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="p-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg shrink-0 cursor-pointer"
                        title="Open Mobile Tech View"
                      >
                        <ExternalLink className="w-3.5 h-3.5" />
                      </a>
                    </div>

                    {drawerSmsFeedback && (
                      <div className={`p-2 rounded-xl text-xs flex items-center gap-2 ${
                        drawerSmsFeedback.type === 'success' ? 'bg-emerald-100 text-emerald-900 border border-emerald-200' : 'bg-rose-100 text-rose-900 border border-rose-200'
                      }`}>
                        {drawerSmsFeedback.type === 'success' ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" /> : <AlertTriangle className="w-3.5 h-3.5 text-rose-600 shrink-0" />}
                        <span className="text-[11px]">{drawerSmsFeedback.msg}</span>
                      </div>
                    )}

                    <div className="grid grid-cols-3 gap-1.5">
                      <button
                        type="button"
                        disabled={drawerSmsSending || !techPhone}
                        onClick={handleSendSms}
                        className="py-2 px-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-bold rounded-xl text-[11px] flex items-center justify-center gap-1 shadow-xs transition cursor-pointer"
                      >
                        <Send className="w-3 h-3" />
                        <span>{drawerSmsSending ? 'Sending...' : 'SMS Gateway'}</span>
                      </button>

                      <a
                        href={techPhone ? `sms:${techPhone}?body=${encodedSms}` : '#'}
                        onClick={(e) => {
                          if (!techPhone) {
                            e.preventDefault();
                            alert('No technician phone registered.');
                          }
                        }}
                        className={`py-2 px-2 bg-white hover:bg-slate-50 border border-slate-300 text-slate-800 font-bold rounded-xl text-[11px] flex items-center justify-center gap-1 shadow-2xs transition ${!techPhone ? 'opacity-50 pointer-events-none' : ''}`}
                      >
                        <Smartphone className="w-3 h-3 text-slate-600" />
                        <span>Phone SMS</span>
                      </a>

                      <a
                        href={techPhone ? `https://wa.me/${intlPhone}?text=${encodedSms}` : '#'}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={(e) => {
                          if (!techPhone) {
                            e.preventDefault();
                            alert('No technician phone registered.');
                          }
                        }}
                        className={`py-2 px-2 bg-teal-600 hover:bg-teal-700 text-white font-bold rounded-xl text-[11px] flex items-center justify-center gap-1 shadow-xs transition ${!techPhone ? 'opacity-50 pointer-events-none' : ''}`}
                      >
                        <MessageSquare className="w-3 h-3" />
                        <span>WhatsApp</span>
                      </a>
                    </div>
                  </div>
                );
              })()}

              {/* Fleet Transport, Machinery & Assigned Personnel Card */}
              <div className="p-4 bg-gradient-to-br from-blue-50/70 via-indigo-50/50 to-slate-50 rounded-2xl border border-blue-200/80 shadow-2xs space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 rounded-xl bg-blue-600 text-white flex items-center justify-center font-black shadow-xs">
                      <Truck className="w-4 h-4" />
                    </div>
                    <div>
                      <h4 className="text-xs font-black text-slate-900 uppercase tracking-wider">Fleet & Equipment Assignment</h4>
                      <p className="text-[11px] text-slate-500">Transport vehicle, machinery and team persons</p>
                    </div>
                  </div>
                  {!isTechnicianMode && (
                    <button
                      type="button"
                      onClick={() => setEditingJob(selectedJob)}
                      className="px-2.5 py-1 bg-white hover:bg-blue-50 text-blue-700 font-bold rounded-lg text-[11px] border border-blue-200 shadow-2xs transition flex items-center gap-1 cursor-pointer"
                    >
                      <Edit className="w-3 h-3 text-blue-600" /> Edit / Change
                    </button>
                  )}
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                  <div className="p-2.5 bg-white rounded-xl border border-slate-200 space-y-0.5">
                    <span className="text-[10px] font-bold text-slate-400 uppercase flex items-center gap-1">
                      <Truck className="w-3 h-3 text-blue-600" /> Assigned Vehicle
                    </span>
                    <div className="font-bold text-slate-900">
                      {selectedJob.vehicle_no || selectedJob.vehicle_number ? (
                        <span className="text-blue-900 flex items-center gap-1">
                          <span>🚗 {selectedJob.vehicle_no || selectedJob.vehicle_number}</span>
                          {selectedJob.vehicle_type && <span className="text-[10px] text-blue-600 font-normal">({selectedJob.vehicle_type})</span>}
                        </span>
                      ) : (
                        <span className="text-slate-400 font-normal italic">None Assigned</span>
                      )}
                    </div>
                  </div>

                  <div className="p-2.5 bg-white rounded-xl border border-slate-200 space-y-0.5">
                    <span className="text-[10px] font-bold text-slate-400 uppercase flex items-center gap-1">
                      <Wrench className="w-3 h-3 text-purple-600" /> Assigned Machine / Fogger
                    </span>
                    <div className="font-bold text-slate-900">
                      {selectedJob.machine_name || selectedJob.machine_type ? (
                        <span className="text-purple-900 flex items-center gap-1">
                          <span>⚙️ {selectedJob.machine_name || selectedJob.machine_type}</span>
                        </span>
                      ) : (
                        <span className="text-slate-400 font-normal italic">Standard Sprayer / None</span>
                      )}
                    </div>
                  </div>
                </div>

                {selectedJob.team_members && (
                  <div className="p-2.5 bg-white rounded-xl border border-slate-200 space-y-0.5 text-xs">
                    <span className="text-[10px] font-bold text-slate-400 uppercase flex items-center gap-1">
                      <Users className="w-3 h-3 text-indigo-600" /> Team Person Names
                    </span>
                    <div className="font-bold text-slate-800">
                      👥 {selectedJob.team_members}
                    </div>
                  </div>
                )}
              </div>

              {/* Customer Contact & Call */}
              {selectedJob.customer_phone && (
                <div className="p-4 bg-emerald-50/50 rounded-2xl border border-emerald-100 flex items-center justify-between">
                  <div>
                    <div className="font-bold text-slate-900">{selectedJob.contact_person || selectedJob.customer_name}</div>
                    <div className="text-emerald-700 font-mono mt-0.5">{selectedJob.customer_phone}</div>
                  </div>
                  <a
                    href={`tel:${selectedJob.customer_phone}`}
                    className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl flex items-center gap-1.5"
                  >
                    <Phone className="w-3.5 h-3.5" /> Call Client
                  </a>
                </div>
              )}

              {/* Customer Signature if completed */}
              {selectedJob.customer_signature && (
                <div className="p-4 bg-slate-50 rounded-2xl border border-slate-200 space-y-2">
                  <span className="text-slate-400 text-[10px] uppercase font-bold flex items-center gap-1">
                    <PenTool className="w-3.5 h-3.5 text-emerald-600" /> Customer Signature
                  </span>
                  <div className="border border-slate-200 bg-white p-2 rounded-xl">
                    <img src={selectedJob.customer_signature} alt="Signature" className="max-h-24 mx-auto" />
                  </div>
                </div>
              )}

              {/* Job Photos if completed */}
              {((jobDetails?.photos && jobDetails.photos.length > 0) || (selectedJob.photos && selectedJob.photos.length > 0) || selectedJob.photo_url) && (
                <div className="p-4 bg-slate-50 rounded-2xl border border-slate-200 space-y-2">
                  <span className="text-slate-400 text-[10px] uppercase font-bold flex items-center gap-1">
                    <Camera className="w-3.5 h-3.5 text-emerald-600" /> Completion Job Photos
                  </span>
                  <div className="grid grid-cols-2 gap-2">
                    {(jobDetails?.photos && jobDetails.photos.length > 0 ? jobDetails.photos : (selectedJob.photos && selectedJob.photos.length > 0 ? selectedJob.photos : [{ photo_url: selectedJob.photo_url }])).map((p, idx) => {
                      const url = typeof p === 'string' ? p : (p?.photo_url || p?.url);
                      if (!url) return null;
                      return (
                        <div key={idx} className="relative group rounded-xl overflow-hidden border border-slate-200 bg-white shadow-2xs">
                          <img
                            src={url}
                            alt={`Job Completion ${idx + 1}`}
                            className="w-full h-36 object-cover cursor-pointer hover:scale-105 transition duration-200"
                            onClick={() => window.open(url, '_blank')}
                          />
                          <a
                            href={url}
                            target="_blank"
                            rel="noreferrer"
                            className="absolute bottom-1.5 right-1.5 bg-black/60 hover:bg-black text-white text-[10px] font-bold px-2 py-0.5 rounded-md flex items-center gap-1 backdrop-blur-xs"
                          >
                            <ExternalLink className="w-2.5 h-2.5" /> View
                          </a>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Technician Notes */}
              {selectedJob.technician_notes && (
                <div className="p-4 bg-slate-50 rounded-2xl border border-slate-200">
                  <span className="text-slate-400 text-[10px] uppercase font-bold">Technician Notes</span>
                  <p className="mt-1 text-slate-700 italic font-medium">{selectedJob.technician_notes}</p>
                </div>
              )}

              {/* Audit Logs */}
              <div>
                <span className="text-slate-400 text-[10px] uppercase font-bold tracking-wider">Audit Trail</span>
                <div className="mt-2 space-y-1.5">
                  {jobDetails?.logs?.map(log => (
                    <div key={log.id} className="p-2.5 bg-slate-50 rounded-xl text-[11px] flex items-center justify-between">
                      <div>
                        <span className="font-bold text-slate-900">{log.action}</span>
                        {log.notes && <span className="text-slate-500 ml-1.5">- {log.notes}</span>}
                      </div>
                      <span className="text-slate-400 font-mono text-[9px]">{new Date(log.timestamp).toLocaleTimeString()}</span>
                    </div>
                  ))}
                </div>
              </div>

            </div>
          </div>
        </div>
      )}

      {/* Complete Job Modal (with Touch Signature Pad) */}
      {showCompleteModal && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-xs z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 max-w-lg w-full p-6 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
                <CheckCircle2 className="w-5 h-5 text-emerald-600" />
                <span>Job Completion & Customer Sign-off</span>
              </h2>
              <button onClick={() => setShowCompleteModal(false)} className="text-slate-400 hover:text-slate-700">
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleCompleteSubmit} className="space-y-3 text-xs">
              <div>
                <label className="font-semibold text-slate-700">Service Notes / Findings</label>
                <textarea
                  rows={3}
                  value={completionNotes}
                  onChange={(e) => setCompletionNotes(e.target.value)}
                  placeholder="e.g. Completed GPC spraying. Bait stations inspected and replenished."
                  className="w-full mt-1 p-2 bg-slate-50 rounded-xl border border-slate-200 focus:outline-hidden"
                />
              </div>

              {/* Photo attachment (Optional - Not Required) */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="font-semibold text-slate-700 flex items-center gap-1.5">
                    <Camera className="w-4 h-4 text-emerald-600" />
                    <span>Job Photo</span>
                    <span className="text-[10px] text-slate-400 font-normal">(Optional - Not Required)</span>
                  </label>
                  {photoUrl && (
                    <button
                      type="button"
                      onClick={() => setPhotoUrl('')}
                      className="text-[11px] text-rose-600 font-bold hover:underline"
                    >
                      Remove Photo
                    </button>
                  )}
                </div>

                {photoUrl ? (
                  <div className="relative rounded-xl overflow-hidden border border-emerald-200 bg-slate-50 p-1.5">
                    <img src={photoUrl} alt="Job completion" className="max-h-32 w-full object-cover rounded-lg" />
                  </div>
                ) : (
                  <div>
                    <input
                      type="file"
                      accept="image/*"
                      capture="environment"
                      id="jobs-camera-input"
                      className="hidden"
                      onChange={handlePhotoCapture}
                    />
                    <label
                      htmlFor="jobs-camera-input"
                      className="flex items-center justify-center gap-2 py-2.5 px-3 bg-slate-50 hover:bg-emerald-50 text-slate-700 hover:text-emerald-800 font-bold rounded-xl border-2 border-dashed border-slate-200 hover:border-emerald-300 transition cursor-pointer text-xs"
                    >
                      <Camera className="w-4 h-4 text-emerald-600" />
                      <span>Take Photo with Camera (Optional)</span>
                    </label>
                  </div>
                )}
              </div>

              {/* Customer Signature Section */}
              <div className="pt-2">
                <div className="flex items-center justify-between mb-1">
                  <label className="font-semibold text-slate-700 flex items-center gap-1.5">
                    <PenTool className="w-4 h-4 text-emerald-600" /> Customer Signature
                  </label>
                  {!showSignaturePad && (
                    <button
                      type="button"
                      onClick={() => setShowSignaturePad(true)}
                      className="text-xs font-bold text-emerald-600 hover:underline"
                    >
                      {customerSignature ? 'Re-sign' : 'Open Signature Pad'}
                    </button>
                  )}
                </div>

                {customerSignature ? (
                  <div className="border border-slate-200 rounded-xl p-2 bg-slate-50">
                    <img src={customerSignature} alt="Captured signature" className="max-h-20 mx-auto" />
                  </div>
                ) : (
                  <div className="text-[11px] text-slate-400 italic">Signature not yet recorded.</div>
                )}

                {showSignaturePad && (
                  <div className="mt-2">
                    <SignaturePad
                      onSave={(dataUrl) => {
                        setCustomerSignature(dataUrl);
                        setShowSignaturePad(false);
                      }}
                      onCancel={() => setShowSignaturePad(false)}
                    />
                  </div>
                )}
              </div>

              <div className="flex justify-end gap-2 pt-4 border-t border-slate-100">
                <button type="button" onClick={() => setShowCompleteModal(false)} className="px-4 py-2 text-slate-600 font-semibold">Cancel</button>
                <button type="submit" className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl shadow-xs">
                  Save & Complete Job
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Postpone Modal */}
      {showPostponeModal && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-xs z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 max-w-md w-full p-6 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
                <Clock className="w-5 h-5 text-indigo-600" />
                <span>Postpone Service Job</span>
              </h2>
              <button onClick={() => setShowPostponeModal(false)} className="text-slate-400 hover:text-slate-700">
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handlePostponeSubmit} className="space-y-3 text-xs">
              <div>
                <label className="font-semibold text-slate-700">Reschedule to Date *</label>
                <input
                  type="date"
                  required
                  value={postponeDate}
                  onChange={(e) => setPostponeDate(e.target.value)}
                  className="w-full mt-1 p-2 bg-slate-50 rounded-xl border border-slate-200 focus:outline-hidden"
                />
              </div>

              <div>
                <label className="font-semibold text-slate-700">Reason for Postponement</label>
                <textarea
                  rows={2}
                  value={postponeReason}
                  onChange={(e) => setPostponeReason(e.target.value)}
                  placeholder="e.g. Client requested postponement due to factory maintenance"
                  className="w-full mt-1 p-2 bg-slate-50 rounded-xl border border-slate-200 focus:outline-hidden"
                />
              </div>

              <div className="flex justify-end gap-2 pt-3">
                <button type="button" onClick={() => setShowPostponeModal(false)} className="px-4 py-2 text-slate-600 font-semibold">Cancel</button>
                <button type="submit" className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-xl shadow-xs">
                  Confirm Postponement
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Create Manual Job Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-xs z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl shadow-2xl border border-slate-200 max-w-lg w-full p-6 space-y-4 max-h-[92vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div>
                <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
                  <Briefcase className="w-5 h-5 text-emerald-600" />
                  <span>Create Ad-hoc Service Job</span>
                </h2>
                <p className="text-[11px] text-slate-500 mt-0.5">
                  Schedule an on-demand or emergency service job for a customer.
                </p>
              </div>
              <button
                type="button"
                onClick={() => { setShowCreateModal(false); resetNewJobForm(); }}
                className="text-slate-400 hover:text-slate-700 p-1.5 rounded-xl hover:bg-slate-100 transition"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleCreateJob} className="space-y-3.5 text-xs">
              {/* Customer Selector with Search */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label className="font-bold text-slate-700 flex items-center gap-1.5">
                    <User className="w-3.5 h-3.5 text-emerald-600" />
                    <span>Select Customer *</span>
                  </label>
                  <div className="flex items-center gap-2 text-[11px] text-slate-400">
                    {loadingCustomers ? (
                      <span className="flex items-center gap-1 text-emerald-600 font-semibold animate-pulse">
                        <RefreshCw className="w-3 h-3 animate-spin" /> Loading ({customers.length})...
                      </span>
                    ) : (
                      <button
                        type="button"
                        onClick={loadAllCustomers}
                        className="flex items-center gap-1 text-emerald-700 hover:text-emerald-900 font-semibold cursor-pointer"
                        title="Reload customers list"
                      >
                        <RefreshCw className="w-3 h-3" />
                        <span>{customers.length} Customers</span>
                      </button>
                    )}
                  </div>
                </div>

                {/* Filter input */}
                <div className="relative">
                  <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-2.5" />
                  <input
                    type="text"
                    placeholder="Type name, code (e.g. CUST-001) or phone to filter..."
                    value={customerSearchQuery}
                    onChange={(e) => setCustomerSearchQuery(e.target.value)}
                    className="w-full pl-8 pr-8 py-1.5 bg-slate-50 border border-slate-200 rounded-xl text-xs placeholder:text-slate-400 focus:outline-hidden focus:border-emerald-500 focus:bg-white transition"
                  />
                  {customerSearchQuery && (
                    <button
                      type="button"
                      onClick={() => setCustomerSearchQuery('')}
                      className="absolute right-2.5 top-2 text-slate-400 hover:text-slate-600"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>

                {/* Customer Dropdown */}
                <select
                  required
                  value={newJobForm.customer_id}
                  onChange={(e) => handleSelectCustomerForNewJob(e.target.value)}
                  className="w-full p-2.5 bg-slate-50 rounded-xl border border-slate-200 focus:outline-hidden focus:border-emerald-500 focus:bg-white font-medium"
                >
                  <option value="">-- Choose a Customer ({filteredCustomers.length} available) --</option>
                  {filteredCustomers.map(c => (
                    <option key={c.id} value={c.id}>
                      {c.name} ({c.customer_code}){c.phone ? ` - ${c.phone}` : ''}{c.location ? ` - ${c.location}` : ''}
                    </option>
                  ))}
                </select>

                {/* Selected Customer Card Preview */}
                {selectedCustomerObj && (
                  <div className="p-2.5 bg-emerald-50/70 border border-emerald-200 rounded-xl flex items-center justify-between text-[11px] text-emerald-900">
                    <div className="space-y-0.5">
                      <div className="font-bold flex items-center gap-1.5">
                        <CheckCircle className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                        <span>{selectedCustomerObj.name}</span>
                        <span className="font-mono text-[10px] bg-emerald-100 text-emerald-800 px-1.5 py-0.2 rounded font-semibold">{selectedCustomerObj.customer_code}</span>
                      </div>
                      <div className="text-slate-600 flex items-center gap-3 text-[10px]">
                        {selectedCustomerObj.phone && <span>📞 {selectedCustomerObj.phone}</span>}
                        {selectedCustomerObj.location && <span>📍 {selectedCustomerObj.location}</span>}
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* Location / Site Selector */}
              {newJobForm.customer_id && (
                <div>
                  <label className="font-semibold text-slate-700 flex items-center gap-1.5">
                    <Building className="w-3.5 h-3.5 text-indigo-600" />
                    <span>Service Location / Site</span>
                    {loadingLocations && <span className="text-[10px] text-indigo-600 animate-pulse font-normal">Loading sites...</span>}
                  </label>
                  <select
                    value={newJobForm.location_id}
                    onChange={(e) => setNewJobForm({ ...newJobForm, location_id: e.target.value })}
                    className="w-full mt-1 p-2 bg-slate-50 rounded-xl border border-slate-200 focus:outline-hidden focus:border-indigo-500 font-medium"
                  >
                    {customerLocations.length === 0 ? (
                      <option value="">Default Customer Address ({selectedCustomerObj?.address || selectedCustomerObj?.location || 'Primary Site'})</option>
                    ) : (
                      <>
                        <option value="">-- Select Specific Site/Branch (or Primary) --</option>
                        {customerLocations.map(loc => (
                          <option key={loc.id} value={loc.id}>
                            {loc.location_name}{loc.address ? ` (${loc.address})` : ''} {loc.is_primary ? '★ Primary' : ''}
                          </option>
                        ))}
                      </>
                    )}
                  </select>
                </div>
              )}

              {/* Treatment and Technician */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="font-semibold text-slate-700">Treatment *</label>
                  <select
                    required
                    value={newJobForm.treatment_id}
                    onChange={(e) => handleSelectTreatmentForNewJob(e.target.value)}
                    className="w-full mt-1 p-2 bg-slate-50 rounded-xl border border-slate-200 focus:outline-hidden focus:border-emerald-500"
                  >
                    <option value="">Select Treatment</option>
                    {treatments.map(t => (
                      <option key={t.id} value={t.id}>{t.code} - {t.name} ({t.default_duration_minutes || 60}m)</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="font-semibold text-slate-700">Assign Technician</label>
                  <select
                    value={newJobForm.technician_id}
                    onChange={(e) => setNewJobForm({ ...newJobForm, technician_id: e.target.value })}
                    className="w-full mt-1 p-2 bg-slate-50 rounded-xl border border-slate-200 focus:outline-hidden focus:border-emerald-500"
                  >
                    <option value="">Unassigned</option>
                    {staff.filter(s => s.role === 'TECHNICIAN').map(s => (
                      <option key={s.id} value={s.id}>{s.full_name}{s.phone ? ` (${s.phone})` : ''}</option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Scheduled Date & Quick Select */}
              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <label className="font-semibold text-slate-700">Scheduled Date *</label>
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => setNewJobForm({ ...newJobForm, scheduled_date: colomboToday })}
                      className={`px-2 py-0.5 rounded-lg text-[10px] font-bold border transition cursor-pointer ${
                        newJobForm.scheduled_date === colomboToday
                          ? 'bg-orange-500 text-white border-orange-600'
                          : 'bg-slate-100 text-slate-600 border-slate-200 hover:bg-orange-50 hover:text-orange-700'
                      }`}
                    >
                      Today ({colomboToday})
                    </button>
                    <button
                      type="button"
                      onClick={() => setNewJobForm({ ...newJobForm, scheduled_date: colomboTomorrow })}
                      className={`px-2 py-0.5 rounded-lg text-[10px] font-bold border transition cursor-pointer ${
                        newJobForm.scheduled_date === colomboTomorrow
                          ? 'bg-purple-600 text-white border-purple-700'
                          : 'bg-slate-100 text-slate-600 border-slate-200 hover:bg-purple-50 hover:text-purple-700'
                      }`}
                    >
                      Tomorrow
                    </button>
                  </div>
                </div>
                <input
                  type="date"
                  required
                  value={newJobForm.scheduled_date}
                  onChange={(e) => setNewJobForm({ ...newJobForm, scheduled_date: e.target.value })}
                  className="w-full p-2 bg-slate-50 rounded-xl border border-slate-200 focus:outline-hidden focus:border-emerald-500"
                />
              </div>

              {/* Time, Duration & Crew Size */}
              <div className="grid grid-cols-3 gap-2.5">
                <div>
                  <label className="font-semibold text-slate-700">Scheduled Time</label>
                  <input
                    type="time"
                    value={newJobForm.scheduled_time}
                    onChange={(e) => setNewJobForm({ ...newJobForm, scheduled_time: e.target.value })}
                    className="w-full mt-1 p-2 bg-slate-50 rounded-xl border border-slate-200 focus:outline-hidden"
                  />
                </div>

                <div>
                  <label className="font-semibold text-slate-700">Duration (mins)</label>
                  <input
                    type="number"
                    min="15"
                    step="15"
                    value={newJobForm.duration_minutes}
                    onChange={(e) => setNewJobForm({ ...newJobForm, duration_minutes: parseInt(e.target.value) || 60 })}
                    className="w-full mt-1 p-2 bg-slate-50 rounded-xl border border-slate-200 focus:outline-hidden"
                  />
                </div>

                <div>
                  <label className="font-semibold text-slate-700 flex items-center gap-1">
                    <Users className="w-3.5 h-3.5 text-emerald-600" />
                    <span>Crew Size</span>
                  </label>
                  <input
                    type="number"
                    min="1"
                    max="20"
                    value={newJobForm.crew_count}
                    onChange={(e) => setNewJobForm({ ...newJobForm, crew_count: parseInt(e.target.value) || 1 })}
                    className="w-full mt-1 p-2 bg-slate-50 rounded-xl border border-slate-200 focus:outline-hidden"
                    placeholder="1"
                  />
                </div>
              </div>

              {/* Vehicle & Machine Selection with Live Availability */}
              <div className="p-3 bg-gradient-to-br from-blue-50/70 to-indigo-50/50 rounded-2xl border border-blue-200/80 space-y-3">
                <div className="flex items-center justify-between text-[11px] font-bold text-blue-950 uppercase tracking-wider">
                  <span className="flex items-center gap-1.5">
                    <Truck className="w-3.5 h-3.5 text-blue-600" />
                    <span>Vehicle, Machine & Team Assignment</span>
                  </span>
                  {loadingCreateFleet && (
                    <span className="text-[10px] text-blue-600 font-normal animate-pulse">Checking Fleet...</span>
                  )}
                </div>

                {/* Vehicle Selection */}
                <div className="space-y-1">
                  <div className="flex items-center justify-between">
                    <label className="font-semibold text-slate-700 text-xs">Vehicle / Transport</label>
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <button
                        type="button"
                        onClick={() => setIsCustomCreateVehicle(!isCustomCreateVehicle)}
                        className="text-[10px] text-blue-700 hover:text-blue-900 underline font-semibold cursor-pointer"
                      >
                        {isCustomCreateVehicle ? "Choose from Fleet" : "+ Custom"}
                      </button>
                      <button
                        type="button"
                        onClick={handleAddNewVehicleForCreate}
                        className="text-[10px] bg-white text-blue-700 px-2 py-0.5 rounded-lg border border-blue-200 hover:bg-blue-50 font-bold shadow-2xs cursor-pointer"
                        title="Add new vehicle to fleet"
                      >
                        + Add
                      </button>
                      {newJobForm.vehicle_id && !isCustomCreateVehicle && (
                        <>
                          <button
                            type="button"
                            onClick={handleRenameVehicleForCreate}
                            className="text-[10px] bg-amber-50 text-amber-800 px-2 py-0.5 rounded-lg border border-amber-200 hover:bg-amber-100 font-bold shadow-2xs cursor-pointer"
                            title="Rename or update vehicle"
                          >
                            ✏️ Rename
                          </button>
                          <button
                            type="button"
                            onClick={handleDeleteVehicleForCreate}
                            className="text-[10px] bg-rose-50 text-rose-700 px-2 py-0.5 rounded-lg border border-rose-200 hover:bg-rose-100 font-bold shadow-2xs cursor-pointer"
                            title="Remove/delete vehicle from fleet"
                          >
                            🗑️ Remove
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                  {isCustomCreateVehicle ? (
                    <input
                      type="text"
                      placeholder="Type custom vehicle number (e.g. WP CAD-5120)"
                      value={newJobForm.vehicle_no}
                      onChange={(e) => setNewJobForm({ ...newJobForm, vehicle_no: e.target.value.toUpperCase(), vehicle_id: "" })}
                      className="w-full p-2 bg-white rounded-xl border border-blue-300 font-semibold focus:outline-hidden text-xs"
                    />
                  ) : (
                    <select
                      value={newJobForm.vehicle_id}
                      onChange={(e) => {
                        const vid = e.target.value;
                        const v = createVehiclesList.find(x => String(x.id) === String(vid));
                        setNewJobForm({ ...newJobForm, vehicle_id: vid, vehicle_no: v ? v.vehicle_number : "" });
                      }}
                      className="w-full p-2 bg-white rounded-xl border border-slate-200 focus:outline-hidden text-xs font-medium"
                    >
                      <option value="">-- No Vehicle Assigned --</option>
                      {createVehiclesList.map(v => (
                        <option key={v.id} value={v.id}>
                          {v.vehicle_number} ({v.vehicle_type || "Vehicle"}) - {v.is_available ? "✓ AVAILABLE" : ("⚠️ OCCUPIED (" + (v.conflict_job?.job_code || "Busy") + ")")}
                        </option>
                      ))}
                    </select>
                  )}
                </div>

                {/* Machine Selection */}
                <div className="space-y-1">
                  <div className="flex items-center justify-between">
                    <label className="font-semibold text-slate-700 text-xs">Machine / Fogger / Sprayer</label>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => setIsCustomCreateMachine(!isCustomCreateMachine)}
                        className="text-[10px] text-purple-700 hover:text-purple-900 underline font-semibold cursor-pointer"
                      >
                        {isCustomCreateMachine ? "Choose from List" : "+ Custom Machine"}
                      </button>
                      <button
                        type="button"
                        onClick={handleAddNewMachineForCreate}
                        className="text-[10px] bg-white text-purple-700 px-2 py-0.5 rounded-lg border border-purple-200 hover:bg-purple-50 font-bold shadow-2xs cursor-pointer"
                      >
                        + New Machine
                      </button>
                    </div>
                  </div>
                  {isCustomCreateMachine ? (
                    <input
                      type="text"
                      placeholder="Type custom machine name (e.g. TF-35 Thermal Fogger)"
                      value={newJobForm.machine_name}
                      onChange={(e) => setNewJobForm({ ...newJobForm, machine_name: e.target.value, machine_id: "" })}
                      className="w-full p-2 bg-white rounded-xl border border-purple-300 font-semibold focus:outline-hidden text-xs"
                    />
                  ) : (
                    <select
                      value={newJobForm.machine_id}
                      onChange={(e) => {
                        const mid = e.target.value;
                        const m = createMachinesList.find(x => String(x.id) === String(mid));
                        setNewJobForm({ ...newJobForm, machine_id: mid, machine_name: m ? m.machine_name : "" });
                      }}
                      className="w-full p-2 bg-white rounded-xl border border-slate-200 focus:outline-hidden text-xs font-medium"
                    >
                      <option value="">-- No Machine / Standard Sprayer --</option>
                      {createMachinesList.map(m => (
                        <option key={m.id} value={m.id}>
                          {m.machine_name} ({m.machine_type || "Machine"}) - {m.is_available ? "✓ AVAILABLE" : ("⚠️ IN USE (" + (m.conflict_job?.job_code || "Busy") + ")")}
                        </option>
                      ))}
                    </select>
                  )}
                </div>

                {/* Team Persons Name & Staff Multi-Add */}
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <label className="font-semibold text-slate-700 text-xs flex items-center gap-1">
                      <Users className="w-3.5 h-3.5 text-indigo-600" />
                      <span>Team Person Names / Deployed Crew</span>
                    </label>
                    <span className="text-[10px] text-slate-400">Custom names or click staff:</span>
                  </div>

                  {staff && staff.length > 0 && (
                    <div className="flex flex-wrap gap-1 items-center pb-0.5">
                      <span className="text-[10px] font-bold text-slate-400 uppercase mr-1">Quick Add:</span>
                      {staff.filter(s => s.role === 'TECHNICIAN' || s.role === 'STAFF').slice(0, 8).map(st => (
                        <button
                          key={st.id}
                          type="button"
                          onClick={() => {
                            const parts = newJobForm.team_members ? newJobForm.team_members.split(',').map(s => s.trim()).filter(Boolean) : [];
                            if (!parts.includes(st.full_name)) {
                              parts.push(st.full_name);
                              setNewJobForm({ ...newJobForm, team_members: parts.join(', ') });
                            }
                          }}
                          className="text-[10px] bg-indigo-50 text-indigo-700 border border-indigo-200 px-1.5 py-0.5 rounded-md font-semibold hover:bg-indigo-100 transition cursor-pointer"
                        >
                          + {st.full_name}
                        </button>
                      ))}
                    </div>
                  )}

                  <input
                    type="text"
                    value={newJobForm.team_members}
                    onChange={(e) => setNewJobForm({ ...newJobForm, team_members: e.target.value })}
                    placeholder="Type custom crew names (e.g. Kasun, Nuwan, Sunimal) or click staff above"
                    className="w-full p-2 bg-white rounded-xl border border-slate-200 focus:outline-hidden text-xs font-medium"
                  />
                </div>
              </div>

              {/* Technician Notes / Instructions */}
              <div>
                <label className="font-semibold text-slate-700">Technician Notes / Instructions</label>
                <textarea
                  rows="2"
                  value={newJobForm.notes}
                  onChange={(e) => setNewJobForm({ ...newJobForm, notes: e.target.value })}
                  placeholder="Enter specific instructions or problem report for the technician..."
                  className="w-full mt-1 p-2 bg-slate-50 rounded-xl border border-slate-200 focus:outline-hidden focus:border-emerald-500 resize-none"
                />
              </div>

              {/* SMS Dispatch Toggle Button */}
              <div className="pt-1">
                <button
                  type="button"
                  onClick={() => setCreateSendSms(!createSendSms)}
                  className={`w-full py-2 px-3 rounded-xl border text-xs font-bold flex items-center justify-between transition cursor-pointer ${
                    createSendSms
                      ? 'bg-emerald-50 text-emerald-800 border-emerald-300'
                      : 'bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <MessageSquare className="w-4 h-4 text-emerald-600" />
                    <span>Send SMS Job Link to Technician:</span>
                  </div>
                  <span className={`px-2 py-0.5 rounded text-[11px] font-black ${
                    createSendSms ? 'bg-emerald-600 text-white' : 'bg-slate-200 text-slate-700'
                  }`}>
                    {createSendSms ? 'ENABLED ✓' : 'DISABLED ✕'}
                  </span>
                </button>
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => { setShowCreateModal(false); resetNewJobForm(); }}
                  className="px-4 py-2 font-semibold text-slate-600 hover:text-slate-800 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={!newJobForm.customer_id || !newJobForm.treatment_id || !newJobForm.scheduled_date}
                  className="px-5 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-bold rounded-xl shadow-xs transition cursor-pointer"
                >
                  Create Job
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Tomorrow Job Lock Pop-Up Notice Modal */}
      {tomorrowNoticeJob && (
        <div
          className="fixed inset-0 bg-slate-950/75 backdrop-blur-sm z-[130] flex items-center justify-center p-4 animate-in fade-in duration-150"
          onClick={() => setTomorrowNoticeJob(null)}
        >
          <div
            className="bg-white w-full max-w-sm rounded-3xl shadow-2xl border border-indigo-200 overflow-hidden animate-in zoom-in-95 duration-200"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="bg-gradient-to-br from-indigo-600 via-blue-700 to-slate-900 p-5 text-white text-center relative">
              <button
                type="button"
                onClick={() => setTomorrowNoticeJob(null)}
                className="absolute top-3.5 right-3.5 p-1.5 rounded-full bg-white/10 hover:bg-white/20 text-white/90 transition"
              >
                <X className="w-4 h-4" />
              </button>
              <div className="w-14 h-14 rounded-2xl bg-white/15 border border-white/25 flex items-center justify-center mx-auto mb-3 shadow-lg">
                <Lock className="w-7 h-7 text-amber-300" />
              </div>
              <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-amber-400/20 border border-amber-300/40 text-amber-200 text-[10px] font-black uppercase tracking-widest mb-1">
                Scheduled For Tomorrow
              </span>
              <h3 className="text-lg font-black tracking-tight">Cannot Start Today</h3>
              <p className="text-xs text-indigo-100 mt-1 font-medium">
                This job is only allowed to be worked on tomorrow ({getJobEffectiveDate(tomorrowNoticeJob)}).
              </p>
            </div>

            <div className="p-5 space-y-4">
              <div className="p-3.5 bg-indigo-50/70 rounded-2xl border border-indigo-100 space-y-2 text-xs">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-black uppercase text-indigo-500">Job Code</span>
                  <span className="font-mono font-black text-slate-900 bg-white px-2 py-0.5 rounded border border-indigo-100">
                    {tomorrowNoticeJob.job_code}
                  </span>
                </div>
                <div>
                  <span className="text-[10px] font-black uppercase text-indigo-500 block">Customer</span>
                  <span className="font-black text-slate-900 text-sm">{tomorrowNoticeJob.customer_name}</span>
                </div>
                <div className="flex items-center justify-between pt-1 border-t border-indigo-100/80">
                  <div>
                    <span className="text-[10px] font-bold text-slate-400 uppercase block">Scheduled Date</span>
                    <span className="font-black text-indigo-700">{getJobEffectiveDate(tomorrowNoticeJob)}</span>
                  </div>
                  <div className="text-right">
                    <span className="text-[10px] font-bold text-slate-400 uppercase block">Scheduled Time</span>
                    <span className="font-black text-slate-800">{tomorrowNoticeJob.scheduled_time || '09:00'}</span>
                  </div>
                </div>
              </div>

              <div className="p-3 bg-amber-50 border border-amber-200/80 rounded-xl flex items-start gap-2.5 text-[11px] text-amber-900 font-semibold leading-relaxed">
                <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                <span>
                  Notice: Tomorrow jobs are shown for advance planning only. You can start and complete this job tomorrow when it moves to your <strong>Today Job List</strong>.
                </span>
              </div>

              <button
                type="button"
                onClick={() => {
                  setTomorrowNoticeJob(null);
                  setDateFilter(colomboToday);
                }}
                className="w-full py-3.5 bg-gradient-to-r from-indigo-600 to-blue-600 hover:from-indigo-700 hover:to-blue-700 text-white font-black rounded-2xl text-xs uppercase tracking-wider shadow-lg shadow-indigo-600/20 active:scale-[0.98] transition cursor-pointer"
              >
                OK, Got It • View Today Job List
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit Job Details Modal */}
      <EditJobModal
        isOpen={!!editingJob}
        job={editingJob}
        onClose={() => setEditingJob(null)}
        onJobUpdated={(updated) => {
          loadJobs();
          if (selectedJob?.id === updated.id) {
            loadJobDetails(updated.id);
          }
        }}
      />

    </div>
  );
}
