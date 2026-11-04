import React, { useState, useEffect } from 'react';
import { Users, MapPin, Phone, Mail, Building, Edit, X, Check, FileText, Compass, AlertCircle, Trash2 } from 'lucide-react';
import { updateCustomer } from '../api';
import GpsCoordinatePicker from './GpsCoordinatePicker';

export default function EditCustomerModal({ isOpen, customer, onClose, onCustomerUpdated, onDelete }) {
  const [formData, setFormData] = useState({
    name: '',
    contact_person: '',
    phone: '',
    email: '',
    location: '',
    address: '',
    latitude: '',
    longitude: '',
    special_instructions: '',
    is_active: 1
  });

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (customer) {
      setFormData({
        name: customer.name || '',
        contact_person: customer.contact_person || '',
        phone: customer.phone || '',
        email: customer.email || '',
        location: customer.location || '',
        address: customer.address || '',
        latitude: customer.latitude || '',
        longitude: customer.longitude || '',
        special_instructions: customer.special_instructions || '',
        is_active: customer.is_active !== undefined ? customer.is_active : 1
      });
      setError(null);
    }
  }, [customer, isOpen]);

  if (!isOpen || !customer) return null;

  const handleChange = (e) => {
    const { name, value, type, checked } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: type === 'checkbox' ? (checked ? 1 : 0) : value
    }));
    if (error) setError(null);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!formData.name.trim()) {
      setError('Customer name is required');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const res = await updateCustomer(customer.id, formData);
      if (res.success && res.customer) {
        if (onCustomerUpdated) onCustomerUpdated(res.customer);
        onClose();
      }
    } catch (err) {
      setError(err.message || 'Failed to update customer details');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs z-50 flex items-center justify-center p-4 animate-in fade-in duration-200">
      <div className="bg-white rounded-3xl shadow-2xl border border-slate-200 w-full max-w-2xl overflow-hidden flex flex-col max-h-[92vh]">
        
        {/* Modal Header */}
        <div className="p-6 bg-gradient-to-r from-blue-600 via-indigo-600 to-purple-700 text-white flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-2xl bg-white/10 backdrop-blur-md border border-white/20 flex items-center justify-center shadow-lg">
              <Edit className="w-6 h-6 text-white" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-[11px] font-mono font-bold bg-white/20 text-white px-2 py-0.5 rounded">
                  {customer.customer_code}
                </span>
                <h2 className="text-lg font-black tracking-tight">Edit Customer Details</h2>
              </div>
              <p className="text-xs text-blue-100 mt-0.5">
                Update account data, direct contacts, addresses, GPS coordinates and instructions.
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 text-white/80 hover:text-white rounded-xl hover:bg-white/10 transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Error Alert */}
        {error && (
          <div className="mx-6 mt-4 p-3 bg-rose-50 border border-rose-200 rounded-xl text-rose-800 text-xs flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {/* Form Body */}
        <form id="edit-customer-form" onSubmit={handleSubmit} className="p-6 space-y-5 overflow-y-auto flex-1 text-xs">
          
          {/* Section 1: Customer Name and Status */}
          <div>
            <div className="flex items-center justify-between text-slate-400 font-bold uppercase tracking-wider text-[11px] mb-3 pb-1 border-b border-slate-100">
              <span className="flex items-center gap-2">
                <Building className="w-3.5 h-3.5 text-blue-600" />
                Customer Account Information
              </span>
              <label className="flex items-center gap-2 cursor-pointer lowercase text-slate-700 font-semibold">
                <input
                  type="checkbox"
                  name="is_active"
                  checked={formData.is_active === 1}
                  onChange={handleChange}
                  className="rounded text-emerald-600 focus:ring-emerald-500 w-4 h-4"
                />
                <span className="text-xs font-bold text-slate-800">Account Active</span>
              </label>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="sm:col-span-2 space-y-1">
                <label className="font-bold text-slate-800">
                  Customer / Business Name <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  name="name"
                  value={formData.name}
                  onChange={handleChange}
                  required
                  className="w-full bg-slate-50 text-sm font-semibold px-3.5 py-2.5 rounded-xl border border-slate-200 focus:bg-white focus:border-blue-500 focus:outline-hidden transition"
                />
              </div>

              <div className="space-y-1">
                <label className="font-bold text-slate-800 flex items-center gap-1.5">
                  <Users className="w-3.5 h-3.5 text-slate-400" /> Contact Person
                </label>
                <input
                  type="text"
                  name="contact_person"
                  value={formData.contact_person}
                  onChange={handleChange}
                  className="w-full bg-slate-50 px-3.5 py-2 rounded-xl border border-slate-200 focus:bg-white focus:border-blue-500 focus:outline-hidden transition"
                />
              </div>

              <div className="space-y-1">
                <label className="font-bold text-slate-800 flex items-center gap-1.5">
                  <Phone className="w-3.5 h-3.5 text-slate-400" /> Contact Phone
                </label>
                <input
                  type="text"
                  name="phone"
                  value={formData.phone}
                  onChange={handleChange}
                  className="w-full bg-slate-50 px-3.5 py-2 rounded-xl border border-slate-200 focus:bg-white focus:border-blue-500 focus:outline-hidden transition"
                />
              </div>

              <div className="sm:col-span-2 space-y-1">
                <label className="font-bold text-slate-800 flex items-center gap-1.5">
                  <Mail className="w-3.5 h-3.5 text-slate-400" /> Email Address
                </label>
                <input
                  type="email"
                  name="email"
                  value={formData.email}
                  onChange={handleChange}
                  className="w-full bg-slate-50 px-3.5 py-2 rounded-xl border border-slate-200 focus:bg-white focus:border-blue-500 focus:outline-hidden transition"
                />
              </div>
            </div>
          </div>

          {/* Section 2: Location & Coordinates */}
          <div>
            <div className="flex items-center gap-2 text-slate-400 font-bold uppercase tracking-wider text-[11px] mb-3 pb-1 border-b border-slate-100">
              <MapPin className="w-3.5 h-3.5 text-blue-600" />
              <span>Location, Address & GPS Coordinates</span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="sm:col-span-2 space-y-1">
                <label className="font-bold text-slate-800">
                  Region / City / Area
                </label>
                <input
                  type="text"
                  name="location"
                  value={formData.location}
                  onChange={handleChange}
                  className="w-full bg-slate-50 px-3.5 py-2 rounded-xl border border-slate-200 focus:bg-white focus:border-blue-500 focus:outline-hidden transition"
                />
              </div>

              <div className="sm:col-span-2 space-y-1">
                <label className="font-bold text-slate-800">
                  Detailed Address
                </label>
                <textarea
                  name="address"
                  value={formData.address}
                  onChange={handleChange}
                  rows={2}
                  className="w-full bg-slate-50 px-3.5 py-2 rounded-xl border border-slate-200 focus:bg-white focus:border-blue-500 focus:outline-hidden transition resize-none"
                />
              </div>

              <div className="sm:col-span-2">
                <GpsCoordinatePicker
                  latitude={formData.latitude}
                  longitude={formData.longitude}
                  locationText={formData.location || formData.address}
                  onChange={({ latitude, longitude, locationName }) => {
                    setFormData(prev => ({
                      ...prev,
                      latitude: latitude !== undefined ? latitude : prev.latitude,
                      longitude: longitude !== undefined ? longitude : prev.longitude,
                      location: (!prev.location && locationName) ? locationName : prev.location
                    }));
                  }}
                />
              </div>
            </div>
          </div>

          {/* Section 3: Special Site Instructions */}
          <div>
            <div className="flex items-center gap-2 text-slate-400 font-bold uppercase tracking-wider text-[11px] mb-3 pb-1 border-b border-slate-100">
              <FileText className="w-3.5 h-3.5 text-blue-600" />
              <span>Special Site Instructions & Access Notes</span>
            </div>

            <div className="space-y-1">
              <textarea
                name="special_instructions"
                value={formData.special_instructions}
                onChange={handleChange}
                rows={2}
                placeholder="Gate access code, security procedure, dog alerts, timing requirements..."
                className="w-full bg-slate-50 px-3.5 py-2 rounded-xl border border-slate-200 focus:bg-white focus:border-blue-500 focus:outline-hidden transition resize-none"
              />
            </div>
          </div>

        </form>

        {/* Modal Footer */}
        <div className="p-5 border-t border-slate-200 bg-slate-50 flex items-center justify-between gap-3">
          {onDelete ? (
            <button
              type="button"
              onClick={() => {
                onClose();
                onDelete(customer);
              }}
              className="flex items-center gap-1.5 px-3.5 py-2 bg-rose-50 hover:bg-rose-100 text-rose-700 font-bold text-xs rounded-xl border border-rose-200 transition cursor-pointer"
            >
              <Trash2 className="w-3.5 h-3.5 text-rose-600" />
              <span>Delete Customer</span>
            </button>
          ) : <div />}

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-slate-600 hover:text-slate-800 font-semibold text-xs rounded-xl hover:bg-slate-200 transition cursor-pointer"
            >
              Cancel
            </button>

            <button
              type="submit"
              form="edit-customer-form"
              disabled={loading}
              className="flex items-center gap-1.5 px-6 py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs rounded-xl shadow-md shadow-blue-200 disabled:opacity-50 transition cursor-pointer"
            >
              <Check className="w-4 h-4" />
              <span>{loading ? 'Saving Changes...' : 'Save Customer Changes'}</span>
            </button>
          </div>
        </div>

      </div>
    </div>
  );
}
