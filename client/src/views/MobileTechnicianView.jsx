import React, { useState, useEffect, useMemo } from 'react';
import {
  Phone, Navigation, Play, CheckCircle2, Clock, MapPin,
  Calendar, User, AlertTriangle, ArrowLeft, PenTool,
  Check, X, RefreshCw, Smartphone, Download, Sparkles,
  HardHat, Users, LogOut, Award, Search, Lock, Briefcase,
  Truck, Wrench, Timer, Printer, Share2, CheckCircle
} from 'lucide-react';
import { getJobs, getJobById, startJob, completeJob, postponeJob, getStaff } from '../api';
import { downloadJobPdfReport, printJobReport, shareJobOnWhatsApp } from '../utils/jobExportUtils';
import SignaturePad from '../components/SignaturePad';
import {
  cacheJobs,
  getCachedJobs,
  getPersistentTechSession,
  savePersistentTechSession,
  clearPersistentTechSession,
  enqueueOfflineMutation,
  getPendingMutations
} from '../services/offlineStorage';
import { triggerSync, onSyncStatusChange } from '../services/syncEngine';
import PushNotificationBanner from '../components/PushNotificationBanner';
import TechLoginModal from '../components/TechLoginModal';
import InstallAppModal from '../components/InstallAppModal';
import { getSavedBranding, fetchServerBranding } from '../components/BrandingSettingsModal';

function getColomboTodayStr() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Colombo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(new Date());
}

function addDaysToDateStr(dateStr, days) {
  const parts = String(dateStr || '').split('-').map(Number);
  if (parts.length !== 3 || parts.some(isNaN)) return dateStr;
  const dt = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2] + days));
  return dt.toISOString().substring(0, 10);
}

function formatDateTimeDisplay(isoOrStr) {
  if (!isoOrStr) return '—';
  const d = new Date(isoOrStr);
  if (isNaN(d.getTime())) return String(isoOrStr);
  const datePart = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Colombo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(d);
  const timePart = d.toLocaleTimeString('en-US', {
    timeZone: 'Asia/Colombo',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: true
  });
  return `${datePart} • ${timePart}`;
}

function formatTimeOnlyDisplay(isoOrDate) {
  if (!isoOrDate) return '—';
  const d = isoOrDate instanceof Date ? isoOrDate : new Date(isoOrDate);
  if (isNaN(d.getTime())) return String(isoOrDate);
  return d.toLocaleTimeString('en-US', {
    timeZone: 'Asia/Colombo',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: true
  });
}

function formatElapsedHms(startIso, endMsOrIso) {
  if (!startIso) return '00:00:00';
  const startMs = new Date(startIso).getTime();
  const endMs = typeof endMsOrIso === 'number' ? endMsOrIso : new Date(endMsOrIso || Date.now()).getTime();
  if (isNaN(startMs) || isNaN(endMs)) return '00:00:00';
  const totalSec = Math.max(0, Math.floor((endMs - startMs) / 1000));
  const hrs = String(Math.floor(totalSec / 3600)).padStart(2, '0');
  const mins = String(Math.floor((totalSec % 3600) / 60)).padStart(2, '0');
  const secs = String(totalSec % 60).padStart(2, '0');
  return `${hrs}:${mins}:${secs}`;
}

function formatDurationHuman(startIso, endIso) {
  if (!startIso || !endIso) return null;
  const startMs = new Date(startIso).getTime();
  const endMs = new Date(endIso).getTime();
  if (isNaN(startMs) || isNaN(endMs) || endMs < startMs) return null;
  const totalSec = Math.max(1, Math.floor((endMs - startMs) / 1000));
  const hrs = Math.floor(totalSec / 3600);
  const mins = Math.floor((totalSec % 3600) / 60);
  const secs = totalSec % 60;
  if (hrs > 0) return `${hrs}h ${mins}m ${secs}s`;
  if (mins > 0) return `${mins}m ${secs}s`;
  return `${secs}s`;
}

export default function MobileTechnicianView({
  onSelectJob,
  activeTechnicianId,
  initialJobId,
  initialMainTab = 'today',
  onMainTabChange,
  onOpenCalendar,
  currentRole = 'TECHNICIAN',
  currentUser,
  onLogout
}) {
  const isManagerApp = currentRole === 'MANAGER' || currentUser?.role === 'MANAGER';

  const [jobs, setJobs] = useState([]);
  const [tomorrowJobs, setTomorrowJobs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [todayStr, setTodayStr] = useState(() => getColomboTodayStr());
  const tomorrowStr = useMemo(() => addDaysToDateStr(todayStr, 1), [todayStr]);

  // Real-time 1-second ticker for active IN_PROGRESS job timer & live finish clock
  const [nowTick, setNowTick] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => {
      setNowTick(Date.now());
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  const getJobEffectiveDate = (job) => {
    if (!job) return '';
    if (job.status === 'POSTPONED' && job.postponed_to_date) {
      return String(job.postponed_to_date).substring(0, 10);
    }
    return String(job.scheduled_date || '').substring(0, 10);
  };

  const isJobScheduledAfterToday = (job) => {
    const d = getJobEffectiveDate(job);
    return Boolean(d && d > todayStr);
  };

  // System Branding
  const [branding, setBranding] = useState(() => getSavedBranding());

  useEffect(() => {
    fetchServerBranding().then(b => { if (b) setBranding(b); });
    const onBranding = (e) => setBranding(e.detail || getSavedBranding());
    window.addEventListener('branding-updated', onBranding);
    return () => window.removeEventListener('branding-updated', onBranding);
  }, []);

  // Persistent Technician / Manager Session
  const [techSession, setTechSession] = useState(null);
  const [showLoginModal, setShowLoginModal] = useState(false);
  const [isOnline, setIsOnline] = useState(typeof navigator !== 'undefined' ? navigator.onLine : true);

  // Sync Engine State
  const [syncState, setSyncState] = useState({ status: 'synced', pendingCount: 0 });
  const [syncingNow, setSyncingNow] = useState(false);

  // Staff list used only to resolve technician names if needed (not shown as a dropdown list on Manager main screen)
  const [technicians, setTechnicians] = useState([]);
  const [selectedTechId, setSelectedTechId] = useState(() => {
    if (isManagerApp) return '';
    return activeTechnicianId || (typeof window !== 'undefined' ? localStorage.getItem('tech_preferred_id') || '' : '');
  });

  // Main screen navigation tab: 'today' | 'tomorrow' | 'today_completed' | 'completed_history'
  const [mainTab, setMainTab] = useState(() => {
    if (!isManagerApp && initialMainTab === 'tomorrow') return 'today';
    return initialMainTab || 'today';
  });
  const [totalCompletedJobs, setTotalCompletedJobs] = useState([]);
  const [totalDoneCount, setTotalDoneCount] = useState(0);
  const [loadingCompleted, setLoadingCompleted] = useState(false);
  const [completedSearch, setCompletedSearch] = useState('');

  useEffect(() => {
    if (!isManagerApp && mainTab === 'tomorrow') {
      setMainTab('today');
    } else if (initialMainTab && initialMainTab !== mainTab) {
      if (!isManagerApp && initialMainTab === 'tomorrow') {
        setMainTab('today');
      } else {
        setMainTab(initialMainTab);
      }
    }
  }, [initialMainTab, isManagerApp]);

  const switchMainTab = (nextTab) => {
    if (!isManagerApp && nextTab === 'tomorrow') {
      setMainTab('today');
      return;
    }
    setMainTab(nextTab);
    if (onMainTabChange && (nextTab === 'today' || nextTab === 'tomorrow')) {
      onMainTabChange(nextTab);
    }
  };

  const handleTechChange = (val) => {
    setSelectedTechId(val);
    if (!isManagerApp) {
      if (val) {
        localStorage.setItem('tech_preferred_id', val);
      } else {
        localStorage.removeItem('tech_preferred_id');
      }
    }
    loadTotalCompletedJobs(val);
  };

  useEffect(() => {
    if (isManagerApp) {
      if (selectedTechId !== '') setSelectedTechId('');
    } else if (activeTechnicianId && String(activeTechnicianId) !== String(selectedTechId)) {
      setSelectedTechId(String(activeTechnicianId));
      localStorage.setItem('tech_preferred_id', String(activeTechnicianId));
    }
  }, [activeTechnicianId, isManagerApp]);

  const handleSignOut = async () => {
    const appName = isManagerApp ? 'Manager App' : 'Technician App';
    if (window.confirm(`Are you sure you want to sign out from the ${appName}?`)) {
      await clearPersistentTechSession();
      localStorage.removeItem('auth_token');
      localStorage.removeItem('auth_user');
      localStorage.removeItem('tech_preferred_id');
      sessionStorage.removeItem('auth_token');
      sessionStorage.removeItem('auth_user');
      if (onLogout) {
        onLogout();
      } else {
        window.location.reload();
      }
    }
  };

  // Detail View State
  const [activeJob, setActiveJob] = useState(null);

  // PWA Install State
  const [deferredPrompt, setDeferredPrompt] = useState(() => (typeof window !== 'undefined' ? window.__deferredPrompt : null));
  const [isStandalone, setIsStandalone] = useState(false);
  const [showInstallModal, setShowInstallModal] = useState(false);
  const [showIosGuide, setShowIosGuide] = useState(false);

  useEffect(() => {
    const isRunningStandalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
    setIsStandalone(isRunningStandalone);

    const handleBeforeInstall = (e) => {
      e.preventDefault();
      window.__deferredPrompt = e;
      setDeferredPrompt(e);
    };

    const handlePwaInstallable = () => {
      setDeferredPrompt(window.__deferredPrompt);
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstall);
    window.addEventListener('pwa-installable', handlePwaInstallable);

    getPersistentTechSession().then(sess => {
      const activeTech = currentUser?.id ? currentUser : (sess?.technician || (sess?.id ? sess : null));
      if (activeTech?.id) {
        setTechSession(activeTech);
        if (!isManagerApp && activeTech.role !== 'MANAGER' && !selectedTechId) {
          setSelectedTechId(String(activeTech.id));
        }
      } else if (!initialJobId && currentUser?.role !== 'ADMIN' && currentUser?.role !== 'MANAGER') {
        setShowLoginModal(true);
      }
    });

    const handleOnline = () => {
      setIsOnline(true);
      triggerSync().then(() => loadTodayJobs());
    };
    const handleOffline = () => setIsOnline(false);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    getPendingMutations().then(mutations => {
      setSyncState({
        status: mutations.length === 0 ? 'synced' : 'pending',
        pendingCount: mutations.length
      });
    });

    const unsubSync = onSyncStatusChange((state) => {
      setSyncState(state);
      if (state.status === 'synced') {
        loadTodayJobs();
      }
    });

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstall);
      window.removeEventListener('pwa-installable', handlePwaInstallable);
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      unsubSync();
    };
  }, []);

  const handleInstallApp = async () => {
    const isIos = typeof window !== 'undefined' && /iphone|ipad|ipod/.test(window.navigator.userAgent.toLowerCase());
    const promptEvent = deferredPrompt || (typeof window !== 'undefined' ? window.__deferredPrompt : null);

    if (isIos) {
      setShowInstallModal(true);
      return;
    }

    if (promptEvent) {
      try {
        await promptEvent.prompt();
        const choice = await promptEvent.userChoice;
        if (choice && choice.outcome === 'accepted') {
          setIsStandalone(true);
          setDeferredPrompt(null);
          if (typeof window !== 'undefined') window.__deferredPrompt = null;
        } else {
          setShowInstallModal(true);
        }
      } catch (e) {
        console.error('Install prompt error:', e);
        setShowInstallModal(true);
      }
    } else {
      setShowInstallModal(true);
    }
  };

  // Initial Job deep-link from SMS / URL
  useEffect(() => {
    if (initialJobId) {
      setLoading(true);
      getJobById(initialJobId)
        .then(res => {
          if (res?.job) {
            const jobDate = String(res.job.postponed_to_date || res.job.scheduled_date || '').substring(0, 10);
            const currentToday = getColomboTodayStr();
            if (isManagerApp && jobDate && jobDate > currentToday) {
              setMainTab('tomorrow');
              setActiveJob(res.job);
            } else {
              setActiveJob(res.job);
            }
            if (!isManagerApp && res.job.technician_id) {
              const techIdStr = String(res.job.technician_id);
              handleTechChange(techIdStr);
              const techUser = res.job.staff || {
                id: res.job.technician_id,
                full_name: res.job.technician_name || 'Technician',
                phone: res.job.technician_phone || '',
                role: 'TECHNICIAN'
              };
              try {
                localStorage.setItem('auth_user', JSON.stringify(techUser));
                localStorage.setItem('tech_preferred_id', techIdStr);
                savePersistentTechSession(techUser);
              } catch (e) {}
            }
          }
        })
        .catch(err => {
          console.error('[Technician View] Error loading deep-linked job:', err);
        })
        .finally(() => {
          setLoading(false);
        });
    }
  }, [initialJobId, isManagerApp]);

  // Completion Form Modal (No Job Photo Panel — Start/Finish Time + Notes + Signature only)
  const [showCompleteModal, setShowCompleteModal] = useState(false);
  const [jobToComplete, setJobToComplete] = useState(null);
  const [completionNotes, setCompletionNotes] = useState('');
  const [customerSignature, setCustomerSignature] = useState(null);
  const [showSignaturePad, setShowSignaturePad] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Postpone Form Modal
  const [showPostponeModal, setShowPostponeModal] = useState(false);
  const [jobToPostpone, setJobToPostpone] = useState(null);
  const [postponeDate, setPostponeDate] = useState('');
  const [postponeReason, setPostponeReason] = useState('');

  const loadTodayJobs = async () => {
    setLoading(true);
    const currentToday = getColomboTodayStr();
    const currentTomorrow = addDaysToDateStr(currentToday, 1);
    if (todayStr !== currentToday) {
      setTodayStr(currentToday);
    }

    const tid = isManagerApp
      ? ''
      : (selectedTechId || (currentUser?.role === 'TECHNICIAN' ? currentUser?.id : '') || techSession?.id || '');

    const getEffectiveJobDate = (j) => {
      if (!j) return '';
      if (j.status === 'POSTPONED' && j.postponed_to_date) {
        return String(j.postponed_to_date).substring(0, 10);
      }
      return String(j.scheduled_date || '').substring(0, 10);
    };

    const filterByDateAndTech = (list, targetDate) => {
      if (!Array.isArray(list)) return [];
      return list.filter(j => {
        if (!j) return false;
        if (tid && String(j.technician_id) !== String(tid)) return false;
        return getEffectiveJobDate(j) === targetDate;
      });
    };

    try {
      if (navigator.onLine) {
        if (isManagerApp) {
          const [todayRes, tomorrowRes] = await Promise.all([
            getJobs({ date: currentToday, limit: 500 }),
            getJobs({ date: currentTomorrow, limit: 500 })
          ]);
          const combined = [...(todayRes.jobs || []), ...(tomorrowRes.jobs || [])];
          const uniqueJobs = Array.from(new Map(combined.filter(Boolean).map(item => [item.id, item])).values());

          setJobs(filterByDateAndTech(uniqueJobs, currentToday));
          setTomorrowJobs(filterByDateAndTech(uniqueJobs, currentTomorrow));
          await cacheJobs(uniqueJobs);
        } else {
          const todayRes = await getJobs({
            date: currentToday,
            technician_id: tid || undefined,
            limit: 500
          });
          const uniqueToday = Array.from(new Map((todayRes.jobs || []).filter(Boolean).map(item => [item.id, item])).values());
          setJobs(filterByDateAndTech(uniqueToday, currentToday));
          setTomorrowJobs([]);
          await cacheJobs(uniqueToday);
        }
      } else {
        const cached = await getCachedJobs();
        setJobs(filterByDateAndTech(cached, currentToday));
        setTomorrowJobs(isManagerApp ? filterByDateAndTech(cached, currentTomorrow) : []);
      }
    } catch (e) {
      console.warn('Network error fetching jobs, loading from IndexedDB:', e);
      const cached = await getCachedJobs();
      setJobs(filterByDateAndTech(cached, currentToday));
      setTomorrowJobs(isManagerApp ? filterByDateAndTech(cached, currentTomorrow) : []);
    } finally {
      setLoading(false);
    }
  };

  const loadTotalCompletedJobs = async (techId) => {
    const tid = isManagerApp
      ? ''
      : (techId !== undefined
          ? techId
          : (selectedTechId || currentUser?.id || techSession?.id || (typeof window !== 'undefined' ? localStorage.getItem('tech_preferred_id') || '' : '')));
    setLoadingCompleted(true);
    try {
      if (navigator.onLine) {
        const res = await getJobs({
          status: 'COMPLETED',
          technician_id: tid || undefined,
          limit: 1000
        });
        const serverJobs = res.jobs || [];
        const myJobs = tid ? serverJobs.filter(j => String(j.technician_id) === String(tid)) : serverJobs;
        setTotalCompletedJobs(myJobs);
        setTotalDoneCount(myJobs.length);
      } else {
        const cached = await getCachedJobs();
        const myJobs = Array.isArray(cached)
          ? cached.filter(j => j && j.status === 'COMPLETED' && (!tid || String(j.technician_id) === String(tid)))
          : [];
        setTotalCompletedJobs(myJobs);
        setTotalDoneCount(myJobs.length);
      }
    } catch (e) {
      console.warn('Network error fetching total completed jobs:', e);
      try {
        const cached = await getCachedJobs();
        const myJobs = Array.isArray(cached)
          ? cached.filter(j => j && j.status === 'COMPLETED' && (!tid || String(j.technician_id) === String(tid)))
          : [];
        setTotalCompletedJobs(myJobs);
        setTotalDoneCount(myJobs.length);
      } catch (err) {}
    } finally {
      setLoadingCompleted(false);
    }
  };

  useEffect(() => {
    getStaff({ role: 'TECHNICIAN' }).then(r => {
      setTechnicians(r.staff || []);
    }).catch(() => {});
  }, []);

  useEffect(() => {
    loadTodayJobs();
    loadTotalCompletedJobs(selectedTechId);
  }, [todayStr, selectedTechId, techSession?.id, currentUser?.id, isManagerApp]);

  // Resolve technician name for a job card
  const getAssignedTechName = (job) => {
    if (!job) return '';
    if (job.technician_name) return job.technician_name;
    if (job.technician_id) {
      const found = technicians.find(t => String(t.id) === String(job.technician_id));
      if (found) return found.full_name;
    }
    return '';
  };

  const handleStartJob = async (jobId, e, jobObj = null) => {
    if (e) e.stopPropagation();

    const startTimeIso = new Date().toISOString();

    if (!navigator.onLine) {
      await enqueueOfflineMutation({
        type: 'START_JOB',
        jobId,
        data: { actual_start_time: startTimeIso }
      });
      setJobs(prev => prev.map(j => j.id === jobId ? { ...j, status: 'IN_PROGRESS', actual_start_time: j.actual_start_time || startTimeIso } : j));
      setTomorrowJobs(prev => prev.map(j => j.id === jobId ? { ...j, status: 'IN_PROGRESS', actual_start_time: j.actual_start_time || startTimeIso } : j));
      if (activeJob?.id === jobId) {
        setActiveJob(prev => ({ ...prev, status: 'IN_PROGRESS', actual_start_time: prev.actual_start_time || startTimeIso }));
      }
      return;
    }

    try {
      const res = await startJob(jobId);
      const startedJob = res?.job;
      setJobs(prev => prev.map(j => j.id === jobId ? { ...j, ...(startedJob || {}), status: 'IN_PROGRESS', actual_start_time: startedJob?.actual_start_time || j.actual_start_time || startTimeIso } : j));
      if (activeJob?.id === jobId) {
        setActiveJob(prev => ({ ...prev, ...(startedJob || {}), status: 'IN_PROGRESS', actual_start_time: startedJob?.actual_start_time || prev.actual_start_time || startTimeIso }));
      }
      loadTodayJobs();
    } catch (err) {
      await enqueueOfflineMutation({
        type: 'START_JOB',
        jobId,
        data: { actual_start_time: startTimeIso }
      });
      setJobs(prev => prev.map(j => j.id === jobId ? { ...j, status: 'IN_PROGRESS', actual_start_time: j.actual_start_time || startTimeIso } : j));
      if (activeJob?.id === jobId) {
        setActiveJob(prev => ({ ...prev, status: 'IN_PROGRESS', actual_start_time: prev.actual_start_time || startTimeIso }));
      }
    }
  };

  const handleOpenComplete = (job, e) => {
    if (e) e.stopPropagation();
    setJobToComplete(job);
    setCompletionNotes('');
    setCustomerSignature(null);
    setShowCompleteModal(true);
  };

  const handleOpenPostpone = (job, e) => {
    if (e) e.stopPropagation();
    setJobToPostpone(job);
    setPostponeDate(tomorrowStr);
    setPostponeReason('');
    setShowPostponeModal(true);
  };

  const handleCompleteSubmit = async (e) => {
    e.preventDefault();
    if (!jobToComplete) return;

    setSubmitting(true);
    const finishTimeIso = new Date().toISOString();
    const startTimeIso = jobToComplete.actual_start_time || finishTimeIso;

    const payload = {
      actual_start_time: startTimeIso,
      actual_end_time: finishTimeIso,
      technician_notes: completionNotes,
      customer_signature: customerSignature,
      photos: []
    };

    if (!navigator.onLine) {
      await enqueueOfflineMutation({
        type: 'COMPLETE_JOB',
        jobId: jobToComplete.id,
        data: payload
      });
      const completedLocal = {
        ...jobToComplete,
        status: 'COMPLETED',
        actual_start_time: startTimeIso,
        actual_end_time: finishTimeIso,
        completed_at: finishTimeIso,
        technician_notes: completionNotes,
        customer_signature: customerSignature
      };
      setJobs(prev => prev.map(j => j.id === jobToComplete.id ? completedLocal : j));
      setTomorrowJobs(prev => prev.map(j => j.id === jobToComplete.id ? completedLocal : j));
      setTotalDoneCount(prev => prev + 1);
      setShowCompleteModal(false);
      setJobToComplete(null);
      if (activeJob?.id === jobToComplete.id) {
        setActiveJob(completedLocal);
      }
      setSubmitting(false);
      return;
    }

    try {
      const res = await completeJob(jobToComplete.id, payload);
      const updatedCompleted = res?.job || {
        ...jobToComplete,
        status: 'COMPLETED',
        actual_start_time: startTimeIso,
        actual_end_time: finishTimeIso,
        completed_at: finishTimeIso,
        technician_notes: completionNotes,
        customer_signature: customerSignature
      };
      setShowCompleteModal(false);
      setJobToComplete(null);
      if (activeJob?.id === jobToComplete.id) {
        setActiveJob(updatedCompleted);
      }
      loadTodayJobs();
      loadTotalCompletedJobs();
    } catch (err) {
      await enqueueOfflineMutation({
        type: 'COMPLETE_JOB',
        jobId: jobToComplete.id,
        data: payload
      });
      const completedFallback = {
        ...jobToComplete,
        status: 'COMPLETED',
        actual_start_time: startTimeIso,
        actual_end_time: finishTimeIso,
        completed_at: finishTimeIso,
        technician_notes: completionNotes,
        customer_signature: customerSignature
      };
      setJobs(prev => prev.map(j => j.id === jobToComplete.id ? completedFallback : j));
      setTomorrowJobs(prev => prev.map(j => j.id === jobToComplete.id ? completedFallback : j));
      setTotalDoneCount(prev => prev + 1);
      setShowCompleteModal(false);
      setJobToComplete(null);
      if (activeJob?.id === jobToComplete.id) {
        setActiveJob(completedFallback);
      }
    } finally {
      setSubmitting(false);
    }
  };

  const handlePostponeSubmit = async (e) => {
    e.preventDefault();
    if (!jobToPostpone || !postponeDate) return;

    const payload = {
      postponed_to_date: postponeDate,
      reason: postponeReason
    };

    const applyLocalPostpone = () => {
      const updatedJob = {
        ...jobToPostpone,
        status: 'POSTPONED',
        scheduled_date: postponeDate,
        postponed_to_date: postponeDate,
        reschedule_reason: postponeReason
      };
      if (postponeDate !== todayStr) {
        setJobs(prev => prev.filter(j => j.id !== jobToPostpone.id));
      } else {
        setJobs(prev => prev.map(j => j.id === jobToPostpone.id ? updatedJob : j));
      }
      if (isManagerApp && postponeDate === tomorrowStr) {
        setTomorrowJobs(prev => {
          const exists = prev.some(j => j.id === jobToPostpone.id);
          return exists ? prev.map(j => j.id === jobToPostpone.id ? updatedJob : j) : [...prev, updatedJob];
        });
        setMainTab('tomorrow');
      } else {
        setTomorrowJobs(prev => prev.filter(j => j.id !== jobToPostpone.id));
      }
    };

    if (!navigator.onLine) {
      await enqueueOfflineMutation({
        type: 'POSTPONE_JOB',
        jobId: jobToPostpone.id,
        data: payload
      });
      applyLocalPostpone();
      setShowPostponeModal(false);
      setJobToPostpone(null);
      if (activeJob?.id === jobToPostpone.id) {
        setActiveJob(null);
      }
      return;
    }

    try {
      await postponeJob(jobToPostpone.id, payload);
      applyLocalPostpone();
      setShowPostponeModal(false);
      setJobToPostpone(null);
      if (activeJob?.id === jobToPostpone.id) {
        setActiveJob(null);
      }
      loadTodayJobs();
    } catch (err) {
      await enqueueOfflineMutation({
        type: 'POSTPONE_JOB',
        jobId: jobToPostpone.id,
        data: payload
      });
      applyLocalPostpone();
      setShowPostponeModal(false);
      setJobToPostpone(null);
      if (activeJob?.id === jobToPostpone.id) {
        setActiveJob(null);
      }
    }
  };

  const openNavigation = (job, e) => {
    if (e) e.stopPropagation();
    let query = '';
    if (job.latitude && job.longitude) {
      query = `${job.latitude},${job.longitude}`;
    } else {
      query = encodeURIComponent(`${job.location_name || ''} ${job.location_address || ''} Sri Lanka`);
    }
    window.open(`https://www.google.com/maps/search/?api=1&query=${query}`, '_blank');
  };

  const safeJobs = useMemo(() => {
    if (!Array.isArray(jobs)) return [];
    return jobs.filter(j => {
      if (!j) return false;
      const effDate = (j.status === 'POSTPONED' && j.postponed_to_date)
        ? String(j.postponed_to_date).substring(0, 10)
        : String(j.scheduled_date || '').substring(0, 10);
      return effDate === todayStr;
    });
  }, [jobs, todayStr]);

  const safeTomorrowJobs = useMemo(() => {
    if (!isManagerApp || !Array.isArray(tomorrowJobs)) return [];
    return tomorrowJobs.filter(j => {
      if (!j) return false;
      const effDate = (j.status === 'POSTPONED' && j.postponed_to_date)
        ? String(j.postponed_to_date).substring(0, 10)
        : String(j.scheduled_date || '').substring(0, 10);
      return effDate === tomorrowStr;
    });
  }, [tomorrowJobs, tomorrowStr, isManagerApp]);

  const todayCompletedJobs = useMemo(() => {
    return safeJobs.filter(j => j && j.status === 'COMPLETED');
  }, [safeJobs]);

  const todayTodoJobs = useMemo(() => {
    return safeJobs.filter(j => j && j.status !== 'COMPLETED' && j.status !== 'CANCELLED');
  }, [safeJobs]);

  const tomorrowTodoJobs = useMemo(() => {
    return safeTomorrowJobs.filter(j => j && j.status !== 'COMPLETED' && j.status !== 'CANCELLED');
  }, [safeTomorrowJobs]);

  const filteredCompletedJobs = useMemo(() => {
    if (!Array.isArray(totalCompletedJobs)) return [];
    if (!completedSearch.trim()) return totalCompletedJobs;
    const q = completedSearch.toLowerCase().trim();
    return totalCompletedJobs.filter(job => {
      return (
        (job.job_code && job.job_code.toLowerCase().includes(q)) ||
        (job.customer_name && job.customer_name.toLowerCase().includes(q)) ||
        (job.customer_phone && job.customer_phone.includes(q)) ||
        (job.location_name && job.location_name.toLowerCase().includes(q)) ||
        (job.location_address && job.location_address.toLowerCase().includes(q)) ||
        (job.treatment_code && job.treatment_code.toLowerCase().includes(q)) ||
        (job.technician_name && job.technician_name.toLowerCase().includes(q))
      );
    });
  }, [totalCompletedJobs, completedSearch]);

  const totalTodayScheduled = todayTodoJobs.length + todayCompletedJobs.length;
  const todayCompletionPercent = totalTodayScheduled > 0
    ? Math.round((todayCompletedJobs.length / totalTodayScheduled) * 100)
    : (todayCompletedJobs.length > 0 ? 100 : 0);

  // Clean Assigned Technician Name Display (No dropdown list of all technicians)
  const renderAssignedTechnicianBar = (job) => {
    const techName = getAssignedTechName(job);
    const hasTech = Boolean(techName);

    return (
      <div
        className={`flex items-center justify-between gap-2 px-3 py-2 rounded-2xl border text-xs ${
          hasTech
            ? 'bg-indigo-50/90 border-indigo-200 text-indigo-950'
            : 'bg-amber-50 border-amber-300 text-amber-950'
        }`}
      >
        <div className="flex items-center gap-2 min-w-0">
          <div className={`w-6 h-6 rounded-lg flex items-center justify-center shrink-0 ${
            hasTech ? 'bg-[#5B21B6] text-white' : 'bg-amber-500 text-white'
          }`}>
            <HardHat className="w-3.5 h-3.5" />
          </div>
          <div className="min-w-0">
            <div className="text-[9px] font-black uppercase tracking-wider opacity-75">
              Assigned Technician
            </div>
            <div className="font-black text-xs truncate">
              {hasTech ? techName : 'Unassigned'}
            </div>
          </div>
        </div>
        {job?.technician_phone && (
          <span className="text-[10px] font-mono font-bold text-indigo-700 bg-white px-2 py-0.5 rounded-lg border border-indigo-100 shrink-0">
            {job.technician_phone}
          </span>
        )}
      </div>
    );
  };

  // Full Operational Details Grid (Crew / How Many People, Vehicle No, Machine Name)
  const renderOperationalDetailsGrid = (job) => {
    if (!job) return null;
    const crewCount = job.crew_count || 1;
    const teamMembers = job.team_members || '';
    const vehicleDisplay = job.vehicle_no || job.vehicle_number
      ? `${job.vehicle_no || job.vehicle_number}${job.vehicle_type ? ` (${job.vehicle_type})` : ''}`
      : (job.vehicle_type || 'Not Specified');
    const machineDisplay = job.machine_name || job.machine_type || 'Standard Equipment';

    return (
      <div className="grid grid-cols-3 gap-1.5 text-[11px]">
        {/* How Many People Come */}
        <div className="p-2 rounded-xl bg-slate-50 border border-slate-200/80 flex flex-col justify-between">
          <div className="flex items-center gap-1 text-[9px] font-black uppercase tracking-wider text-slate-500">
            <Users className="w-3 h-3 text-[#6D28D9] shrink-0" />
            <span className="truncate">Crew / People</span>
          </div>
          <div className="font-black text-slate-900 mt-0.5 truncate" title={teamMembers ? `${crewCount} People (${teamMembers})` : `${crewCount} People`}>
            {crewCount} {Number(crewCount) === 1 ? 'Person' : 'People'}
          </div>
          {teamMembers && (
            <div className="text-[9px] text-slate-500 truncate">{teamMembers}</div>
          )}
        </div>

        {/* Vehicle No */}
        <div className="p-2 rounded-xl bg-slate-50 border border-slate-200/80 flex flex-col justify-between">
          <div className="flex items-center gap-1 text-[9px] font-black uppercase tracking-wider text-slate-500">
            <Truck className="w-3 h-3 text-[#F97316] shrink-0" />
            <span className="truncate">Vehicle No</span>
          </div>
          <div className="font-black text-slate-900 mt-0.5 truncate" title={vehicleDisplay}>
            {vehicleDisplay}
          </div>
        </div>

        {/* Machine Name */}
        <div className="p-2 rounded-xl bg-slate-50 border border-slate-200/80 flex flex-col justify-between">
          <div className="flex items-center gap-1 text-[9px] font-black uppercase tracking-wider text-slate-500">
            <Wrench className="w-3 h-3 text-emerald-600 shrink-0" />
            <span className="truncate">Machine Name</span>
          </div>
          <div className="font-black text-slate-900 mt-0.5 truncate" title={machineDisplay}>
            {machineDisplay}
          </div>
        </div>
      </div>
    );
  };

  // Real-Time Live Timer Card when Job is IN_PROGRESS
  const renderLiveWorkTimer = (job) => {
    if (!job || job.status !== 'IN_PROGRESS') return null;
    const startIso = job.actual_start_time || job.updated_at || new Date().toISOString();
    const startMs = new Date(startIso).getTime();
    const durationMins = Number(job.duration_minutes) || 60;
    const targetEndDate = !isNaN(startMs) ? new Date(startMs + durationMins * 60000) : null;
    const elapsedStr = formatElapsedHms(startIso, nowTick);

    return (
      <div className="p-3.5 rounded-2xl bg-gradient-to-r from-slate-900 via-[#2E1065] to-[#4C1D95] text-white border-2 border-amber-400/80 shadow-lg space-y-2.5">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-ping" />
            <span className="text-[10px] font-black uppercase tracking-widest text-amber-300 flex items-center gap-1">
              <Timer className="w-3.5 h-3.5 text-amber-300" />
              <span>LIVE WORK TIMER RUNNING</span>
            </span>
          </div>
          <span className="px-2.5 py-0.5 rounded-full bg-amber-400 text-slate-950 font-mono font-black text-sm tracking-wider shadow-xs">
            {elapsedStr}
          </span>
        </div>

        <div className="grid grid-cols-2 gap-2 pt-1 border-t border-white/15 text-[11px]">
          <div className="bg-white/10 rounded-xl p-2">
            <div className="text-[9px] uppercase font-bold text-emerald-300">Start Time</div>
            <div className="font-mono font-black text-white text-xs mt-0.5">
              {formatTimeOnlyDisplay(startIso)}
            </div>
            <div className="text-[9px] text-purple-200">{String(job.scheduled_date || todayStr).substring(0, 10)}</div>
          </div>

          <div className="bg-white/10 rounded-xl p-2">
            <div className="text-[9px] uppercase font-bold text-amber-300">Current / Est. Finish Time</div>
            <div className="font-mono font-black text-amber-200 text-xs mt-0.5">
              {formatTimeOnlyDisplay(new Date(nowTick))}
            </div>
            {targetEndDate && (
              <div className="text-[9px] text-purple-200">
                Target ({durationMins}m): {formatTimeOnlyDisplay(targetEndDate)}
              </div>
            )}
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="w-full max-w-4xl mx-auto min-h-[100dvh] bg-[#F5F3FF] pb-28 shadow-2xl relative font-sans overflow-x-hidden">

      {/* Top Mobile App Header with Purple & Orange Curved Wave UI */}
      <div className="bg-gradient-to-br from-[#5B21B6] via-[#4C1D95] to-[#2E1065] text-white p-3.5 sm:p-5 sticky top-0 z-30 shadow-xl rounded-b-[2rem] relative overflow-hidden">
        {/* Decorative Orange Curved Wave */}
        <div className="absolute top-0 right-0 w-48 h-24 pointer-events-none opacity-85">
          <svg viewBox="0 0 200 100" preserveAspectRatio="none" className="w-full h-full">
            <path d="M20,0 L200,0 L200,95 C130,90 80,35 20,0 Z" fill="url(#headerOrangeWave)" />
            <defs>
              <linearGradient id="headerOrangeWave" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="#FF8A00" />
                <stop offset="100%" stopColor="#F97316" />
              </linearGradient>
            </defs>
          </svg>
        </div>

        <div className="flex items-center justify-between gap-2 relative z-10">
          <div className="flex items-center gap-2.5 min-w-0">
            {activeJob ? (
              <button
                onClick={() => setActiveJob(null)}
                className="w-9 h-9 rounded-2xl bg-white/20 hover:bg-white/30 flex items-center justify-center text-white transition shrink-0 cursor-pointer"
              >
                <ArrowLeft className="w-5 h-5" />
              </button>
            ) : (
              <div className="w-11 h-11 rounded-2xl bg-white p-0.5 border-2 border-amber-300 flex items-center justify-center shadow-lg overflow-hidden shrink-0">
                <img
                  src="/pest-tech-man.jpg"
                  alt="Pest Control"
                  className="w-full h-full object-cover rounded-xl"
                  onError={(e) => {
                    e.currentTarget.style.display = 'none';
                  }}
                />
              </div>
            )}
            <div className="min-w-0">
              <h1 className="font-black text-xs sm:text-base tracking-tight leading-tight truncate text-white drop-shadow-xs">
                {activeJob
                  ? 'JOB FULL DETAILS & EXECUTION'
                  : isManagerApp
                    ? 'MANAGER OPERATIONS APP'
                    : 'TECHNICIAN TODAY WORK APP'}
              </h1>
              <div className="text-[10px] text-amber-200 font-bold flex items-center gap-1 truncate">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse shrink-0"></span>
                <span className="truncate">
                  {isManagerApp ? `Manager Schedule • Today & Tomorrow • ${todayStr}` : `Today Work Queue Only • ${todayStr}`}
                </span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-1.5 shrink-0 relative z-10">
            {syncState.pendingCount > 0 ? (
              <button
                type="button"
                onClick={async () => {
                  setSyncingNow(true);
                  await triggerSync();
                  setSyncingNow(false);
                }}
                title="Tap to synchronize pending offline actions"
                className="px-2 py-1 rounded-xl bg-amber-500/30 hover:bg-amber-500/45 text-amber-100 border border-amber-300/50 text-[10px] font-black uppercase tracking-wider flex items-center gap-1 animate-pulse transition cursor-pointer"
              >
                <RefreshCw className={`w-3 h-3 ${syncingNow ? 'animate-spin' : ''}`} />
                <span>SYNC ({syncState.pendingCount})</span>
              </button>
            ) : (
              <span className="px-2 py-1 rounded-xl bg-emerald-500/25 text-emerald-100 border border-emerald-400/40 text-[10px] font-black uppercase tracking-wider flex items-center gap-1">
                <Check className="w-3 h-3 text-emerald-300" />
                <span className="hidden sm:inline">SYNCED</span>
              </span>
            )}

            {!isStandalone && (
              <button
                type="button"
                onClick={handleInstallApp}
                title="Save App Icon to Phone Screen"
                className="px-2.5 py-1.5 rounded-xl bg-white hover:bg-orange-50 text-[#4C1D95] font-black text-[10px] flex items-center gap-1 shadow-sm active:scale-95 transition cursor-pointer"
              >
                <Smartphone className="w-3.5 h-3.5 text-orange-500" />
                <span className="hidden sm:inline">Install</span>
              </button>
            )}
            <button
              onClick={loadTodayJobs}
              title="Refresh job queue"
              className="p-2 rounded-xl bg-white/15 hover:bg-white/25 text-white transition cursor-pointer"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin text-amber-300' : ''}`} />
            </button>

            <button
              type="button"
              onClick={handleSignOut}
              title="Sign Out"
              className="px-2.5 py-1.5 rounded-xl bg-rose-500/30 hover:bg-rose-500/50 text-white border border-white/25 text-[11px] font-black flex items-center gap-1 transition cursor-pointer active:scale-95"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Sign Out</span>
            </button>
          </div>
        </div>

        {/* Profile & Quick KPI Bar on Mobile & iPad (No Technician Dropdown List on Manager Main Screen) */}
        {!activeJob && (
          <div className="mt-3 space-y-2.5 relative z-10">
            <div className="flex flex-wrap items-center justify-between gap-2 bg-white/15 backdrop-blur-md px-3.5 py-2 rounded-2xl border border-white/20 text-xs">
              <div className="flex items-center gap-2 min-w-0">
                <div className="w-6 h-6 rounded-lg bg-[#F97316] flex items-center justify-center shrink-0 shadow-xs">
                  {isManagerApp ? <Briefcase className="w-3.5 h-3.5 text-white" /> : <Phone className="w-3.5 h-3.5 text-white" />}
                </div>
                <span className="text-[11px] text-purple-100 truncate">
                  {currentUser?.full_name ? (
                    <span>
                      <strong className="text-white font-black">{currentUser.full_name}</strong>{' '}
                      {currentUser.phone ? <span className="text-amber-300 font-mono">({currentUser.phone})</span> : ''}
                    </span>
                  ) : techSession ? (
                    <span>
                      <strong className="text-white font-black">{techSession.full_name}</strong>{' '}
                      <span className="text-amber-300 font-mono">({techSession.phone})</span>
                    </span>
                  ) : (
                    <span className="text-amber-300 font-bold">
                      {isManagerApp ? 'Verified Operations Manager' : 'Verified Field Technician'}
                    </span>
                  )}
                </span>
              </div>

              <div className="flex items-center gap-1.5 shrink-0">
                <span className="text-[9px] font-black uppercase px-2 py-0.5 rounded-full bg-amber-400 text-slate-950 shadow-2xs">
                  {todayCompletionPercent}% Today
                </span>
                <span className="text-[9px] font-black uppercase px-2 py-0.5 rounded-full bg-emerald-400/25 text-emerald-200 border border-emerald-300/40 hidden xs:inline">
                  {isManagerApp ? 'MANAGER OTP' : 'TECH OTP'}
                </span>
              </div>
            </div>

            {/* Quick Status Summary Bar:
                - For MANAGER: 4 cards (Today Jobs, Tomorrow, Today Done, Total Done)
                - For TECHNICIAN: 3 cards (Today Jobs, Today Done, Total Done — NO Tomorrow!) */}
            <div className={`grid ${isManagerApp ? 'grid-cols-4' : 'grid-cols-3'} gap-1.5 sm:gap-2 text-center text-xs`}>
              <button
                type="button"
                onClick={() => switchMainTab('today')}
                className={`p-2 sm:p-2.5 rounded-2xl border transition cursor-pointer ${
                  mainTab === 'today'
                    ? 'bg-gradient-to-b from-[#FF8A00] to-[#F97316] text-white border-amber-300 shadow-lg'
                    : 'bg-white/10 text-white border-white/15 hover:bg-white/20'
                }`}
              >
                <div className="text-base sm:text-lg font-black leading-none text-white">
                  {todayTodoJobs.length}
                </div>
                <div className="text-[9px] sm:text-[10px] font-black uppercase truncate mt-1 text-white/95">
                  Today Jobs
                </div>
              </button>

              {isManagerApp && (
                <button
                  type="button"
                  onClick={() => switchMainTab('tomorrow')}
                  className={`p-2 sm:p-2.5 rounded-2xl border transition cursor-pointer ${
                    mainTab === 'tomorrow'
                      ? 'bg-white text-[#4C1D95] border-white shadow-lg'
                      : 'bg-white/10 text-white border-white/15 hover:bg-white/20'
                  }`}
                >
                  <div className={`text-base sm:text-lg font-black leading-none ${mainTab === 'tomorrow' ? 'text-[#5B21B6]' : 'text-amber-200'}`}>
                    {tomorrowTodoJobs.length}
                  </div>
                  <div className={`text-[9px] sm:text-[10px] font-black uppercase truncate mt-1 ${mainTab === 'tomorrow' ? 'text-[#4C1D95]' : 'text-purple-100'}`}>
                    Tomorrow
                  </div>
                </button>
              )}

              <button
                type="button"
                onClick={() => switchMainTab('today_completed')}
                className={`p-2 sm:p-2.5 rounded-2xl border transition cursor-pointer ${
                  mainTab === 'today_completed'
                    ? 'bg-white text-emerald-700 border-white shadow-lg'
                    : 'bg-white/10 text-white border-white/15 hover:bg-white/20'
                }`}
              >
                <div className={`text-base sm:text-lg font-black leading-none ${mainTab === 'today_completed' ? 'text-emerald-600' : 'text-emerald-300'}`}>
                  {todayCompletedJobs.length}
                </div>
                <div className={`text-[9px] sm:text-[10px] font-black uppercase truncate mt-1 ${mainTab === 'today_completed' ? 'text-emerald-700' : 'text-emerald-100'}`}>
                  Today Done
                </div>
              </button>

              <button
                type="button"
                onClick={() => {
                  switchMainTab('completed_history');
                  loadTotalCompletedJobs();
                }}
                className={`p-2 sm:p-2.5 rounded-2xl border transition cursor-pointer ${
                  mainTab === 'completed_history'
                    ? 'bg-white text-orange-700 border-white shadow-lg'
                    : 'bg-white/10 text-white border-white/15 hover:bg-white/20'
                }`}
              >
                <div className={`text-base sm:text-lg font-black leading-none flex items-center justify-center gap-0.5 ${mainTab === 'completed_history' ? 'text-orange-600' : 'text-amber-300'}`}>
                  <Award className="w-3.5 h-3.5 inline" />
                  <span>{totalDoneCount}</span>
                </div>
                <div className={`text-[9px] sm:text-[10px] font-black uppercase truncate mt-1 ${mainTab === 'completed_history' ? 'text-orange-700' : 'text-amber-100'}`}>
                  Total Done
                </div>
              </button>
            </div>
          </div>
        )}
      </div>

      {/* PWA Save to Home Screen Top Banner */}
      {!isStandalone && (
        <div className="mx-3 mt-3 p-3 bg-gradient-to-r from-[#5B21B6] via-[#6D28D9] to-[#F97316] rounded-2xl shadow-md text-white flex items-center justify-between gap-2.5 border border-white/20">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-9 h-9 rounded-xl bg-white/20 backdrop-blur-md flex items-center justify-center shrink-0 border border-white/30 shadow-inner">
              <Smartphone className="w-5 h-5 text-white" />
            </div>
            <div className="min-w-0">
              <div className="text-xs font-black tracking-tight flex items-center gap-1 truncate">
                <span className="truncate">{isManagerApp ? 'Install Manager App' : 'Install Technician App'}</span>
                <Sparkles className="w-3.5 h-3.5 text-amber-200 shrink-0" />
              </div>
              <div className="text-[10px] text-purple-100 leading-tight truncate">
                Works on Android, iPhone &amp; iPad home screen
              </div>
            </div>
          </div>

          <button
            onClick={handleInstallApp}
            className="px-3.5 py-2 bg-white hover:bg-orange-50 text-[#4C1D95] font-black text-xs rounded-full shadow-sm shrink-0 flex items-center gap-1.5 active:scale-95 transition cursor-pointer"
          >
            <Download className="w-3.5 h-3.5 text-[#F97316]" />
            <span>Install</span>
          </button>
        </div>
      )}

      {/* Real Web Push Notification Permission Explanatory Banner */}
      {!activeJob && !isManagerApp && (
        <div className="mx-3 mt-3">
          <PushNotificationBanner technicianId={selectedTechId || techSession?.id} />
        </div>
      )}

      {/* MANAGER APP ONLY: Prominent 3-Button Bar (Today Schedule | Tomorrow Schedule | Master Schedule Calendar) */}
      {isManagerApp && !activeJob && !(initialJobId && loading) && (
        <div className="mx-3 mt-3 space-y-2">
          <div className="grid grid-cols-3 p-1.5 bg-white rounded-2xl border-2 border-purple-100 shadow-md gap-1.5">
            <button
              type="button"
              onClick={() => switchMainTab('today')}
              className={`py-3 px-2 rounded-xl font-black text-xs flex items-center justify-center gap-1.5 transition cursor-pointer ${
                mainTab === 'today'
                  ? 'bg-gradient-to-r from-[#F97316] to-[#FF8A00] text-white shadow-md shadow-orange-200'
                  : 'bg-purple-50/60 text-slate-700 hover:bg-orange-50 hover:text-orange-700'
              }`}
            >
              <Calendar className="w-3.5 h-3.5 shrink-0" />
              <span className="truncate">Today Jobs</span>
              <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-black shrink-0 ${
                mainTab === 'today' ? 'bg-white/25 text-white' : 'bg-orange-100 text-orange-700'
              }`}>
                {todayTodoJobs.length}
              </span>
            </button>

            <button
              type="button"
              onClick={() => switchMainTab('tomorrow')}
              className={`py-3 px-2 rounded-xl font-black text-xs flex items-center justify-center gap-1.5 transition cursor-pointer ${
                mainTab === 'tomorrow'
                  ? 'bg-gradient-to-r from-[#5B21B6] to-[#6D28D9] text-white shadow-md shadow-purple-200'
                  : 'bg-purple-50/60 text-slate-700 hover:bg-purple-100 hover:text-purple-800'
              }`}
            >
              <Clock className="w-3.5 h-3.5 shrink-0" />
              <span className="truncate">Tomorrow</span>
              <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-black shrink-0 ${
                mainTab === 'tomorrow' ? 'bg-white/25 text-white' : 'bg-purple-100 text-purple-700'
              }`}>
                {tomorrowTodoJobs.length}
              </span>
            </button>

            <button
              type="button"
              onClick={() => {
                if (onOpenCalendar) onOpenCalendar();
              }}
              className="py-3 px-2 rounded-xl font-black text-xs flex items-center justify-center gap-1.5 bg-gradient-to-r from-indigo-900 to-[#3B0764] hover:from-indigo-800 hover:to-purple-900 text-white shadow-sm transition cursor-pointer"
            >
              <Calendar className="w-3.5 h-3.5 text-amber-300 shrink-0" />
              <span className="truncate">Master Calendar</span>
            </button>
          </div>
        </div>
      )}

      {/* Loading Indicator for Deep-Linked Job from SMS */}
      {initialJobId && !activeJob && loading && (
        <div className="p-8 text-center bg-white rounded-3xl border border-purple-100 shadow-md mx-3 mt-4 space-y-3">
          <div className="w-12 h-12 rounded-full border-4 border-[#6D28D9] border-t-transparent animate-spin mx-auto"></div>
          <div className="font-black text-slate-900 text-sm">Opening Assigned Job #{initialJobId}...</div>
          <p className="text-xs text-slate-500">Loading customer details, phone number &amp; location navigation. Please wait a moment.</p>
        </div>
      )}

      {/* VIEW 1: TODAY JOB LIST, TOMORROW JOB LIST (MANAGER ONLY), TODAY DONE, OR TOTAL DONE */}
      {!activeJob && !(initialJobId && loading) && (
        <div className="p-3 sm:p-4 space-y-3">
          {mainTab === 'today' ? (
            <div className="space-y-3">
              {/* Today Job List Header Banner */}
              <div className="bg-gradient-to-r from-[#F97316] via-[#EA580C] to-[#5B21B6] rounded-2xl px-4 py-3 text-white shadow-sm flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <div className="w-9 h-9 rounded-xl bg-white/20 flex items-center justify-center shrink-0">
                    <Calendar className="w-5 h-5 text-white" />
                  </div>
                  <div>
                    <div className="text-[10px] font-bold text-orange-100 uppercase tracking-wider">
                      {isManagerApp ? 'Manager Today Operations Schedule' : 'Technician Active Work Queue (Today Only)'}
                    </div>
                    <h3 className="text-sm font-black text-white">Today Scheduled Jobs &bull; {todayStr}</h3>
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-xl font-black text-white">{todayTodoJobs.length}</div>
                  <div className="text-[9px] uppercase font-bold text-orange-100">Today Jobs</div>
                </div>
              </div>

              {loading ? (
                <div className="p-8 text-center bg-white rounded-3xl border border-slate-200 shadow-sm mt-2 space-y-2">
                  <RefreshCw className="w-8 h-8 text-[#F97316] animate-spin mx-auto" />
                  <div className="font-bold text-slate-700 text-xs">Loading Today Scheduled Jobs...</div>
                </div>
              ) : todayTodoJobs.length === 0 ? (
                <div className="p-8 text-center bg-white rounded-3xl border border-purple-100 shadow-sm mt-2 space-y-3">
                  <CheckCircle2 className="w-12 h-12 text-emerald-500 mx-auto" />
                  <div className="font-black text-slate-800 text-sm">
                    {todayCompletedJobs.length > 0 ? 'All Scheduled Jobs Done for Today!' : 'No Pending Jobs Scheduled for Today!'}
                  </div>
                  <p className="text-xs text-slate-500">
                    {todayCompletedJobs.length > 0
                      ? `All ${todayCompletedJobs.length} scheduled jobs for today (${todayStr}) have been completed.`
                      : `No pending jobs scheduled for today (${todayStr}).`}
                  </p>
                  <div className="flex flex-wrap items-center justify-center gap-2 pt-1">
                    {isManagerApp && tomorrowTodoJobs.length > 0 && (
                      <button
                        type="button"
                        onClick={() => switchMainTab('tomorrow')}
                        className="px-4 py-2.5 bg-[#5B21B6] hover:bg-[#4C1D95] text-white font-bold rounded-full text-xs inline-flex items-center gap-1.5 transition cursor-pointer shadow-sm"
                      >
                        <Clock className="w-4 h-4 text-purple-200" />
                        <span>View Tomorrow Scheduled Jobs ({tomorrowTodoJobs.length})</span>
                      </button>
                    )}
                    {todayCompletedJobs.length > 0 && (
                      <button
                        type="button"
                        onClick={() => switchMainTab('today_completed')}
                        className="px-4 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-full text-xs inline-flex items-center gap-1.5 transition cursor-pointer shadow-sm"
                      >
                        <CheckCircle2 className="w-4 h-4 text-emerald-300" />
                        <span>View Today Completed ({todayCompletedJobs.length})</span>
                      </button>
                    )}
                  </div>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
                  {todayTodoJobs.map(job => {
                    const formattedPhone = job.customer_phone ? job.customer_phone.replace(/[^0-9]/g, '') : '';
                    const intlPhone = formattedPhone.startsWith('0')
                      ? '94' + formattedPhone.substring(1)
                      : formattedPhone.startsWith('94')
                        ? formattedPhone
                        : '94' + formattedPhone;

                    const whatsappText = encodeURIComponent(`Hello ${job.customer_name}, this is your Pest Control Service Team regarding your scheduled ${job.treatment_code} service today.`);

                    return (
                      <div
                        key={job.id}
                        onClick={() => setActiveJob(job)}
                        className="bg-white rounded-3xl border border-purple-100 p-4 shadow-sm hover:shadow-md transition space-y-3 cursor-pointer relative overflow-hidden flex flex-col justify-between"
                      >
                        <div
                          className="absolute top-0 left-0 bottom-0 w-1.5"
                          style={{ backgroundColor: job.treatment_color || '#F97316' }}
                        ></div>

                        <div className="space-y-2.5">
                          {/* Header: Customer & Status */}
                          <div className="flex items-start justify-between gap-2 pl-1.5">
                            <div className="min-w-0">
                              <h3 className="font-black text-slate-900 text-base leading-tight truncate">{job.customer_name}</h3>
                              <div className="text-[11px] text-slate-400 font-mono mt-0.5 flex items-center gap-1.5 flex-wrap">
                                <span>{job.job_code}</span>
                                <span className="px-2 py-0.5 rounded-md bg-orange-50 text-orange-700 border border-orange-200 font-black text-[10px]">
                                  Today ({todayStr})
                                </span>
                              </div>
                            </div>
                            <span className={`px-2.5 py-1 rounded-full text-[10px] font-black uppercase shrink-0 ${
                              job.status === 'COMPLETED' ? 'bg-emerald-100 text-emerald-800' :
                              job.status === 'IN_PROGRESS' ? 'bg-amber-100 text-amber-800 animate-pulse' :
                              job.status === 'POSTPONED' ? 'bg-purple-100 text-purple-800' :
                              'bg-slate-100 text-slate-700'
                            }`}>
                              {job.status}
                            </span>
                          </div>

                          {/* Live Running Timer on Screen when Job is IN_PROGRESS */}
                          {job.status === 'IN_PROGRESS' && (
                            <div className="pl-1.5">
                              {renderLiveWorkTimer(job)}
                            </div>
                          )}

                          {/* Assigned Technician Name Banner */}
                          <div className="pl-1.5">
                            {renderAssignedTechnicianBar(job)}
                          </div>

                          {/* Full Operational Details: Crew Count, Vehicle No, Machine Name */}
                          <div className="pl-1.5">
                            {renderOperationalDetailsGrid(job)}
                          </div>

                          {/* Details: Location, Time, Treatment */}
                          <div className="space-y-1.5 text-xs text-slate-600 bg-purple-50/40 p-2.5 rounded-2xl border border-purple-100/80 pl-3 ml-1.5">
                            <div className="flex items-center gap-2">
                              <MapPin className="w-4 h-4 text-[#F97316] shrink-0" />
                              <span className="font-semibold text-slate-800 line-clamp-1">
                                {job.location_name || job.location_address || 'Main Location'}
                              </span>
                            </div>

                            <div className="flex items-center justify-between text-[11px] pt-1 border-t border-purple-100/60">
                              <div className="flex items-center gap-1.5 font-bold text-slate-700">
                                <Clock className="w-3.5 h-3.5 text-[#6D28D9]" />
                                <span>{job.scheduled_time || '09:00'} ({job.duration_minutes || 60}m)</span>
                              </div>

                              <span
                                style={{ backgroundColor: `${job.treatment_color || '#6D28D9'}20`, color: job.treatment_color || '#6D28D9' }}
                                className="px-2.5 py-0.5 rounded-lg font-black text-[11px]"
                              >
                                {job.treatment_code}{job.treatment_name ? ` • ${job.treatment_name}` : ''}
                              </span>
                            </div>
                          </div>
                        </div>

                        {/* Field Actions: Call, WhatsApp, Navigation, Start / Complete */}
                        <div className="space-y-2 pt-1 pl-1.5" onClick={(e) => e.stopPropagation()}>
                          <div className="grid grid-cols-3 gap-1.5">
                            {job.customer_phone ? (
                              <a
                                href={`tel:${job.customer_phone}`}
                                className="flex items-center justify-center gap-1 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-800 font-bold rounded-xl text-xs transition"
                              >
                                <Phone className="w-3.5 h-3.5 text-emerald-600" />
                                <span>CALL</span>
                              </a>
                            ) : (
                              <div className="py-2.5 bg-slate-50 text-slate-400 font-bold rounded-xl text-[10px] text-center">NO PHONE</div>
                            )}

                            {job.customer_phone ? (
                              <a
                                href={`https://wa.me/${intlPhone}?text=${whatsappText}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="flex items-center justify-center gap-1 py-2.5 bg-emerald-50 hover:bg-emerald-100 text-emerald-800 font-bold rounded-xl text-xs transition border border-emerald-200/60"
                              >
                                <span className="text-emerald-600 font-bold text-xs">💬</span>
                                <span>CHAT</span>
                              </a>
                            ) : (
                              <div className="py-2.5 bg-slate-50 text-slate-400 font-bold rounded-xl text-[10px] text-center">NO WA</div>
                            )}

                            <button
                              onClick={(e) => openNavigation(job, e)}
                              className="flex items-center justify-center gap-1 py-2.5 bg-purple-50 hover:bg-purple-100 text-[#4C1D95] font-bold rounded-xl text-xs transition border border-purple-200/60 cursor-pointer"
                            >
                              <Navigation className="w-3.5 h-3.5 text-[#6D28D9]" />
                              <span>MAPS</span>
                            </button>
                          </div>

                          {/* Primary Workflow Button (Only for field Technicians; Managers only view job list & operational details) */}
                          {!isManagerApp ? (
                            job.status === 'IN_PROGRESS' ? (
                              <button
                                onClick={(e) => handleOpenComplete(job, e)}
                                className="w-full flex items-center justify-center gap-2 py-3.5 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white font-black rounded-full text-xs shadow-md shadow-emerald-200 transition active:scale-98 cursor-pointer"
                              >
                                <CheckCircle2 className="w-4 h-4" />
                                <span>FINISH WORK &amp; COMPLETE JOB</span>
                              </button>
                            ) : job.status !== 'COMPLETED' ? (
                              <button
                                onClick={(e) => handleStartJob(job.id, e, job)}
                                className="w-full flex items-center justify-center gap-2 py-3.5 bg-gradient-to-r from-[#F97316] to-[#EA580C] hover:from-[#EA580C] hover:to-[#C2410C] text-white font-black rounded-full text-xs shadow-md shadow-orange-200 transition active:scale-98 cursor-pointer"
                              >
                                <Play className="w-4 h-4 text-white" />
                                <span>START JOB NOW (START TIMER)</span>
                              </button>
                            ) : (
                              <div className="py-2.5 bg-emerald-50 text-emerald-700 font-bold rounded-full text-xs text-center border border-emerald-200 flex items-center justify-center gap-1.5">
                                <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                                <span>COMPLETED &amp; NEXT SCHEDULED</span>
                              </div>
                            )
                          ) : (
                            <div className="py-2 px-3 bg-slate-50 border border-slate-200 rounded-xl text-center flex items-center justify-between text-xs">
                              <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Status:</span>
                              <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase ${
                                job.status === 'IN_PROGRESS' ? 'bg-orange-100 text-orange-800' :
                                job.status === 'COMPLETED' ? 'bg-emerald-100 text-emerald-800' :
                                job.status === 'ASSIGNED' ? 'bg-purple-100 text-purple-800' : 'bg-slate-100 text-slate-700'
                              }`}>
                                {job.status.replace(/_/g, ' ')}
                              </span>
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          ) : (isManagerApp && mainTab === 'tomorrow') ? (
            /* MANAGER ONLY: TOMORROW SCHEDULED JOBS WITH ASSIGNED TECHNICIAN NAME & FULL DETAILS */
            <div className="space-y-3">
              <div className="bg-gradient-to-r from-[#5B21B6] via-[#4C1D95] to-[#2E1065] rounded-2xl px-4 py-3 text-white shadow-sm space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2.5">
                    <div className="w-9 h-9 rounded-xl bg-white/20 flex items-center justify-center shrink-0">
                      <Clock className="w-5 h-5 text-amber-300" />
                    </div>
                    <div>
                      <div className="text-[10px] font-bold text-purple-200 uppercase tracking-wider">Manager Tomorrow Operations Schedule</div>
                      <h3 className="text-sm font-black text-white">Tomorrow Scheduled Jobs &bull; {tomorrowStr}</h3>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-xl font-black text-amber-300">{tomorrowTodoJobs.length}</div>
                    <div className="text-[9px] uppercase font-bold text-purple-200">Tomorrow Jobs</div>
                  </div>
                </div>
              </div>

              {loading ? (
                <div className="p-8 text-center bg-white rounded-3xl border border-slate-200 shadow-sm mt-2 space-y-2">
                  <RefreshCw className="w-8 h-8 text-[#6D28D9] animate-spin mx-auto" />
                  <div className="font-bold text-slate-700 text-xs">Loading Tomorrow Scheduled Jobs...</div>
                </div>
              ) : tomorrowTodoJobs.length === 0 ? (
                <div className="p-8 text-center bg-white rounded-3xl border border-purple-100 shadow-sm mt-2 space-y-3">
                  <Calendar className="w-12 h-12 text-purple-400 mx-auto" />
                  <div className="font-black text-slate-800 text-sm">
                    No Jobs Scheduled for Tomorrow ({tomorrowStr})
                  </div>
                  <p className="text-xs text-slate-500">
                    When jobs are scheduled or postponed for tomorrow ({tomorrowStr}), they will appear here with their assigned technician.
                  </p>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
                  {tomorrowTodoJobs.map(job => {
                    const formattedPhone = job.customer_phone ? job.customer_phone.replace(/[^0-9]/g, '') : '';
                    const intlPhone = formattedPhone.startsWith('0')
                      ? '94' + formattedPhone.substring(1)
                      : formattedPhone.startsWith('94')
                        ? formattedPhone
                        : '94' + formattedPhone;

                    return (
                      <div
                        key={job.id}
                        onClick={() => setActiveJob(job)}
                        className="bg-white rounded-3xl border-2 border-purple-200/90 p-4 shadow-sm hover:shadow-md transition space-y-3 cursor-pointer relative overflow-hidden flex flex-col justify-between"
                      >
                        <div
                          className="absolute top-0 left-0 bottom-0 w-1.5"
                          style={{ backgroundColor: job.treatment_color || '#6D28D9' }}
                        ></div>

                        <div className="space-y-2.5">
                          <div className="flex items-start justify-between gap-2 pl-1.5">
                            <div className="min-w-0">
                              <h3 className="font-black text-slate-900 text-base leading-tight truncate">{job.customer_name}</h3>
                              <div className="text-[11px] text-slate-400 font-mono mt-0.5 flex items-center gap-1.5 flex-wrap">
                                <span>{job.job_code}</span>
                                <span className="px-2 py-0.5 rounded-md bg-purple-50 text-[#5B21B6] border border-purple-200 font-black text-[10px]">
                                  📆 Tomorrow ({tomorrowStr})
                                </span>
                              </div>
                            </div>
                            <span className="px-2.5 py-1 rounded-full text-[10px] font-black uppercase shrink-0 bg-purple-100 text-[#4C1D95] border border-purple-200">
                              {job.status}
                            </span>
                          </div>

                          {/* Assigned Technician Name Banner */}
                          <div className="pl-1.5">
                            {renderAssignedTechnicianBar(job)}
                          </div>

                          {/* Full Operational Details: Crew Count, Vehicle No, Machine Name */}
                          <div className="pl-1.5">
                            {renderOperationalDetailsGrid(job)}
                          </div>

                          <div className="space-y-1.5 text-xs text-slate-600 bg-purple-50/40 p-2.5 rounded-2xl border border-purple-100 pl-3 ml-1.5">
                            <div className="flex items-center gap-2">
                              <MapPin className="w-4 h-4 text-[#6D28D9] shrink-0" />
                              <span className="font-semibold text-slate-800 line-clamp-1">
                                {job.location_name || job.location_address || 'Main Location'}
                              </span>
                            </div>

                            <div className="flex items-center justify-between text-[11px] pt-1 border-t border-purple-100">
                              <div className="flex items-center gap-1.5 font-bold text-slate-700">
                                <Clock className="w-3.5 h-3.5 text-[#6D28D9]" />
                                <span>{job.scheduled_time || '09:00'} ({job.duration_minutes || 60}m)</span>
                              </div>

                              <span
                                style={{ backgroundColor: `${job.treatment_color || '#6D28D9'}20`, color: job.treatment_color || '#6D28D9' }}
                                className="px-2.5 py-0.5 rounded-lg font-black text-[11px]"
                              >
                                {job.treatment_code}{job.treatment_name ? ` • ${job.treatment_name}` : ''}
                              </span>
                            </div>
                          </div>
                        </div>

                        <div className="pt-1 pl-1.5 space-y-2" onClick={(e) => e.stopPropagation()}>
                          <div className="grid grid-cols-3 gap-1.5">
                            {job.customer_phone ? (
                              <a
                                href={`tel:${job.customer_phone}`}
                                className="flex items-center justify-center gap-1 py-2 bg-slate-100 hover:bg-slate-200 text-slate-800 font-bold rounded-xl text-xs transition"
                              >
                                <Phone className="w-3.5 h-3.5 text-emerald-600" />
                                <span>CALL</span>
                              </a>
                            ) : (
                              <div className="py-2 bg-slate-50 text-slate-400 font-bold rounded-xl text-[10px] text-center">NO PHONE</div>
                            )}

                            {job.customer_phone ? (
                              <a
                                href={`https://wa.me/${intlPhone}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="flex items-center justify-center gap-1 py-2 bg-emerald-50 hover:bg-emerald-100 text-emerald-800 font-bold rounded-xl text-xs transition border border-emerald-200/60"
                              >
                                <span className="text-emerald-600 font-bold text-xs">💬</span>
                                <span>CHAT</span>
                              </a>
                            ) : (
                              <div className="py-2 bg-slate-50 text-slate-400 font-bold rounded-xl text-[10px] text-center">NO WA</div>
                            )}

                            <button
                              onClick={(e) => openNavigation(job, e)}
                              className="flex items-center justify-center gap-1 py-2 bg-purple-50 hover:bg-purple-100 text-[#4C1D95] font-bold rounded-xl text-xs transition border border-purple-200/60 cursor-pointer"
                            >
                              <Navigation className="w-3.5 h-3.5 text-[#6D28D9]" />
                              <span>MAPS</span>
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          ) : mainTab === 'today_completed' ? (
            /* TODAY COMPLETED JOBS FEED WITH START/FINISH TIME & FULL DETAILS */
            <div className="space-y-3">
              <div className="bg-gradient-to-r from-emerald-700 via-teal-700 to-slate-900 rounded-3xl p-4 text-white shadow-md border border-emerald-600/30 flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <div className="w-10 h-10 rounded-2xl bg-emerald-400/20 border border-emerald-300/40 flex items-center justify-center">
                    <CheckCircle2 className="w-6 h-6 text-emerald-300" />
                  </div>
                  <div>
                    <div className="text-[11px] font-bold text-emerald-200 uppercase tracking-wider">Today's Achievements</div>
                    <h3 className="text-base font-black text-white">Completed Jobs Today &bull; {todayStr}</h3>
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-2xl font-black text-emerald-300">{todayCompletedJobs.length}</div>
                  <div className="text-[9px] uppercase font-bold text-emerald-200">Done Today</div>
                </div>
              </div>

              {todayCompletedJobs.length === 0 ? (
                <div className="p-8 text-center bg-white rounded-3xl border border-slate-200 shadow-xs">
                  <CheckCircle2 className="w-12 h-12 text-slate-300 mx-auto mb-2" />
                  <div className="font-black text-slate-800 text-sm">No Jobs Completed Today Yet</div>
                  <p className="text-xs text-slate-500 mt-1">
                    When jobs are completed today, they will appear here with start time, finish time, crew, vehicle, machine, and customer sign-off.
                  </p>
                </div>
              ) : (
                todayCompletedJobs.map(job => (
                  <div
                    key={job.id}
                    onClick={() => setActiveJob(job)}
                    className="bg-white rounded-3xl border border-emerald-200 p-4 shadow-xs hover:shadow-md transition space-y-3 cursor-pointer relative overflow-hidden"
                  >
                    <div className="absolute top-0 left-0 bottom-0 w-1.5 bg-emerald-500" />

                    <div className="flex items-start justify-between gap-2 pl-1.5">
                      <div>
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="text-[10px] font-mono font-bold text-slate-500">
                            {job.job_code || `#${job.id}`}
                          </span>
                          <span className="text-[10px] px-2 py-0.5 rounded-full font-black bg-emerald-50 text-emerald-700 border border-emerald-200 flex items-center gap-1">
                            <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                            <span>DONE • {job.scheduled_date || todayStr}</span>
                          </span>
                          {getAssignedTechName(job) && (
                            <span className="text-[10px] px-2 py-0.5 rounded-full font-black bg-indigo-50 text-indigo-800 border border-indigo-200">
                              👷 {getAssignedTechName(job)}
                            </span>
                          )}
                        </div>
                        <h3 className="font-black text-slate-900 text-base mt-1">
                          {job.customer_name}
                        </h3>
                      </div>

                      <span
                        className="inline-block px-2.5 py-1 rounded-lg text-[10px] font-black text-white shadow-2xs shrink-0"
                        style={{ backgroundColor: job.treatment_color || '#059669' }}
                      >
                        {job.treatment_code || 'TREATMENT'}
                      </span>
                    </div>

                    {/* Start Time & Finish Time Summary Row */}
                    <div className="pl-1.5 grid grid-cols-3 gap-1.5 text-[11px]">
                      <div className="p-2 rounded-xl bg-emerald-50/70 border border-emerald-200/70">
                        <div className="text-[9px] font-black uppercase text-emerald-700">Start Time</div>
                        <div className="font-mono font-black text-slate-900 mt-0.5">
                          {job.actual_start_time ? formatTimeOnlyDisplay(job.actual_start_time) : (job.scheduled_time || '09:00')}
                        </div>
                      </div>
                      <div className="p-2 rounded-xl bg-emerald-50/70 border border-emerald-200/70">
                        <div className="text-[9px] font-black uppercase text-emerald-700">Finish Time</div>
                        <div className="font-mono font-black text-slate-900 mt-0.5">
                          {job.actual_end_time || job.completed_at ? formatTimeOnlyDisplay(job.actual_end_time || job.completed_at) : 'Completed'}
                        </div>
                      </div>
                      <div className="p-2 rounded-xl bg-emerald-50/70 border border-emerald-200/70">
                        <div className="text-[9px] font-black uppercase text-emerald-700">Total Time</div>
                        <div className="font-mono font-black text-emerald-800 mt-0.5">
                          {formatDurationHuman(job.actual_start_time, job.actual_end_time || job.completed_at) || `${job.duration_minutes || 60}m`}
                        </div>
                      </div>
                    </div>

                    {/* Crew, Vehicle No, Machine Name */}
                    <div className="pl-1.5">
                      {renderOperationalDetailsGrid(job)}
                    </div>

                    <div className="pl-1.5 pt-1 border-t border-slate-100 flex items-center justify-between text-xs">
                      <div className="flex items-center gap-1.5 text-slate-600 truncate">
                        <MapPin className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                        <span className="truncate text-[11px] font-semibold">{job.location_name || job.location_address || 'Customer site'}</span>
                      </div>
                      <span className="px-2.5 py-1 bg-emerald-600 text-white rounded-lg text-[10px] font-black shrink-0">
                        View Full Details →
                      </span>
                    </div>
                  </div>
                ))
              )}
            </div>
          ) : (
            /* ALL-TIME COMPLETED JOBS FEED WITH FULL DETAILS */
            <div className="space-y-3">
              <div className="bg-gradient-to-r from-emerald-700 via-teal-700 to-slate-900 rounded-3xl p-4 text-white shadow-md border border-emerald-600/30 relative overflow-hidden">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="w-10 h-10 rounded-2xl bg-amber-400/20 border border-amber-300/40 flex items-center justify-center">
                      <Award className="w-6 h-6 text-amber-300" />
                    </div>
                    <div>
                      <div className="text-[11px] font-bold text-emerald-200 uppercase tracking-wider">Service Record</div>
                      <h3 className="text-base font-black text-white">All-Time Completed Jobs</h3>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-2xl font-black text-amber-300">{totalDoneCount}</div>
                    <div className="text-[9px] uppercase font-bold text-emerald-200">Jobs Done</div>
                  </div>
                </div>
              </div>

              <div className="relative">
                <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  type="text"
                  value={completedSearch}
                  onChange={(e) => setCompletedSearch(e.target.value)}
                  placeholder="Search completed jobs by customer, technician, phone..."
                  className="w-full pl-10 pr-9 py-2.5 bg-white border border-slate-200 rounded-2xl text-xs font-medium text-slate-900 focus:outline-hidden focus:ring-2 focus:ring-emerald-500 shadow-2xs"
                />
                {completedSearch && (
                  <button
                    type="button"
                    onClick={() => setCompletedSearch('')}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 text-xs font-bold cursor-pointer"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>

              {loadingCompleted ? (
                <div className="p-8 text-center bg-white rounded-3xl border border-slate-200 shadow-xs space-y-2">
                  <RefreshCw className="w-7 h-7 text-emerald-600 animate-spin mx-auto" />
                  <div className="font-bold text-slate-700 text-xs">Loading completed jobs history...</div>
                </div>
              ) : filteredCompletedJobs.length === 0 ? (
                <div className="p-8 text-center bg-white rounded-3xl border border-slate-200 shadow-xs">
                  <Award className="w-12 h-12 text-slate-300 mx-auto mb-2" />
                  <div className="font-black text-slate-800 text-sm">
                    {completedSearch ? 'No matching completed jobs' : 'No completed jobs yet'}
                  </div>
                </div>
              ) : (
                filteredCompletedJobs.map(job => (
                  <div
                    key={job.id}
                    onClick={() => setActiveJob(job)}
                    className="bg-white rounded-3xl border border-emerald-200 p-4 shadow-xs hover:shadow-md transition space-y-3 cursor-pointer relative overflow-hidden"
                  >
                    <div className="absolute top-0 left-0 bottom-0 w-1.5 bg-emerald-500" />
                    <div className="flex items-start justify-between gap-2 pl-1.5">
                      <div>
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="text-[10px] font-mono font-bold text-slate-500">
                            {job.job_code || `#${job.id}`}
                          </span>
                          <span className="text-[10px] px-2 py-0.5 rounded-full font-black bg-emerald-50 text-emerald-700 border border-emerald-200 flex items-center gap-1">
                            <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                            <span>DATE: {String(job.scheduled_date || job.completed_at || '').substring(0, 10)}</span>
                          </span>
                          {getAssignedTechName(job) && (
                            <span className="text-[10px] px-2 py-0.5 rounded-full font-black bg-indigo-50 text-indigo-800 border border-indigo-200">
                              👷 {getAssignedTechName(job)}
                            </span>
                          )}
                        </div>
                        <h3 className="font-black text-slate-900 text-base mt-1">
                          {job.customer_name}
                        </h3>
                      </div>

                      <span
                        className="inline-block px-2.5 py-1 rounded-lg text-[10px] font-black text-white shadow-2xs shrink-0"
                        style={{ backgroundColor: job.treatment_color || '#059669' }}
                      >
                        {job.treatment_code || 'TREATMENT'}
                      </span>
                    </div>

                    {/* Start Time & Finish Time Row */}
                    <div className="pl-1.5 grid grid-cols-3 gap-1.5 text-[11px]">
                      <div className="p-2 rounded-xl bg-emerald-50/70 border border-emerald-200/70">
                        <div className="text-[9px] font-black uppercase text-emerald-700">Start Time</div>
                        <div className="font-mono font-black text-slate-900 mt-0.5">
                          {job.actual_start_time ? formatTimeOnlyDisplay(job.actual_start_time) : (job.scheduled_time || '09:00')}
                        </div>
                      </div>
                      <div className="p-2 rounded-xl bg-emerald-50/70 border border-emerald-200/70">
                        <div className="text-[9px] font-black uppercase text-emerald-700">Finish Time</div>
                        <div className="font-mono font-black text-slate-900 mt-0.5">
                          {job.actual_end_time || job.completed_at ? formatTimeOnlyDisplay(job.actual_end_time || job.completed_at) : 'Completed'}
                        </div>
                      </div>
                      <div className="p-2 rounded-xl bg-emerald-50/70 border border-emerald-200/70">
                        <div className="text-[9px] font-black uppercase text-emerald-700">Service Date</div>
                        <div className="font-mono font-black text-emerald-800 mt-0.5">
                          {String(job.scheduled_date || job.completed_at || '').substring(0, 10)}
                        </div>
                      </div>
                    </div>

                    {/* Crew, Vehicle No, Machine Name */}
                    <div className="pl-1.5">
                      {renderOperationalDetailsGrid(job)}
                    </div>

                    <div className="pl-1.5 pt-1 border-t border-slate-100 flex items-center justify-between text-xs">
                      <div className="flex items-center gap-1.5 text-slate-600 truncate">
                        <MapPin className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                        <span className="truncate text-[11px] font-semibold">{job.location_name || job.location_address || 'Customer site'}</span>
                      </div>
                      <span className="px-2.5 py-1 bg-emerald-600 text-white rounded-lg text-[10px] font-black shrink-0">
                        View Full Details →
                      </span>
                    </div>
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      )}

      {/* VIEW 2: JOB FULL DETAILS VIEW (ACTIVE OR COMPLETED) */}
      {activeJob && (
        <div className="p-3 sm:p-4 space-y-3.5 pb-36 sm:pb-40">
          {/* Top Quick Action Banner so technicians can Start or Finish immediately without scrolling */}
          {!isManagerApp && activeJob.status !== 'COMPLETED' && (
            isJobScheduledAfterToday(activeJob) ? (
              <div className="p-3 rounded-2xl bg-amber-50 border border-amber-200 flex items-center gap-2.5 text-xs text-amber-900">
                <Lock className="w-4 h-4 text-amber-700 shrink-0" />
                <span>Job locked until scheduled date: <strong>{getJobEffectiveDate(activeJob)}</strong></span>
              </div>
            ) : activeJob.status !== 'IN_PROGRESS' ? (
              <div className="bg-gradient-to-r from-orange-500 via-amber-500 to-orange-600 rounded-2xl p-3.5 sm:p-4 text-white shadow-lg shadow-orange-500/25 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-[10px] font-black uppercase tracking-wider text-orange-100 flex items-center gap-1">
                    <Play className="w-3.5 h-3.5 fill-current" /> Ready to Start Service
                  </div>
                  <div className="text-xs sm:text-sm font-black text-white truncate">
                    Tap to Start Job &amp; Run Live Timer
                  </div>
                </div>
                <button
                  onClick={(e) => handleStartJob(activeJob.id, e, activeJob)}
                  className="px-4 py-2.5 bg-white text-orange-600 hover:bg-orange-50 active:scale-95 font-black rounded-xl text-xs sm:text-sm flex items-center gap-1.5 shadow-md transition cursor-pointer shrink-0 min-h-[40px]"
                >
                  <Play className="w-4 h-4 fill-current" /> START NOW
                </button>
              </div>
            ) : (
              <div className="bg-gradient-to-r from-emerald-600 via-teal-600 to-emerald-700 rounded-2xl p-3.5 sm:p-4 text-white shadow-lg shadow-emerald-600/25 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-[10px] font-black uppercase tracking-wider text-emerald-100 flex items-center gap-1">
                    <Clock className="w-3.5 h-3.5" /> Service In Progress
                  </div>
                  <div className="text-xs sm:text-sm font-black text-white truncate">
                    Finished? Tap to complete &amp; sign
                  </div>
                </div>
                <button
                  onClick={(e) => handleOpenComplete(activeJob, e)}
                  className="px-4 py-2.5 bg-white text-emerald-700 hover:bg-emerald-50 active:scale-95 font-black rounded-xl text-xs sm:text-sm flex items-center gap-1.5 shadow-md transition cursor-pointer shrink-0 min-h-[40px]"
                >
                  <CheckCircle2 className="w-4 h-4" /> FINISH &amp; SIGN
                </button>
              </div>
            )
          )}

          {/* Live Work Timer Banner at top of Full Details if Job is IN_PROGRESS */}
          {activeJob.status === 'IN_PROGRESS' && renderLiveWorkTimer(activeJob)}

          <div className="bg-white rounded-3xl border border-purple-100 p-4 sm:p-5 shadow-md space-y-4 text-xs">
            {/* Job Code, Scheduled Date & Status */}
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-mono text-slate-600 font-black text-xs bg-slate-100 px-2.5 py-1 rounded-lg">
                  {activeJob.job_code}
                </span>
                <span className="px-2.5 py-1 rounded-lg bg-purple-50 text-[#4C1D95] border border-purple-200 font-black text-xs flex items-center gap-1">
                  <Calendar className="w-3.5 h-3.5 text-[#6D28D9]" />
                  <span>Date: {activeJob.scheduled_date}</span>
                </span>
              </div>
              <span className={`px-3 py-1 rounded-full font-black text-[11px] uppercase ${
                activeJob.status === 'COMPLETED'
                  ? 'bg-emerald-100 text-emerald-800 border border-emerald-300'
                  : activeJob.status === 'IN_PROGRESS'
                    ? 'bg-amber-100 text-amber-900 border border-amber-300 animate-pulse'
                    : 'bg-slate-100 text-slate-800'
              }`}>
                {activeJob.status}
              </span>
            </div>

            <div>
              <div className="text-[10px] font-black uppercase tracking-wider text-slate-400">Customer Name</div>
              <h2 className="text-lg sm:text-xl font-black text-slate-900">{activeJob.customer_name}</h2>
              {activeJob.customer_code && (
                <div className="text-[11px] font-mono text-slate-500">Customer Code: {activeJob.customer_code}</div>
              )}
            </div>

            {/* Assigned Technician Info */}
            {renderAssignedTechnicianBar(activeJob)}

            {/* Full Operational Dispatch Details Box: Crew / How Many People, Vehicle No, Machine Name */}
            <div className="p-3.5 rounded-2xl bg-gradient-to-br from-purple-50/80 via-white to-orange-50/50 border-2 border-purple-100 space-y-3">
              <div className="text-[10px] font-black uppercase tracking-widest text-[#4C1D95] flex items-center gap-1.5">
                <Briefcase className="w-3.5 h-3.5 text-[#F97316]" />
                <span>Full Job Dispatch &amp; Equipment Details</span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                {/* How Many People Come */}
                <div className="p-3 rounded-xl bg-white border border-purple-100 shadow-2xs space-y-1">
                  <div className="flex items-center gap-1.5 text-[10px] font-black uppercase text-slate-500">
                    <Users className="w-3.5 h-3.5 text-[#6D28D9]" />
                    <span>How Many People Come</span>
                  </div>
                  <div className="text-sm font-black text-slate-900">
                    {activeJob.crew_count || 1} {Number(activeJob.crew_count || 1) === 1 ? 'Person (Crew)' : 'People (Crew)'}
                  </div>
                  {activeJob.team_members && (
                    <div className="text-[11px] font-semibold text-purple-800">
                      Team: {activeJob.team_members}
                    </div>
                  )}
                </div>

                {/* Vehicle No */}
                <div className="p-3 rounded-xl bg-white border border-purple-100 shadow-2xs space-y-1">
                  <div className="flex items-center gap-1.5 text-[10px] font-black uppercase text-slate-500">
                    <Truck className="w-3.5 h-3.5 text-[#F97316]" />
                    <span>Vehicle No</span>
                  </div>
                  <div className="text-sm font-black text-slate-900">
                    {activeJob.vehicle_no || activeJob.vehicle_number || 'Not Assigned'}
                  </div>
                  {activeJob.vehicle_type && (
                    <div className="text-[11px] font-semibold text-orange-700">
                      Type: {activeJob.vehicle_type}
                    </div>
                  )}
                </div>

                {/* Machine Name */}
                <div className="p-3 rounded-xl bg-white border border-purple-100 shadow-2xs space-y-1">
                  <div className="flex items-center gap-1.5 text-[10px] font-black uppercase text-slate-500">
                    <Wrench className="w-3.5 h-3.5 text-emerald-600" />
                    <span>Machine Name</span>
                  </div>
                  <div className="text-sm font-black text-slate-900">
                    {activeJob.machine_name || activeJob.machine_type || 'Standard Equipment'}
                  </div>
                </div>
              </div>

              {/* Treatment, Scheduled Date & Scheduled Time */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 pt-1">
                <div className="p-3 bg-white rounded-xl border border-purple-100">
                  <span className="text-slate-400 uppercase font-black text-[9px]">Treatment Type &amp; Name</span>
                  <div className="font-black text-slate-900 text-xs mt-0.5">
                    {activeJob.treatment_code}{activeJob.treatment_name ? ` — ${activeJob.treatment_name}` : ''}
                  </div>
                </div>
                <div className="p-3 bg-white rounded-xl border border-purple-100">
                  <span className="text-slate-400 uppercase font-black text-[9px]">Scheduled Date &amp; Time</span>
                  <div className="font-black text-slate-900 text-xs mt-0.5">
                    {activeJob.scheduled_date} at {activeJob.scheduled_time || '09:00'} ({activeJob.duration_minutes || 60} mins)
                  </div>
                </div>
              </div>
            </div>

            {/* Start Time & Finish Time Box (Shown whenever job has started or finished) */}
            {(activeJob.actual_start_time || activeJob.actual_end_time || activeJob.completed_at) && (
              <div className="p-3.5 rounded-2xl bg-emerald-50/80 border-2 border-emerald-200 space-y-2.5">
                <div className="text-[10px] font-black uppercase tracking-widest text-emerald-900 flex items-center gap-1.5">
                  <Clock className="w-3.5 h-3.5 text-emerald-600" />
                  <span>Job Work Start &amp; Finish Time Record</span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  <div className="p-2.5 rounded-xl bg-white border border-emerald-200">
                    <div className="text-[9px] font-black uppercase text-emerald-700">Work Start Date &amp; Time</div>
                    <div className="font-mono font-black text-slate-900 text-xs mt-0.5">
                      {activeJob.actual_start_time ? formatDateTimeDisplay(activeJob.actual_start_time) : `${activeJob.scheduled_date} • ${activeJob.scheduled_time || '09:00'}`}
                    </div>
                  </div>
                  <div className="p-2.5 rounded-xl bg-white border border-emerald-200">
                    <div className="text-[9px] font-black uppercase text-emerald-700">Work Finish Date &amp; Time</div>
                    <div className="font-mono font-black text-slate-900 text-xs mt-0.5">
                      {activeJob.actual_end_time || activeJob.completed_at
                        ? formatDateTimeDisplay(activeJob.actual_end_time || activeJob.completed_at)
                        : 'In Progress (Running)'}
                    </div>
                  </div>
                  <div className="p-2.5 rounded-xl bg-white border border-emerald-200">
                    <div className="text-[9px] font-black uppercase text-emerald-700">Total Work Time</div>
                    <div className="font-mono font-black text-emerald-800 text-xs mt-0.5">
                      {activeJob.status === 'IN_PROGRESS'
                        ? formatElapsedHms(activeJob.actual_start_time, nowTick)
                        : (formatDurationHuman(activeJob.actual_start_time, activeJob.actual_end_time || activeJob.completed_at) || `${activeJob.duration_minutes || 60} mins`)}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Contact Person & Direct Call */}
            {activeJob.customer_phone && (
              <div className="p-3 bg-emerald-50 rounded-xl border border-emerald-100 flex items-center justify-between">
                <div>
                  <div className="font-bold text-slate-900">{activeJob.contact_person || 'Customer Contact'}</div>
                  <div className="text-emerald-700 font-mono mt-0.5">{activeJob.customer_phone}</div>
                </div>
                <a
                  href={`tel:${activeJob.customer_phone}`}
                  className="px-3.5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-black rounded-xl flex items-center gap-1.5 shadow-xs"
                >
                  <Phone className="w-3.5 h-3.5" /> Call Customer
                </a>
              </div>
            )}

            {/* Location & Navigation */}
            <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 space-y-2">
              <div className="flex items-center gap-1.5 font-black text-slate-900">
                <MapPin className="w-4 h-4 text-emerald-600 shrink-0" />
                <span>{activeJob.location_name || 'Main Service Location'}</span>
              </div>
              <div className="text-slate-600 font-medium">{activeJob.location_address || activeJob.customer_address || activeJob.location_name}</div>
              <button
                onClick={(e) => openNavigation(activeJob, e)}
                className="w-full py-2.5 bg-blue-50 hover:bg-blue-100 text-blue-700 font-black rounded-xl flex items-center justify-center gap-1.5 cursor-pointer border border-blue-200"
              >
                <Navigation className="w-4 h-4" /> Open Location in Google Maps
              </button>
            </div>

            {/* Special Instructions */}
            {activeJob.special_instructions && (
              <div className="p-3 bg-amber-50 rounded-xl border border-amber-200">
                <span className="font-black text-amber-900 uppercase text-[10px]">Special Instructions</span>
                <p className="mt-1 text-amber-800 font-medium">{activeJob.special_instructions}</p>
              </div>
            )}
          </div>

          {/* Action Buttons or Completed Full Summary for Details View */}
          <div className="space-y-2.5">
            {activeJob.status === 'COMPLETED' ? (
              <div className="p-4 bg-emerald-50 rounded-3xl border-2 border-emerald-200 space-y-3 text-xs">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <div className="flex items-center gap-2 font-black text-emerald-900 text-sm">
                    <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
                    <span>{isManagerApp ? 'Manager Record • Job Completed' : 'Job Finished & Completed Successfully'}</span>
                  </div>
                  <span className="px-2.5 py-1 rounded-lg bg-white text-emerald-800 border border-emerald-200 font-mono font-black text-[11px]">
                    Date: {String(activeJob.scheduled_date || activeJob.completed_at || '').substring(0, 10)}
                  </span>
                </div>

                {activeJob.technician_notes && (
                  <div className="p-3 bg-white rounded-xl border border-emerald-100 text-slate-700 space-y-1">
                    <div className="font-black text-slate-900 text-[11px]">Technician Service Notes / Findings:</div>
                    <div className="text-xs leading-relaxed">{activeJob.technician_notes}</div>
                  </div>
                )}

                {activeJob.customer_signature && (
                  <div className="p-3 bg-white rounded-xl border border-emerald-100 space-y-1.5">
                    <div className="font-black text-slate-900 text-[11px]">Customer Touch Sign-off:</div>
                    <img src={activeJob.customer_signature} alt="Customer Signature" className="max-h-24 object-contain mx-auto border border-slate-100 rounded-lg p-1 bg-slate-50" />
                  </div>
                )}
              </div>
            ) : isManagerApp ? (
              /* MANAGER APP: Only display job info summary, no technician action buttons */
              <div className="p-4 bg-purple-50/70 rounded-2xl border border-purple-200 text-xs space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-[#4C1D95] uppercase tracking-wider text-[11px] flex items-center gap-1.5">
                    <CheckCircle2 className="w-4 h-4 text-[#6D28D9] shrink-0" />
                    <span>Manager Overview • Job Status</span>
                  </span>
                  <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase ${
                    activeJob.status === 'IN_PROGRESS' ? 'bg-orange-100 text-orange-800' :
                    activeJob.status === 'ASSIGNED' ? 'bg-purple-100 text-purple-800' : 'bg-slate-100 text-slate-700'
                  }`}>
                    {activeJob.status.replace(/_/g, ' ')}
                  </span>
                </div>
                <p className="text-slate-600 text-[11px]">
                  Job start, completion, and sign-off are handled by the assigned field technician.
                </p>
              </div>
            ) : isJobScheduledAfterToday(activeJob) ? (
              <div className="p-4 bg-indigo-50 rounded-2xl border-2 border-indigo-200 space-y-3 text-xs">
                <div className="flex items-start gap-2.5">
                  <div className="w-9 h-9 rounded-xl bg-amber-100 border border-amber-300 flex items-center justify-center shrink-0">
                    <Lock className="w-5 h-5 text-amber-700" />
                  </div>
                  <div>
                    <div className="font-black text-indigo-950 text-sm">
                      Scheduled for {getJobEffectiveDate(activeJob)}
                    </div>
                    <p className="text-indigo-800 text-[11px] mt-0.5 leading-relaxed">
                      This job is scheduled for {getJobEffectiveDate(activeJob)}.
                    </p>
                  </div>
                </div>
              </div>
            ) : (
              <>
                {activeJob.status !== 'IN_PROGRESS' ? (
                  <button
                    onClick={(e) => handleStartJob(activeJob.id, e, activeJob)}
                    className="w-full py-4 bg-gradient-to-r from-[#F97316] to-[#EA580C] hover:from-[#EA580C] hover:to-[#C2410C] text-white font-black rounded-2xl flex items-center justify-center gap-2 shadow-lg shadow-orange-600/30 text-sm active:scale-98 transition cursor-pointer min-h-[50px]"
                  >
                    <Play className="w-5 h-5 text-white" /> START JOB NOW (START TIMER)
                  </button>
                ) : (
                  <button
                    onClick={(e) => handleOpenComplete(activeJob, e)}
                    className="w-full py-4 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white font-black rounded-2xl flex items-center justify-center gap-2 shadow-lg shadow-emerald-200 text-sm cursor-pointer min-h-[50px]"
                  >
                    <CheckCircle2 className="w-5 h-5" /> FINISH WORK &amp; COMPLETE JOB
                  </button>
                )}

                <button
                  onClick={(e) => handleOpenPostpone(activeJob, e)}
                  className="w-full py-3.5 bg-slate-200 hover:bg-slate-300 text-slate-800 font-bold rounded-2xl flex items-center justify-center gap-2 cursor-pointer transition min-h-[44px]"
                >
                  <Clock className="w-4 h-4" /> POSTPONE / RESCHEDULE
                </button>
              </>
            )}

            {/* Full Job Details Export Bar: PDF Download, WhatsApp Share & Print */}
            <div className="p-3.5 bg-white rounded-2xl border border-purple-100 shadow-xs space-y-2">
              <div className="text-[10px] font-black uppercase tracking-wider text-slate-500">
                Export &amp; Share Full Job Details Report
              </div>
              <div className="grid grid-cols-3 gap-2">
                <button
                  type="button"
                  onClick={() => downloadJobPdfReport(activeJob)}
                  className="py-2.5 px-2 rounded-xl bg-[#4C1D95] hover:bg-[#3B0764] text-white font-black text-xs flex items-center justify-center gap-1.5 shadow-xs transition cursor-pointer min-h-[40px]"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>PDF</span>
                </button>
                <button
                  type="button"
                  onClick={() => shareJobOnWhatsApp(activeJob, false)}
                  className="py-2.5 px-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-black text-xs flex items-center justify-center gap-1.5 shadow-xs transition cursor-pointer min-h-[40px]"
                >
                  <Share2 className="w-3.5 h-3.5" />
                  <span>WhatsApp</span>
                </button>
                <button
                  type="button"
                  onClick={() => printJobReport(activeJob)}
                  className="py-2.5 px-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-800 border border-slate-300 font-black text-xs flex items-center justify-center gap-1.5 transition cursor-pointer min-h-[40px]"
                >
                  <Printer className="w-3.5 h-3.5" />
                  <span>Print</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* MOBILE JOB COMPLETION MODAL */}
      {showCompleteModal && jobToComplete && (
        <div className="fixed inset-0 bg-slate-950/70 backdrop-blur-xs z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
          <form
            onSubmit={handleCompleteSubmit}
            className="bg-white w-full max-w-lg rounded-t-3xl sm:rounded-3xl shadow-2xl max-h-[92dvh] sm:max-h-[88dvh] flex flex-col overflow-hidden"
          >
            {/* 1. FIXED HEADER */}
            <div className="shrink-0 px-4 py-3 sm:px-5 sm:py-3.5 border-b border-slate-100 flex items-center justify-between bg-white">
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="w-8 h-8 rounded-xl bg-emerald-100 text-emerald-700 flex items-center justify-center shrink-0">
                  <CheckCircle2 className="w-5 h-5 text-emerald-600" />
                </div>
                <div className="min-w-0">
                  <h2 className="font-black text-slate-900 text-sm sm:text-base leading-tight truncate">
                    Finish Work &amp; Complete Job
                  </h2>
                  <div className="text-[11px] text-slate-500 font-medium truncate">
                    {jobToComplete.customer_name} • {jobToComplete.job_code}
                  </div>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowCompleteModal(false)}
                className="text-slate-400 hover:text-slate-700 p-1.5 rounded-xl hover:bg-slate-100 transition cursor-pointer shrink-0"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* 2. SCROLLABLE BODY */}
            <div className="flex-1 overflow-y-auto overscroll-contain p-4 sm:p-5 space-y-4 text-xs">
              {/* Work Time Summary Box */}
              <div className="p-3 sm:p-3.5 rounded-2xl bg-slate-900 text-white space-y-2 text-xs border border-emerald-400/40">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-black uppercase tracking-wider text-emerald-300 flex items-center gap-1">
                    <Timer className="w-3.5 h-3.5 text-emerald-400" />
                    <span>Work Time Summary ({jobToComplete.scheduled_date || todayStr})</span>
                  </span>
                  <span className="px-2 py-0.5 rounded-md bg-amber-400 text-slate-950 font-mono font-black text-xs">
                    {formatElapsedHms(jobToComplete.actual_start_time || new Date().toISOString(), nowTick)}
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-2 pt-1 border-t border-white/15">
                  <div>
                    <div className="text-[9px] uppercase text-slate-400 font-bold">Start Time</div>
                    <div className="font-mono font-black text-emerald-300 text-xs">
                      {formatTimeOnlyDisplay(jobToComplete.actual_start_time || new Date(nowTick))}
                    </div>
                  </div>
                  <div>
                    <div className="text-[9px] uppercase text-slate-400 font-bold">Finish Time (Now)</div>
                    <div className="font-mono font-black text-amber-300 text-xs">
                      {formatTimeOnlyDisplay(new Date(nowTick))}
                    </div>
                  </div>
                </div>
              </div>

              {/* Service Notes */}
              <div>
                <label className="font-bold text-slate-700 block mb-1">Service Notes / Findings</label>
                <textarea
                  rows={2}
                  value={completionNotes}
                  onChange={(e) => setCompletionNotes(e.target.value)}
                  placeholder="Record treatment chemical dosage, pest activity, infested zones..."
                  className="w-full p-2.5 bg-slate-50 rounded-xl border border-slate-200 focus:outline-hidden text-xs sm:text-sm"
                />
              </div>

              {/* Customer Touch Sign-off Section */}
              <div className="pt-1">
                <div className="flex items-center justify-between mb-1.5">
                  <label className="font-bold text-slate-700 flex items-center gap-1.5">
                    <PenTool className="w-4 h-4 text-emerald-600" /> Customer Touch Sign-off
                  </label>
                  {customerSignature && (
                    <button
                      type="button"
                      onClick={() => setShowSignaturePad(true)}
                      className="text-xs font-bold text-emerald-600 hover:underline cursor-pointer"
                    >
                      Change Signature
                    </button>
                  )}
                </div>

                {customerSignature ? (
                  <div className="border-2 border-emerald-300 rounded-2xl p-2.5 bg-emerald-50/50 flex flex-col items-center gap-1.5">
                    <img src={customerSignature} alt="Customer signature" className="max-h-20 object-contain mx-auto" />
                    <div className="text-[10px] font-bold text-emerald-700 flex items-center gap-1">
                      <Check className="w-3.5 h-3.5" /> Signature captured successfully
                    </div>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setShowSignaturePad(true)}
                    className="w-full p-4 border-2 border-dashed border-emerald-300 hover:border-emerald-500 bg-emerald-50/40 hover:bg-emerald-50/80 rounded-2xl text-center transition cursor-pointer active:scale-99 flex flex-col items-center justify-center gap-1.5"
                  >
                    <div className="w-10 h-10 rounded-full bg-emerald-100 text-emerald-700 flex items-center justify-center shadow-xs">
                      <PenTool className="w-5 h-5" />
                    </div>
                    <span className="font-black text-slate-800 text-xs sm:text-sm">
                      ✍️ Tap Here to Open Customer Touch Sign Screen
                    </span>
                    <span className="text-[10px] text-slate-500">
                      Client signs with finger directly on phone screen
                    </span>
                  </button>
                )}
              </div>
            </div>

            {/* 3. FIXED STICKY ACTION FOOTER */}
            <div className="shrink-0 bg-slate-50 border-t border-slate-200 p-3 sm:p-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] flex gap-2.5 shadow-md">
              <button
                type="button"
                onClick={() => setShowCompleteModal(false)}
                className="w-1/3 py-3 bg-white hover:bg-slate-100 text-slate-700 font-bold rounded-xl border border-slate-200 cursor-pointer text-xs sm:text-sm active:scale-98 transition min-h-[44px]"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={submitting}
                className="w-2/3 py-3 bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 text-white font-black rounded-xl shadow-lg shadow-emerald-600/20 cursor-pointer text-xs sm:text-sm flex items-center justify-center gap-2 active:scale-98 transition disabled:opacity-50 min-h-[44px]"
              >
                {submitting ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin" /> Saving...
                  </>
                ) : (
                  <>
                    <CheckCircle2 className="w-4 h-4" /> SAVE &amp; FINISH JOB
                  </>
                )}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* DEDICATED FULL-SCREEN/HIGH-PRIORITY CUSTOMER TOUCH SIGN-OFF MODAL */}
      {showSignaturePad && (
        <div className="fixed inset-0 bg-slate-950/85 backdrop-blur-sm z-[70] flex items-center justify-center p-3 sm:p-4 animate-fade-in">
          <div className="w-full max-w-lg">
            <SignaturePad
              onSave={(dataUrl) => {
                setCustomerSignature(dataUrl);
                setShowSignaturePad(false);
              }}
              onCancel={() => setShowSignaturePad(false)}
              title={`Customer Sign: ${jobToComplete?.customer_name || activeJob?.customer_name || 'Client'}`}
            />
          </div>
        </div>
      )}

      {/* MOBILE POSTPONE MODAL */}
      {showPostponeModal && (
        <div className="fixed inset-0 bg-slate-950/70 backdrop-blur-xs z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
          <form
            onSubmit={handlePostponeSubmit}
            className="bg-white w-full max-w-md rounded-t-3xl sm:rounded-2xl shadow-2xl max-h-[90dvh] flex flex-col overflow-hidden"
          >
            {/* Header */}
            <div className="shrink-0 px-4 py-3 sm:px-5 border-b border-slate-100 flex items-center justify-between bg-white">
              <h2 className="font-black text-slate-900 text-sm sm:text-base flex items-center gap-2">
                <Clock className="w-4 h-4 text-purple-600" />
                <span>Postpone Service</span>
              </h2>
              <button
                type="button"
                onClick={() => setShowPostponeModal(false)}
                className="text-slate-400 hover:text-slate-700 p-1.5 rounded-xl hover:bg-slate-100 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Scrollable Body */}
            <div className="flex-1 overflow-y-auto overscroll-contain p-4 sm:p-5 space-y-3.5 text-xs">
              <div>
                <label className="font-bold text-slate-700 block mb-1">Reschedule To Date *</label>
                <input
                  type="date"
                  required
                  value={postponeDate}
                  onChange={(e) => setPostponeDate(e.target.value)}
                  className="w-full p-2.5 bg-slate-50 rounded-xl border border-slate-200 focus:outline-hidden text-xs sm:text-sm font-semibold"
                />
              </div>

              <div>
                <label className="font-bold text-slate-700 block mb-1">Reason</label>
                <textarea
                  rows={2}
                  value={postponeReason}
                  onChange={(e) => setPostponeReason(e.target.value)}
                  placeholder="e.g. Factory closed, customer request"
                  className="w-full p-2.5 bg-slate-50 rounded-xl border border-slate-200 focus:outline-hidden text-xs sm:text-sm"
                />
              </div>
            </div>

            {/* Sticky Footer */}
            <div className="shrink-0 bg-slate-50 border-t border-slate-200 p-3 sm:p-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] flex gap-2.5">
              <button
                type="button"
                onClick={() => setShowPostponeModal(false)}
                className="w-1/3 py-3 bg-white text-slate-700 font-bold rounded-xl border border-slate-200 text-xs sm:text-sm cursor-pointer min-h-[44px]"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="w-2/3 py-3 bg-purple-700 hover:bg-purple-800 text-white font-black rounded-xl text-xs sm:text-sm shadow-md cursor-pointer min-h-[44px]"
              >
                CONFIRM POSTPONE
              </button>
            </div>
          </form>
        </div>
      )}

      {/* PWA Universal Install Modal for Android & iPhone */}
      <InstallAppModal
        isOpen={showInstallModal || showIosGuide}
        onClose={() => {
          setShowInstallModal(false);
          setShowIosGuide(false);
        }}
        deferredPrompt={deferredPrompt || (typeof window !== 'undefined' ? window.__deferredPrompt : null)}
        onInstalled={() => setIsStandalone(true)}
      />

      {/* 1-Time Permanent Phone Sign-In Modal */}
      {showLoginModal && (
        <TechLoginModal
          initialRole={isManagerApp ? 'MANAGER' : 'TECHNICIAN'}
          onSuccess={(sess) => {
            setTechSession(sess);
            setShowLoginModal(false);
            if (!isManagerApp && sess?.id && sess?.role !== 'MANAGER') {
              handleTechChange(String(sess.id));
            }
          }}
          onClose={() => setShowLoginModal(false)}
        />
      )}

    </div>
  );
}
